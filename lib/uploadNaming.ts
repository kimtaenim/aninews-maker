// ============================================================================
// Drive 업로드 파일명 — 날짜-번호-분야-언어 (예: 260622-01-NEWS-KO).
//  - 분야: 스크립트 내용으로 Claude 가 config/upload-taxonomy.json 목록 중 하나 선택
//  - 언어: 프로젝트 lang → 라벨(ko=KO, ja=JP …). 둘 다 JSON 으로 관리(추가 가능).
// ============================================================================

import taxonomy from "../config/upload-taxonomy.json";
import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { getRedis } from "./redis";

export const UPLOAD_CATEGORIES: string[] = taxonomy.categories;
const LANG_LABELS = taxonomy.languages as Record<string, string>;

// 프로젝트 lang(en/es/ja/vi, 원본은 빈값=ko) → 파일명 언어 라벨.
export function uploadLangLabel(lang?: string): string {
  const key = (lang || "ko").toLowerCase();
  return LANG_LABELS[key] ?? key.toUpperCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 파일명·그날 업로드 카운터의 "날짜" — 한국시간(KST=UTC+9, DST 없음) 기준.
// 서버가 UTC(예: Vercel)여도 한국 달력일에 맞춰, 그날 카운터(upload-seq:{date})가
// 한국시간 자정에 새 키로 롤오버된다 → 날마다 자정에 번호가 자동으로 01부터 시작.
export function yymmdd(d: Date = new Date()): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${pad2(kst.getUTCFullYear() % 100)}${pad2(kst.getUTCMonth() + 1)}${pad2(kst.getUTCDate())}`;
}

// 그날의 업로드 순번(01, 02 …) — Redis INCR.
export async function nextDailySeq(dateStr: string): Promise<string> {
  const n = await getRedis().incr(`upload-seq:${dateStr}`);
  return pad2(n);
}

// 현재 그날 카운터 값(아직 한 번도 안 올렸으면 0). 다음 업로드 번호는 이 값 +1.
export async function getDailySeq(dateStr: string): Promise<number> {
  const v = await getRedis().get<number | string>(`upload-seq:${dateStr}`);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// 그날 카운터를 특정 값으로 설정(갱신·초기화). 다음 업로드는 value+1 부터.
export async function setDailySeq(dateStr: string, value: number): Promise<void> {
  await getRedis().set(`upload-seq:${dateStr}`, Math.max(0, Math.floor(value)));
}

// 스크립트 내용을 훑어 파일명용 "영어 한 단어 키워드"를 짓는다. 실패 시 "Video".
export async function pickKeyword(scriptText: string, projectId?: string): Promise<string> {
  const text = (scriptText ?? "").trim().slice(0, 4000);
  if (!text) return "Video";
  const client = getAnthropic();
  const system =
    "Name this short-form video file with ONE single English keyword that best captures its topic. " +
    "Reply with ONLY one English word — a noun or proper noun, no spaces, no punctuation, no quotes, " +
    "no explanation. Examples: Kimchi, SpaceX, Inflation, Naengmyeon, Offside.";
  try {
    const r = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 12,
      system,
      messages: [{ role: "user", content: text }],
    });
    const raw = (
      r.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>
    )
      .map((b) => b.text)
      .join("")
      .trim();
    // 첫 단어만, 영숫자만 남기고 24자 제한.
    const word = (raw.split(/\s+/)[0] ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
    try {
      const costUsd = anthropicCostUsd({
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
        cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
        cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
        model: MODELS.haiku,
      });
      await recordCost({ projectId, vendor: "anthropic", model: MODELS.haiku, costUsd, meta: { kind: "keyword" } });
    } catch {
      /* best-effort */
    }
    return word || "Video";
  } catch {
    return "Video";
  }
}

export function buildUploadName(args: {
  seq: string;
  keyword: string;
  lang?: string;
  date?: Date;
}): string {
  return `${yymmdd(args.date)}-${args.seq}-${args.keyword}-${uploadLangLabel(args.lang)}.mp4`;
}
