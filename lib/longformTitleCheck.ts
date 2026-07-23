// ============================================================================
// [롱폼 모듈 1] 제목 코드 검사 — 모델 자기평가와 별개로 기계적으로 잡히는 위반만.
// ----------------------------------------------------------------------------
// 원칙 원천은 config/longform-principles.json 의 title 섹션. 여기선 "규칙으로
// 판정 가능한 것"만 검사한다: 시점 표현·묶음 가치 누락·앞 30자 규칙·썸네일 문구 길이.
// ============================================================================

// 원칙 4 — 시점 표현(검색 유입은 수개월 뒤에도 온다).
const TIME_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /20\d{2}\s*년?/, label: "연도" },
  { re: /\d{1,2}\s*월(?![급말세])/, label: "월" },
  { re: /최근|요즘|올해|작년|내년|지금\s*당장|이번\s*(주|달|분기)|현재/, label: "시점어" },
];

// 원칙 2 — 묶음 가치(숫자 우선). 하나라도 있으면 통과.
const BUNDLE_PATTERNS: RegExp[] = [
  /총정리/,
  /몰아보기/,
  /모아보기/,
  /한\s?번에/,
  /한\s?방에/,
  /\d+\s*(대|가지|개|종|편|선)/,
  /TOP\s*\d+/i,
];

export const TITLE_HEAD_CHARS = 30; // 검색 결과에서 잘리지 않는 앞부분

export function hasBundleValue(title: string): boolean {
  return BUNDLE_PATTERNS.some((re) => re.test(title));
}

export function timeExpressions(title: string): string[] {
  return TIME_PATTERNS.filter((p) => p.re.test(title)).map((p) => p.label);
}

// 앞 30자 안에 주 검색어와 묶음 가치가 다 들어갔는가.
export function headOk(title: string, primaryKeyword: string): boolean {
  const head = title.slice(0, TITLE_HEAD_CHARS);
  const kw = (primaryKeyword ?? "").trim();
  const kwOk = kw.length === 0 || head.replace(/\s/g, "").includes(kw.replace(/\s/g, ""));
  return kwOk && hasBundleValue(head);
}

// 후보 하나에 대한 위반 목록(빈 배열이면 깨끗).
export function titleViolations(title: string, primaryKeyword: string): string[] {
  const out: string[] = [];
  const t = (title ?? "").trim();
  if (!t) return ["빈 제목"];
  const times = timeExpressions(t);
  if (times.length) out.push(`시점 표현(${times.join("·")})`);
  if (!hasBundleValue(t)) out.push("묶음 가치 없음(총정리·몰아보기·숫자 중 1개 필수)");
  else if (!headOk(t, primaryKeyword)) out.push(`앞 ${TITLE_HEAD_CHARS}자 안에 주 검색어+묶음 가치 미포함`);
  if (/~/.test(t)) out.push("물결표(~)");
  return out;
}

// 썸네일 문구 — 7자 이내(공백 제외), 제목과 비중복.
export function thumbnailTextViolations(text: string, title: string): string[] {
  const out: string[] = [];
  const t = (text ?? "").trim();
  if (!t) return ["썸네일 문구 없음"];
  if (t.replace(/\s/g, "").length > 7) out.push("썸네일 문구 7자 초과");
  if (title.includes(t)) out.push("썸네일 문구가 제목과 중복");
  return out;
}
