// ============================================================================
// [롱폼 모듈 2~4] 대본 코드 검수 — 모델 자기평가와 별개로 규칙으로 판정 가능한 것만.
// ----------------------------------------------------------------------------
// 25초 규칙(낭독 길이 추정)·중간점 환기 1회·금지 표현·브리지 수·빈 말 승격 등.
// 원칙 원천은 config/longform-principles.json.
// ============================================================================

import type { LongformScriptPackage } from "./types";
import { DURATION_MAX } from "./scenes";

// 한국어 TTS ≈ 4.5자/초(lib/scenes.ts 기준)에 보이스오버 기본 속도 1.2배를 곱한 값.
// 프로젝트 기본 voiceSpeed 가 1.2(lib/projectStore.ts)라 실제 화면 시간은 이 속도로 계산한다.
export const CHARS_PER_SEC = 4.5 * 1.2;
export function speakSeconds(...texts: string[]): number {
  const len = texts.map((t) => (t ?? "").trim().length).reduce((a, b) => a + b, 0);
  return Math.round((len / CHARS_PER_SEC) * 10) / 10;
}

// ★ 진행자 씬 길이는 쇼츠 씬과 같다 — lib/scenes.ts 의 DURATION_MIN/MAX(4~7초)가 원천.
// 롱폼용 예산을 따로 지어내지 마라(2026-07-25). 오프닝 2씬·연결 1씬·엔딩 3씬이므로
// 구간 예산은 씬 수 × 씬 상한으로 자동 계산된다.
export const SCENE_MAX = DURATION_MAX; // 7초
export const OPENING_BUDGET = SCENE_MAX * 2; // 오프닝 2씬 = 14초
export const ENDING_BUDGET = SCENE_MAX * 3; // 엔딩 3씬 = 21초
export const BRIDGE_BUDGET = SCENE_MAX; // 연결 1씬 = 7초

// 전 모듈 공통 금지 표현(config common_bans / style.ban 의 기계 검사 가능한 부분).
// 확장판 검수(lib/elongatedScore.ts)도 같은 금지 규칙을 쓴다 — 두 벌 만들지 않는다.
export const BANNED: { re: RegExp; label: string }[] = [
  { re: /20\d{2}\s*년?|최근|요즘|올해|작년|내년|이번\s*(주|달|분기)/, label: "시점 표현" },
  { re: /~/, label: "물결표(~)" },
  { re: /한대요|래요\b|랍니다/, label: "-한대요 전달체" },
  { re: /알기\s*쉬운|정리해\s*드릴|정리해\s*드립니다|하는\s*법을\s*알려|지금부터\s*(따라|알아보|살펴보|파헤|볼게|보시)/, label: "수업 예고형" },
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
    // 투자 관점·기준 제시 — "구조의 값어치를 먼저 보는 거예요" 류(2026-07-25 추가)
    "먼저\\s*(보는|봐야|보세요|봅니다|볼\\s*것)",
    "(기준|관점|잣대)(은|는|이|가)?\\s*(뭘|무엇|여기)",
    "(값어치|가치|밸류)(를|을)\\s*(먼저|따져|보)",
    "투자(할|하실)\\s*때",
    "(원칙|기준)대로",
  ].join("|"),
  "i"
);

// ★ 조기 폐쇄(기계 검사) — 오프닝이 엔딩 답과 같은 말을 하면 고리는 오프닝에서 이미 닫힌다.
// 원칙 원천은 config/script-principles.json: ①은 질문을 열고(scene_1), ⑦에서 처음 닫는다(scene_7).
// 실제 사고: 오프닝 "HBM을 만드느라 일반 DRAM 공급이 줄었어요. 그럼 가격은?" /
//           엔딩   "HBM 생산이 늘수록 일반 DRAM 공급이 줄어요. 그래서 가격이 올라요."
// 앞부분이 같은 문장이라 끝까지 본 사람이 새로 얻는 게 없었다. 모델 자기평가는 "통과"라고 적었다.
const STOPWORDS = /^(그럼|그래서|그런데|이런|저런|그거|이거|해요|예요|입니다|있어요|없어요|되나요|될까요|건가요|어떻게|무엇|왜)$/;

