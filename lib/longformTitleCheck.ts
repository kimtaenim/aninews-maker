// ============================================================================
// [롱폼 모듈 1] 제목 코드 검사 — 모델 자기평가와 별개로 기계적으로 잡히는 위반만.
// ----------------------------------------------------------------------------
// 원칙 원천은 config/longform-principles.json 의 title 섹션. 여기선 "규칙으로
// 판정 가능한 것"만 검사한다: 시점 표현·묶음 가치 누락·앞 30자 규칙·썸네일 문구 길이.
// ============================================================================

import { readableAt168 } from "./thumbnailLayout";

// 원칙 4 — 시점 표현(검색 유입은 수개월 뒤에도 온다).
const TIME_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /20\d{2}\s*년?/, label: "연도" },
  { re: /\d{1,2}\s*월(?![급말세])/, label: "월" },
  { re: /최근|요즘|올해|작년|내년|지금\s*당장|이번\s*(주|달|분기)|현재/, label: "시점어" },
];

// 묶음 표시어 금지(2026-07-23 사용자 지정) — "총정리·몰아보기·N편·N종·N가지" 류는
// 시청자에게 아무 가치가 없고 한국어로도 어색하다("총정리 4편"). 제목은 검색어 + 괴리로만 민다.
// (지시서 원안은 이 중 1개를 '필수'로 뒀으나, 실제 산출물을 보고 사용자가 뒤집었다.)
// 편·종은 사실상 언제나 "몇 편 묶음"의 카운터라 잡는다. 가지·개·선 같은 일반 수량사는
// 실제 소재("신제품 300개", "3가지 지표")일 때가 많아 코드로 안 막는다(프롬프트로만 유도).
const BUNDLE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /총정리/, label: "총정리" },
  { re: /몰아보기|모아보기/, label: "몰아보기" },
  { re: /한\s?방에/, label: "한 방에" },
  { re: /\d+\s*(편|종)(?![월일년목합류])/, label: "편수 세기" },
  { re: /TOP\s*\d+/i, label: "TOP N" },
];

export function bundleHits(title: string): string[] {
  return BUNDLE_PATTERNS.filter((p) => p.re.test(title)).map((p) => p.label);
}

export const TITLE_HEAD_CHARS = 30; // 검색 결과에서 잘리지 않는 앞부분

export function timeExpressions(title: string): string[] {
  return TIME_PATTERNS.filter((p) => p.re.test(title)).map((p) => p.label);
}

// 앞 30자(검색 결과에서 안 잘리는 구간) 안에 주 검색어가 들어갔는가.
export function headOk(title: string, primaryKeyword: string): boolean {
  const kw = (primaryKeyword ?? "").trim();
  if (kw.length === 0) return true;
  return title.slice(0, TITLE_HEAD_CHARS).replace(/\s/g, "").includes(kw.replace(/\s/g, ""));
}

// 후보 하나에 대한 위반 목록(빈 배열이면 깨끗).
export function titleViolations(title: string, primaryKeyword: string): string[] {
  const out: string[] = [];
  const t = (title ?? "").trim();
  if (!t) return ["빈 제목"];
  const times = timeExpressions(t);
  if (times.length) out.push(`시점 표현(${times.join("·")})`);
  const hits = bundleHits(t);
  if (hits.length) out.push(`묶음 표시어(${hits.join("·")}) — 쓰지 말 것`);
  if (!headOk(t, primaryKeyword)) out.push(`앞 ${TITLE_HEAD_CHARS}자 안에 주 검색어 없음`);
  if (/~/.test(t)) out.push("물결표(~)");
  return out;
}

// ★ title_promise 검사 — 이 값이 전 구간의 기준점이라, 여기에 "답"이 적히면 오프닝이 답을
// 미리 말하고 엔딩이 그걸 반복한다(2026-08-01 실제 사고).
//   나쁜 예: "HBM 쏠림이 일반 DRAM 공급을 줄여 가격을 끌어올리는 메커니즘을 설명한다" ← 답
// 원칙 원천은 config/script-principles.json scene_1 — "제목이 약속한 궁금증과 같은 질문".
// 즉 약속은 시청자가 답을 알고 싶어지는 '질문'이어야 한다. 질문인지는 종결부로 판정한다.
const QUESTION_TAIL = /(까요|나요|ㄹ까|을까|는가|런가|은가|인가|무엇|왜|어떻게|어디|누가)\s*[?？]?\s*$|[?？]\s*$/;
// 답을 서술해 버리는 종결 — "…설명한다", "…이다", "…때문이다" 류.
const ANSWER_TAIL = /(설명한다|보여준다|밝힌다|정리한다|다룬다|이다|입니다|한다|된다|예요|에요)\s*$/;

export function promiseViolations(titlePromise: string): string[] {
  const p = (titlePromise ?? "").trim();
  if (!p) return ["제목 약속(title_promise)이 비었어요 — 오프닝·엔딩의 기준점이라 반드시 필요해요"];
  const out: string[] = [];
  if (!QUESTION_TAIL.test(p)) {
    out.push(
      "제목 약속이 질문이 아니에요 — 시청자가 답을 알고 싶어지는 질문으로 적어야 " +
        "오프닝이 답을 미리 말하지 않아요"
    );
  }
  if (ANSWER_TAIL.test(p)) {
    out.push("제목 약속에 답이 적혀 있어요 — 답은 엔딩에서 처음 나와야 해요");
  }
  return out;
}

// 썸네일 문구 — 글자 수 제한은 두지 않는다. 진짜 상한은 "모바일 검색 결과 폭(168px)에서
// 읽히는가"뿐이라, 실제 배치 계산(lib/thumbnailLayout.ts)으로 판정한다. 길면 글자가 작아지고,
// 획이 2px 밑으로 내려가는 지점부터 안 읽힌다.
export function thumbnailTextViolations(text: string, title: string): string[] {
  const out: string[] = [];
  const t = (text ?? "").trim();
  if (!t) return ["썸네일 문구 없음"];
  const r = readableAt168(t);
  if (!r.ok) out.push(`168px에서 안 읽힘(획 ${r.strokePx}px) — 더 짧게`);
  if (title.includes(t)) out.push("썸네일 문구가 제목과 중복");
  return out;
}
