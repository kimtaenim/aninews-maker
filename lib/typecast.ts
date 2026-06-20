// ============================================================================
// Typecast (타입캐스트) TTS 프로바이더 — ElevenLabs 옵션 대안
// ----------------------------------------------------------------------------
// 한국어 특화 엔진. ElevenLabs 와 동일한 반환 시그니처라 lib/tts.ts 에서
// TTS_PROVIDER 로 골라 끼운다. POST /v1/text-to-speech 는 오디오 바이너리를
// 그대로 돌려준다(JSON 래핑 없음). 한 번에 최대 2000자.
//   docs: https://typecast.ai/docs/api-reference/text-to-speech/text-to-speech
// ============================================================================

import { typecastCostUsd, usdToKrw } from "./cost";
import { getLang } from "./languages";

const API_URL = "https://api.typecast.ai/v1/text-to-speech";
// ssfm-v30(최신) / ssfm-v21. TYPECAST_MODEL 로 override.
const DEFAULT_MODEL = process.env.TYPECAST_MODEL || "ssfm-v30";
const TTS_TIMEOUT_MS = 60_000;
const MAX_CHARS = 2000; // Typecast 1회 텍스트 상한

export function getTypecastKey(): string {
  const key = process.env.TYPECAST_API_KEY;
  if (!key) throw new Error("TYPECAST_API_KEY missing in .env.local");
  return key;
}

// 언어별 네이티브 voice 를 env 로 둔다: TYPECAST_VOICE_ID_KO / _EN / _ES / _JA …
// 해당 언어 전용이 없으면 공용 TYPECAST_VOICE_ID 로 폴백(품질은 언어별 voice 가 유리).
function getVoiceId(lang: string, override?: string): string {
  const v =
    override ||
    process.env[`TYPECAST_VOICE_ID_${lang.toUpperCase()}`] ||
    process.env.TYPECAST_VOICE_ID;
  if (!v) {
    throw new Error(
      `Typecast voice_id 가 없어요 — .env.local 에 TYPECAST_VOICE_ID_${lang.toUpperCase()} ` +
        "또는 TYPECAST_VOICE_ID 지정 (GET /v2/voices 로 확인)"
    );
  }
  return v;
}

// 앱 내부 lang → Typecast language(ISO 639-3). ko 와 레지스트리 언어를 매핑하고,
// 모르는 코드면 자동 감지(undefined)에 맡긴다.
function toIso3(lang?: string): string | undefined {
  if (lang === "ko") return "kor";
  return getLang(lang ?? "")?.iso3;
}

// 텍스트 → 보이스오버 오디오(mp3 bytes). 반환 형태는 ElevenLabs synthesizeSpeech + model.
export async function synthesizeSpeechTypecast(opts: {
  text: string;
  lang?: string;
  voiceId?: string;
  model?: string;
}): Promise<{
  audioBuffer: ArrayBuffer;
  costUsd: number;
  costKrw: number;
  charsUsed: number;
  model: string;
}> {
  const key = getTypecastKey();
  const text = (opts.text ?? "").trim();
  if (!text) throw new Error("TTS 텍스트가 비었어요");
  if (text.length > MAX_CHARS) {
    throw new Error(
      `Typecast 는 한 번에 ${MAX_CHARS}자까지예요 (현재 ${text.length}자) — 씬을 더 쪼개주세요`
    );
  }

  const lang = opts.lang || "ko";
  const voiceId = getVoiceId(lang, opts.voiceId);
  const model = opts.model || DEFAULT_MODEL;
  const language = toIso3(lang);

  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      voice_id: voiceId,
      text,
      model,
      ...(language ? { language } : {}),
      output: { audio_format: "mp3" },
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(
      `Typecast ${r.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  const audioBuffer = await r.arrayBuffer();
  const charsUsed = text.length;
  const costUsd = typecastCostUsd(charsUsed);
  return { audioBuffer, costUsd, costKrw: usdToKrw(costUsd), charsUsed, model };
}
