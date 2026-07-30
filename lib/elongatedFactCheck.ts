// ============================================================================
// [확장판] 팩트 대조 — 본문의 숫자·날짜·고유명사·인용이 사실 카드와 맞는지 기계로 본다.
// ----------------------------------------------------------------------------
// 판정은 3종뿐이다: 카드에 있음 / 카드에 없음 / 카드와 다름.
// 의견성 지적(문체·더 나은 표현)은 여기서 절대 나오지 않는다 — 모델을 쓰지 않는 이유다.
//
// 허용 근거는 두 가지:
//   · 그 문장이 인용한 카드([F-001])의 사실 문장
//   · 원본 쇼츠 대본 — 원본이 이미 한 말은 확장판이 다시 해도 된다(원본은 확정된 대본이다)
// 어느 쪽에도 없으면 "카드에 없음", 다른 카드에는 있는데 인용한 카드엔 없으면 "카드와 다름".
// ============================================================================

import { CARD_REF } from "./elongatedFormat";
import type { ElongatedChapter, ElongatedFactCheckItem, FactCard } from "./types";

// 숫자·날짜·금액·비율 — 단위가 붙으면 같이 잡는다("5,594달러", "28%", "1944년").
const NUM =
  /\d[\d,]*(?:\.\d+)?\s*(?:년대|년|개월|월|일|주|%|퍼센트|포인트|bp|달러|엔|위안|원|억|조|만|천|배|온스|톤|명|건|위)?/g;
// 라틴 문자 고유명사 — 회사·지수·기관 약어("ASML", "S&P500", "Fed").
const LATIN = /[A-Za-z][A-Za-z0-9&.\-]{1,}/g;
// 따옴표 인용.
const QUOTE = /[""'']([^""'']{2,80})[""'']/g;

// 근거 표시는 문장 "뒤"에 붙는다("…였어요. [F-002]"). 마침표 뒤에서 자르면 표시가 떨어져
// 나가(조각으로 남거나 다음 문장 머리에 붙어) 근거 없는 문장으로 잘못 잡힌다.
//  · 표시만 남은 조각 → 앞 문장에 도로 붙인다
//  · 다음 문장 머리에 붙은 표시 → 떼어 앞 문장으로 옮긴다
const ONLY_REFS = /^(?:\s*\[F-\d{3}(?:\s*,\s*F-\d{3})*\]\s*)+$/;
const LEADING_REFS = /^((?:\s*\[F-\d{3}(?:\s*,\s*F-\d{3})*\])+)\s*/;

export function sentences(body: string): string[] {
  const raw = (body ?? "")
    .split(/(?<=[.!?…]|[다요죠]\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    if (out.length && ONLY_REFS.test(s)) {
      out[out.length - 1] += ` ${s}`;
      continue;
    }
    const m = out.length ? LEADING_REFS.exec(s) : null;
    if (m) {
      out[out.length - 1] += ` ${m[1].trim()}`;
      const rest = s.slice(m[0].length).trim();
      if (rest) out.push(rest);
      continue;
    }
    out.push(s);
  }
  return out;
}

/** 비교용 정규화 — 쉼표·공백을 지워 "5,594달러"와 "5594 달러"가 같게 본다. */
export function norm(s: string): string {
  return (s ?? "").replace(/[\s,]/g, "").toLowerCase();
}

// 대조에서 뺄 것 — 숫자 하나짜리(순서·개수 표현)와 흔한 라틴 조각.
const TRIVIAL_LATIN = new Set(["ai", "it", "tv", "us", "uk", "eu", "ok", "vs", "no"]);
function isTrivial(token: string): boolean {
  const t = token.trim();
  if (!t) return true;
  if (/^\d{1,2}$/.test(t)) return true; // 한 자리·두 자리 맨숫자는 서수·개수일 때가 많다
  if (/^[A-Za-z]+$/.test(t) && TRIVIAL_LATIN.has(t.toLowerCase())) return true;
  return false;
}

/** 한 문장에서 대조 대상 토큰을 뽑는다(숫자·날짜·라틴 고유명사·인용). */
export function extractTokens(sentence: string): string[] {
  const bare = sentence.replace(CARD_REF, " ");
  const out: string[] = [];
  for (const m of bare.matchAll(NUM)) out.push(m[0].trim());
  for (const m of bare.matchAll(LATIN)) out.push(m[0].trim());
  for (const m of bare.matchAll(QUOTE)) out.push(m[1].trim());
  // 중복 제거(정규화 기준)
  const seen = new Set<string>();
  return out.filter((t) => {
    if (isTrivial(t)) return false;
    const k = norm(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 문장이 인용한 카드 id 들. */
export function sentenceCardIds(sentence: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(CARD_REF)) {
    for (const id of m[1].split(",")) out.push(id.trim());
  }
  return out;
}

export interface FactCheckInput {
  chapters: ElongatedChapter[];
  facts: FactCard[];
  sourceScenes: string[]; // 원본 대본 — 원본이 이미 한 말은 허용
}

export function runFactCheck(input: FactCheckInput): ElongatedFactCheckItem[] {
  const { chapters, facts, sourceScenes } = input;
  const cardById = new Map(facts.map((f) => [f.id, f]));
  const allCardsText = norm(facts.map((f) => `${f.fact} ${f.sourceName}`).join(" "));
  const sourceText = norm(sourceScenes.join(" "));

  const items: ElongatedFactCheckItem[] = [];
  for (const c of chapters) {
    const body = (c.body ?? "").trim();
    if (!body) continue;
    // 근거 표시 하나가 앞 문장 여러 개를 함께 받치기도 한다("A. B. [F-014]").
    // 표시가 나오면 직전 표시 이후의 문장들까지 그 근거가 덮는 것으로 본다.
    const list = sentences(body);
    const idsFor = new Map<number, string[]>();
    let bufStart = 0;
    list.forEach((s, i) => {
      const ids = sentenceCardIds(s);
      if (ids.length === 0) return;
      for (let k = bufStart; k <= i; k++) idsFor.set(k, ids);
      bufStart = i + 1;
    });

    list.forEach((sentence, si) => {
      const ids = idsFor.get(si) ?? [];
      const citedText = norm(
        ids.map((id) => cardById.get(id)?.fact ?? "").join(" ")
      );
      for (const token of extractTokens(sentence)) {
        const k = norm(token);
        // 원본이 이미 한 말이면 통과 — 원본 대본은 확정된 사실 기반이다.
        if (sourceText.includes(k)) continue;
        if (citedText.includes(k)) continue;
        const elsewhere = allCardsText.includes(k);
        items.push({
          chapter: c.index,
          sentence: sentence.replace(CARD_REF, "").trim(),
          token,
          verdict: elsewhere ? "카드와 다름" : "카드에 없음",
          ...(ids.length ? { cardId: ids.join(", ") } : {}),
        });
      }
    });
  }
  return items;
}

/** 통과 여부 — 대조에서 하나도 안 걸리면 통과. */
export function factCheckPassed(items: ElongatedFactCheckItem[]): boolean {
  return items.length === 0;
}
