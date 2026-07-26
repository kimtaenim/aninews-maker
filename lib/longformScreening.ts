// ============================================================================
// [롱폼 모듈 2~4] 대본 코드 검수 — 모델 자기평가와 별개로 규칙으로 판정 가능한 것만.
// ----------------------------------------------------------------------------
// 25초 규칙(낭독 길이 추정)·중간점 환기 1회·금지 표현·브리지 수·빈 말 승격 등.
// 원칙 원천은 config/longform-principles.json.
// ============================================================================

import type { LongformScriptPackage } from "./types";

// 한국어 TTS ≈ 4.5자/초(lib/scenes.ts 기준)에 보이스오버 기본 속도 1.2배를 곱한 값.
// 프로젝트 기본 voiceSpeed 가 1.2(lib/projectStore.ts)라 실제 화면 시간은 이 속도로 계산한다.
const CHARS_PER_SEC = 4.5 * 1.2;
export function speakSeconds(...texts: string[]): number {
  const len = texts.map((t) => (t ?? "").trim().length).reduce((a, b) => a + b, 0);
  return Math.round((len / CHARS_PER_SEC) * 10) / 10;
}

// 진행자 구간 예산(2026-07-25 사용자 지정 — 이전 25/25초에서 대폭 단축).
// 시청자는 세그먼트를 보러 왔지 진행자를 보러 온 게 아니다. 진행자는 짧게 끊고 넘긴다.
//   오프닝 5~7초 · 연결(브리지) 3~5초 · 엔딩 10초 이내.
export const OPENING_BUDGET = 7;
export const ENDING_BUDGET = 10;
export const BRIDGE_BUDGET = 5;

// 전 모듈 공통 금지 표현(config common_bans / style.ban 의 기계 검사 가능한 부분).
const BAN_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /20\d{2}\s*년?|최근|요즘|올해|작년|내년|이번\s*(주|달|분기)/, label: "시점 표현" },
  { re: /~/, label: "물결표(~)" },
  { re: /한대요|래요\b|랍니다/, label: "-한대요 전달체" },
  { re: /알기\s*쉬운|정리해\s*드릴|정리해\s*드립니다|하는\s*법을\s*알려/, label: "수업 예고형" },
  { re: /선택은\s*여러분의\s*몫|판단은\s*여러분/, label: "정보 없는 여운형" },
  // ★ 제작 내부 용어를 시청자에게 그대로 말하는 것 — "끝에 계좌 힌트 나옵니다"가 실제로 나왔다.
  // "계좌에 닿는가"는 우리가 원칙을 설명할 때 쓰는 말이지, 진행자가 할 대사가 아니다.
  {
    re: /계좌\s*(힌트|착지|언어|관점)|title[_\s]?promise|열린\s*고리|방점|승격|개방\s*문장|세그먼트|브리지/,
    label: "제작 내부 용어 노출",
  },
];

// 승격 자리의 빈 말 — "이건 시작에 불과합니다" 류.
const EMPTY_ELEVATION = /시작에\s*불과|맛보기에\s*불과|본론은\s*지금부터/;

// ★ 종목 추천·투자 조언 — 쇼츠는 안 하는 짓인데 롱폼 "계좌 착지" 원칙이 통로가 됐다.
// 실제로 나온 위반: "한미반도체가 핵심 수혜예요", "장비주 실적이 먼저 움직이는 구조예요",
// "수요가 꺾이면 다시 계산하세요". 직접 술어만 막으면 이런 우회 표현이 다 통과한다.
const STOCK_PICK = new RegExp(
  [
    // 직접 지목
    "수혜주|유망주|추천\\s*종목|최선호|톱픽|top\\s*pick",
    "(핵심\\s*)?수혜(예요|입니다|다|株|주)",
    "담아|사\\s*두|매수|비중\\s*확대|사야|투자하세요|주목하세요|눈여겨",
    // 우회 — "X주가 먼저 움직인다", "X가 쥐고 있다" 류의 매수 신호
    "(주|株|종목|장비주|관련주)\\s*(실적|주가|가격)?\\s*(가|이)?\\s*먼저\\s*(움직|반응|간다|갑니다)",
    "먼저\\s*움직이는\\s*(구조|자리|쪽)",
    "(가|이)\\s*(쥐고|틀어쥐고)\\s*있",
    // 투자 조언 — 시청자에게 판단·계산·확인을 시키는 말
    "다시\\s*계산(해|하)",
    "확인(하고|한\\s*뒤)\\s*판단",
    "판단하세요|따져보세요|계산해\\s*보세요",
  ].join("|"),
  "i"
);

export interface ScriptScreenResult {
  violations: string[];
  computed: Record<string, string>; // 코드가 계산한 검수 결과(모델 screening 위에 덮어씀)
  openingSeconds: number;
  endingSeconds: number;
}

function scanBans(label: string, text: string, out: string[]): void {
  for (const p of BAN_PATTERNS) {
    if (p.re.test(text)) out.push(`${label}: ${p.label}`);
  }
}