// 조사·어미를 대충 떨어낸 내용어 — 완벽한 형태소 분석이 아니라 "같은 말 반복"만 잡으면 된다.
export function contentWords(text: string): string[] {
  return (text ?? "")
    .replace(/[^가-힣A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/(을|를|이|가|은|는|의|에|에서|으로|로|와|과|도|만|까지|부터)$/, ""))
    .filter((w) => w.length >= 2 && !STOPWORDS.test(w));
}

// 엔딩 답의 내용어 중 오프닝에도 나온 비율. 1에 가까울수록 같은 말을 두 번 하는 것.
export function answerEchoRatio(openingText: string, endingAnswer: string): number {
  const ans = [...new Set(contentWords(endingAnswer))];
  if (ans.length < 3) return 0; // 너무 짧으면 판정하지 않는다
  const open = new Set(contentWords(openingText));
  const shared = ans.filter((w) => open.has(w));
  return shared.length / ans.length;
}

// 겹침이 이 이상이면 탈락. 소재가 같으면 명사 몇 개는 당연히 겹치므로 과반을 기준으로 둔다.
export const ANSWER_ECHO_MAX = 0.5;

export interface ScriptScreenResult {
  violations: string[];
  computed: Record<string, string>; // 코드가 계산한 검수 결과(모델 screening 위에 덮어씀)
  openingSeconds: number;
  endingSeconds: number;
}

function scanBans(label: string, text: string, out: string[]): void {
  for (const p of BANNED) {
    if (p.re.test(text)) out.push(`${label}: ${p.label}`);
  }
}

// 확장판 검수도 같은 판정을 써야 한다 — 정규식을 두 벌 만들지 않는다.
export function hasStockPick(text: string): boolean {
  return STOCK_PICK.test(text ?? "");
}