export function screenScript(pkg: LongformScriptPackage, segmentCount: number): ScriptScreenResult {
  const v: string[] = [];
  const openingSeconds = speakSeconds(pkg.opening.blockAHook, pkg.opening.blockBRoadmapLanding);
  const endingSeconds = speakSeconds(pkg.ending.partAClose, pkg.ending.partBLanding, pkg.ending.partCStandard);

  if (openingSeconds > OPENING_BUDGET) v.push(`오프닝 ${openingSeconds}초 — ${OPENING_BUDGET}초 초과`);
  if (endingSeconds > ENDING_BUDGET) v.push(`엔딩 ${endingSeconds}초 — ${ENDING_BUDGET}초 초과`);
  // 오프닝은 두 블록 합쳐 5~7초라 블록당 한 문장씩이 한계다.
  if ((pkg.opening.blockAHook.match(/[.!?]/g)?.length ?? 0) > 1) v.push("오프닝 블록 A 1문장 초과");
  if ((pkg.opening.blockBRoadmapLanding.match(/[.!?]/g)?.length ?? 0) > 1) v.push("오프닝 블록 B 1문장 초과");
  if (speakSeconds(pkg.ending.partAClose) > 4) v.push("엔딩 파트 A 4초 초과");
  if (speakSeconds(pkg.ending.partBLanding) > 3) v.push("엔딩 파트 B 3초 초과");

  const gaps = Math.max(0, segmentCount - 1);
  if (pkg.bridges.length !== gaps) v.push(`브리지 ${pkg.bridges.length}개 — 세그먼트 사이(${gaps}개)와 불일치`);
  const midpoints = pkg.bridges.filter((b) => b.isMidpointReopen).length;
  if (midpoints > 1) v.push(`중간점 고리 환기 ${midpoints}회 — 영상당 1회만`);
  if (midpoints === 0 && gaps >= 2) v.push("중간점 고리 환기 없음 — 중간 브리지 1개에 지정 필요");

  scanBans("오프닝", `${pkg.opening.blockAHook} ${pkg.opening.blockBRoadmapLanding}`, v);
  scanBans("엔딩", `${pkg.ending.partAClose} ${pkg.ending.partBLanding}`, v);
  // 종목 추천 금지(원칙 ending.part_b.ban) — 엔딩 전체와 연결에서 본다.
  const pickTargets: [string, string][] = [
    ["엔딩 파트 A", pkg.ending.partAClose],
    ["엔딩 파트 B", pkg.ending.partBLanding],
    ...pkg.bridges.map(
      (b, i) => [`브리지 ${i + 1}`, [b.emphasis, b.elevation, b.opening].join(" ")] as [string, string]
    ),
  ];
  for (const [label, text] of pickTargets) {
    if (STOCK_PICK.test(text ?? "")) v.push(`${label}: 종목 추천 표현 — 특정 종목을 사라·수혜다로 지목 금지`);
  }
  pkg.bridges.forEach((b, i) => {
    scanBans(`브리지 ${i + 1}`, `${b.emphasis} ${b.elevation} ${b.opening}`, v);
    if (EMPTY_ELEVATION.test(b.elevation)) v.push(`브리지 ${i + 1}: 승격이 빈 말("시작에 불과" 류)`);
    // 연결은 3~5초(16~27자). 총량만 본다 — 역할별 글자 상한을 걸었더니 모델이 의미를 버리고
    // 글자 수만 맞춰 "빅3 구조로." "답 아직요." 같은 토막이 나왔다(2026-07-25 되돌림).
    // 자연스러운 문장인지는 사람이 읽고 판단할 몫이라 코드로는 총 길이만 가드한다.
    const joined = [b.emphasis, b.elevation, b.opening].filter(Boolean).join(" ");
    const sec = speakSeconds(joined);
    if (sec > BRIDGE_BUDGET) v.push(`브리지 ${i + 1}: ${sec}초 — ${BRIDGE_BUDGET}초 초과`);
  });
  const bridgeMax = pkg.bridges.length
    ? Math.max(...pkg.bridges.map((b) => speakSeconds(b.emphasis, b.elevation, b.opening)))
    : 0;

  const computed: Record<string, string> = {
    진행자길이: `오프닝 ${openingSeconds}초(≤${OPENING_BUDGET}) · 연결 최대 ${bridgeMax}초(≤${BRIDGE_BUDGET}) · 엔딩 ${endingSeconds}초(≤${ENDING_BUDGET}) — ${
      openingSeconds <= OPENING_BUDGET && endingSeconds <= ENDING_BUDGET && bridgeMax <= BRIDGE_BUDGET
        ? "통과"
        : "탈락"
    }`,
    중간점환기: midpoints === 1 ? "통과 — 1회" : `${midpoints}회 — ${gaps >= 2 ? "탈락" : "해당 없음"}`,
    브리지수: pkg.bridges.length === gaps ? `통과 — ${gaps}개` : `탈락 — ${pkg.bridges.length}/${gaps}`,
    금지표현: v.some((x) => /시점 표현|물결표|전달체|수업 예고형|여운형/.test(x)) ? "탈락" : "통과",
  };

  return { violations: v, computed, openingSeconds, endingSeconds };
}