export function screenScript(pkg: LongformScriptPackage, segmentCount: number): ScriptScreenResult {
  const v: string[] = [];
  const openingSeconds = speakSeconds(pkg.opening.blockAHook, pkg.opening.blockBRoadmapLanding);
  const endingSeconds = speakSeconds(pkg.ending.partAClose, pkg.ending.partBLanding, pkg.ending.partCStandard);

  // 씬 단위로 본다 — 진행자 씬 하나는 쇼츠 씬과 같은 4~7초.
  const scene = (label: string, text: string) => {
    const t = (text ?? "").trim();
    if (!t) return; // 비워도 되는 자리(엔딩 여운 등)
    const sec = speakSeconds(t);
    if (sec > SCENE_MAX) v.push(`${label} ${sec}초 — 씬 상한 ${SCENE_MAX}초 초과`);
  };
  scene("오프닝 1씬", pkg.opening.blockAHook);
  scene("오프닝 2씬", pkg.opening.blockBRoadmapLanding);
  scene("엔딩 답", pkg.ending.partAClose);
  scene("엔딩 여운", pkg.ending.partBLanding);

  const gaps = Math.max(0, segmentCount - 1);
  if (pkg.bridges.length !== gaps) v.push(`연결 ${pkg.bridges.length}개 — 세그먼트 사이(${gaps}개)와 불일치`);
  const midpoints = pkg.bridges.filter((b) => b.isMidpointReopen).length;
  if (midpoints > 1) v.push(`중간점 고리 환기 ${midpoints}회 — 영상당 1회만`);

  scanBans("오프닝", `${pkg.opening.blockAHook} ${pkg.opening.blockBRoadmapLanding}`, v);
  scanBans("엔딩", `${pkg.ending.partAClose} ${pkg.ending.partBLanding}`, v);
  // 종목 추천 금지(원칙 ending.part_b.ban) — 엔딩 전체와 연결에서 본다.
  const pickTargets: [string, string][] = [
    ["엔딩 답", pkg.ending.partAClose],
    ["엔딩 여운", pkg.ending.partBLanding],
    ...pkg.bridges.map(
      (b, i) => [`연결 ${i + 1}`, [b.emphasis, b.elevation, b.opening].join(" ")] as [string, string]
    ),
  ];
  for (const [label, text] of pickTargets) {
    if (STOCK_PICK.test(text ?? "")) v.push(`${label}: 종목 추천·투자 조언 — 쇼츠는 안 하는 짓이다`);
  }
  pkg.bridges.forEach((b, i) => {
    const joined = [b.emphasis, b.elevation, b.opening].filter(Boolean).join(" ");
    scanBans(`연결 ${i + 1}`, joined, v);
    if (EMPTY_ELEVATION.test(b.elevation)) v.push(`연결 ${i + 1}: 빈 말("시작에 불과" 류)`);
    // 연결 하나 = 진행자 씬 하나 = 쇼츠 씬과 같은 4~7초.
    const sec = speakSeconds(joined);
    if (sec > BRIDGE_BUDGET) v.push(`연결 ${i + 1} ${sec}초 — 씬 상한 ${BRIDGE_BUDGET}초 초과`);
  });
  const bridgeMax = pkg.bridges.length
    ? Math.max(...pkg.bridges.map((b) => speakSeconds(b.emphasis, b.elevation, b.opening)))
    : 0;

  // ★ 제목이 답을 말해버렸는가 — 제목은 궁금하게 만드는 게 일이다. 답을 제목에서 주면
  // 클릭할 이유가 없다(원칙 ③ 괴리로 민다 / ⑦씬에서 답을 처음 닫는다).
  // 제목 단계에서는 답이 없어 판정할 수 없다 — 엔딩 답이 나온 여기서 본다.
  const titleEcho = answerEchoRatio(pkg.titleUsed, pkg.ending.partAClose);
  if (titleEcho > ANSWER_ECHO_MAX) {
    v.push(
      `제목이 답을 말함(엔딩 답과 ${Math.round(titleEcho * 100)}% 겹침) — ` +
        "제목은 괴리만 세우고 답은 본편에서 준다"
    );
  }

  // ★ 조기 폐쇄 — 오프닝이 엔딩 답과 같은 말을 하면 고리가 오프닝에서 닫힌 것이다.
  // 모델 자기평가는 연결만 보고 "조기폐쇄 통과"라고 적었다. 그래서 코드로 본다.
  const openingText = `${pkg.opening.blockAHook} ${pkg.opening.blockBRoadmapLanding}`;
  const echo = answerEchoRatio(openingText, pkg.ending.partAClose);
  if (echo > ANSWER_ECHO_MAX) {
    const shared = [...new Set(contentWords(pkg.ending.partAClose))]
      .filter((w) => new Set(contentWords(openingText)).has(w))
      .slice(0, 6);
    v.push(
      `오프닝이 엔딩 답을 미리 말함(겹침 ${Math.round(echo * 100)}%: ${shared.join("·")}) — ` +
        "오프닝은 질문만 열고, 답은 엔딩에서 처음 닫는다"
    );
  }

  const computed: Record<string, string> = {
    진행자길이: `오프닝 ${openingSeconds}초(2씬≤${OPENING_BUDGET}) · 연결 최대 ${bridgeMax}초(1씬≤${BRIDGE_BUDGET}) · 엔딩 ${endingSeconds}초(3씬≤${ENDING_BUDGET}) — ${
      openingSeconds <= OPENING_BUDGET && endingSeconds <= ENDING_BUDGET && bridgeMax <= BRIDGE_BUDGET
        ? "통과"
        : "탈락"
    }`,
    중간점환기: midpoints <= 1 ? "통과" : `${midpoints}회 — 탈락(1회만)`,
    연결수: pkg.bridges.length === gaps ? `통과 — ${gaps}개` : `탈락 — ${pkg.bridges.length}/${gaps}`,
    금지표현: v.some((x) => /시점 표현|물결표|전달체|수업 예고형|여운형|내부 용어/.test(x)) ? "탈락" : "통과",
    종목추천: v.some((x) => x.includes("종목 추천")) ? "탈락" : "통과",
    조기폐쇄:
      echo > ANSWER_ECHO_MAX
        ? `탈락 — 오프닝이 엔딩 답과 ${Math.round(echo * 100)}% 겹침`
        : `통과 — 겹침 ${Math.round(echo * 100)}%`,
  };

  return { violations: v, computed, openingSeconds, endingSeconds };
}
