// 롱폼 대본 코드 검수(순수 함수) 테스트 — npx tsx scripts/test-longform-screening.ts
import { screenScript, speakSeconds } from "../lib/longformScreening";
import { layoutText, strokeAt168 } from "../lib/thumbnailCompose";
import { titleViolations, thumbnailTextViolations, promiseViolations } from "../lib/longformTitleCheck";
import type { LongformScriptPackage } from "../lib/types";
import shorts from "../config/script-principles.json";

let fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
  if (!cond) fail++;
}

function pkg(over: Partial<LongformScriptPackage> = {}): LongformScriptPackage {
  return {
    titleUsed: "휴머노이드 관련주 3대 대결 총정리, 승자는 따로 있었다",
    titlePromise: "가장 센 쪽이 이기지 않는다",
    segmentOrder: [],
    // 진행자 씬은 쇼츠 씬과 같은 4~7초(씬당 32자 이하). 문장은 자연스럽게.
    opening: {
      blockAHook: "이긴 쪽이 돈을 못 벌었어요.",
      blockBRoadmapLanding: "그럼 돈은 누가 벌었을까요?",
      estSeconds: 0,
    },
    bridges: [
      {
        afterSegment: 0,
        emphasis: "이긴 건 로봇이 아니라 부품사였어요.",
        elevation: "",
        opening: "다음은 미국과 중국입니다.",
        isMidpointReopen: true,
      },
      {
        afterSegment: 1,
        emphasis: "두 나라 다 같은 곳에서 사 갔어요.",
        elevation: "",
        opening: "마지막은 전시장입니다.",
        isMidpointReopen: false,
      },
    ],
    ending: {
      partAClose: "답은 감속기를 판 회사였어요.",
      partBLanding: "",
      // ★ 쇼츠 ⑧씬 고정 문구를 그대로 — 롱폼용으로 새로 짓지 않는다.
      partCStandard: shorts.structure.scene_8.text,
      endscreenVideo: "로봇개 대결편",
      estSeconds: 0,
    },
    screening: {},
    generatedAt: 0,
    ...over,
  };
}

console.log("낭독 길이 추정");
const openSec = speakSeconds(pkg().opening.blockAHook, pkg().opening.blockBRoadmapLanding);
const endSec = speakSeconds(pkg().ending.partAClose, pkg().ending.partBLanding, pkg().ending.partCStandard);
const brSec = speakSeconds(pkg().bridges[0].emphasis, pkg().bridges[0].elevation, pkg().bridges[0].opening);
// 진행자 씬 = 쇼츠 씬(4~7초). 오프닝 2씬·연결 1씬·엔딩 3씬.
check("오프닝 2씬 ≤14초", openSec <= 14, openSec);
check("연결 1씬 ≤7초", brSec <= 7, brSec);
check("엔딩 3씬 ≤21초", endSec <= 21, endSec);

console.log("\n정상 대본 — 위반 없음");
const ok = screenScript(pkg(), 3);
check("위반 0", ok.violations.length === 0, ok.violations);
check("중간점 1회 통과", ok.computed["중간점환기"].includes("통과"));

console.log("\n오프닝 예산 초과");
const long = screenScript(
  pkg({ opening: { ...pkg().opening, blockAHook: "가".repeat(200) } }),
  3
);
check("오프닝 초과 잡힘", long.violations.some((v) => v.includes("씬 상한")), long.violations);

console.log("\n중간점 환기 2회");
const mid = screenScript(
  pkg({ bridges: pkg().bridges.map((b) => ({ ...b, isMidpointReopen: true })) }),
  3
);
check("중간점 2회 잡힘", mid.violations.some((v) => v.includes("중간점")), mid.violations);

console.log("\n연결 수 불일치 / 빈 말 / 시점 표현");
const bad = screenScript(
  pkg({
    bridges: [{ ...pkg().bridges[0], elevation: "그런데 이건 시작에 불과합니다.", isMidpointReopen: true }],
    ending: { ...pkg().ending, partAClose: "최근 승자는 감속기 회사였어요." },
  }),
  3
);
check("연결 수 불일치 잡힘", bad.violations.some((v) => v.includes("연결 1개")), bad.violations);
check("빈 말 잡힘", bad.violations.some((v) => v.includes("빈 말")));
check("시점 표현 잡힘", bad.violations.some((v) => v.includes("시점 표현")));

// 실사고(2026-07-25): 엔딩이 종목 추천을 했고, 오프닝이 제작 내부 용어를 시청자에게 말했다.
console.log("\n종목 추천 · 내부 용어 노출");
const pick = screenScript(
  pkg({ ending: { ...pkg().ending, partAClose: "한미반도체가 핵심 수혜예요." } }),
  3
);
check("종목 추천 잡힘", pick.violations.some((v) => v.includes("종목 추천")), pick.violations);
// 우회 표현도 잡아야 한다(실제로 통과했던 것들).
for (const bad of [
  "장비주 실적이 먼저 움직이는 구조예요.",
  "장비는 한미반도체가 쥐고 있어요.",
  "수요가 꺾이면 다시 계산하세요.",
  "공급 전환 속도 확인 후 판단하세요.",
  // 투자 관점·기준 제시도 조언이다(2026-07-25).
  "그래서 그레이엄 원칙대로, 구조의 값어치를 먼저 보는 거예요.",
  "이런 구조에 투자할 때 기준은 공정 종속도예요.",
]) {
  const r = screenScript(pkg({ ending: { ...pkg().ending, partBLanding: bad } }), 3);
  check(`우회 추천 잡힘: "${bad.slice(0, 14)}…"`, r.violations.some((v) => v.includes("종목 추천")));
}
const jargon = screenScript(
  pkg({ opening: { ...pkg().opening, blockBRoadmapLanding: "세 판, 끝에 계좌 힌트 나옵니다." } }),
  3
);
check("내부 용어 잡힘", jargon.violations.some((v) => v.includes("내부 용어")), jargon.violations);
check(
  "회사명만 있고 추천 아니면 통과",
  screenScript(pkg({ ending: { ...pkg().ending, partAClose: "답은 한미반도체 장비였어요." } }), 3)
    .violations.length === 0
);

console.log("\n제목 검사");
check("시점 표현 탈락", titleViolations("2026년 로봇 관련주 3대 총정리", "로봇 관련주").some((v) => v.includes("시점")));
check("묶음 표시어 없어도 통과", titleViolations("로봇 관련주 이야기", "로봇 관련주").length === 0);
// 실사례(2026-07-23) — 모델이 "총정리 4편"·"4종 총정리"를 뱉었다. 묶음 표시어는 전부 금지.
check(
  "'4종 총정리' 탈락",
  titleViolations("메모리 반도체 관련주 4종 총정리 — HBM·헬륨 쇼크 수혜주", "메모리 반도체 관련주").length > 0,
  titleViolations("메모리 반도체 관련주 4종 총정리 — HBM·헬륨 쇼크 수혜주", "메모리 반도체 관련주")
);
check("'총정리 4편' 탈락", titleViolations("메모리 반도체 관련주 총정리 4편 — HBM·헬륨 쇼크", "메모리 반도체 관련주").length > 0);
check("'몰아보기' 탈락", titleViolations("반도체 관련주 몰아보기 — 진짜 수혜주는 따로", "반도체 관련주").length > 0);
// 실제 소재 수량("신제품 300개")은 편수 세기가 아니다 — 오탐 방지.
check(
  "'신제품 300개'는 통과",
  titleViolations("3M 관련주, 신제품 300개의 비밀은 실패한 접착제였다", "3M 관련주").length === 0,
  titleViolations("3M 관련주, 신제품 300개의 비밀은 실패한 접착제였다", "3M 관련주")
);
check(
  "묶음 표시어 없는 제목 통과",
  titleViolations("메모리 반도체 관련주, 헬륨 한 방울에 값이 흔들린 이유", "메모리 반도체 관련주").length === 0,
  titleViolations("메모리 반도체 관련주, 헬륨 한 방울에 값이 흔들린 이유", "메모리 반도체 관련주")
);
check(
  "주 검색어가 앞 30자에 없으면 탈락",
  titleViolations("헬륨 한 방울에 값이 흔들린 진짜 이유와 그 배경을 짚어보는 메모리 반도체 관련주", "메모리 반도체 관련주").length > 0
);
check("썸네일 제목 중복 탈락", thumbnailTextViolations("승자는", "승자는 따로 있다").some((v) => v.includes("중복")));
// 글자 수 규칙 없음 — 판정은 168px 판독뿐.
check("8자여도 읽히면 통과", thumbnailTextViolations("가스가 반도체를", "제목").length === 0, thumbnailTextViolations("가스가 반도체를", "제목"));
check(
  "길어서 안 읽히면 탈락",
  thumbnailTextViolations("헬륨 공급 대란이 만든 진짜 수혜주는 따로 있다", "제목").some((v) => v.includes("168px")),
  thumbnailTextViolations("헬륨 공급 대란이 만든 진짜 수혜주는 따로 있다", "제목")
);

// ★ 2026-08-01 실제 사고 — 오프닝이 엔딩 답을 미리 말하고 엔딩이 그걸 반복했다.
// 모델 자기평가는 "조기폐쇄 통과"라고 적었다. 코드로 잡는다.
console.log("\n조기 폐쇄 — 오프닝이 답을 미리 말함");
const echoed = pkg({
  opening: {
    blockAHook: "HBM을 만드느라 일반 DRAM 공급이 줄었어요. 그럼 DRAM 가격은 어떻게 됐을까요?",
    blockBRoadmapLanding: "삼성, SK하이닉스, 마이크론이 그 중심에 있어요.",
    estSeconds: 0,
  },
  ending: {
    partAClose: "HBM 생산이 늘수록 일반 DRAM 공급이 줄어요. 그래서 DRAM 가격이 올라요.",
    partBLanding: "",
    partCStandard: shorts.structure.scene_8.text,
    endscreenVideo: "",
    estSeconds: 0,
  },
});
const echoRes = screenScript(echoed, 3);
check(
  "실제 사고 대본이 조기 폐쇄로 잡힘",
  echoRes.violations.some((v) => v.includes("오프닝이 엔딩 답을 미리 말함")),
  echoRes.violations.filter((v) => v.includes("오프닝"))
);
check("조기폐쇄 채점 탈락 표시", echoRes.computed["조기폐쇄"].startsWith("탈락"), echoRes.computed["조기폐쇄"]);
check(
  "정상 대본은 조기 폐쇄 아님",
  !screenScript(pkg(), 3).violations.some((v) => v.includes("미리 말함")),
  screenScript(pkg(), 3).computed["조기폐쇄"]
);
// 소재가 같으면 명사 몇 개는 당연히 겹친다 — 그것만으로 탈락시키면 안 된다.
check(
  "소재어가 겹치는 정도로는 통과",
  !screenScript(
    pkg({
      opening: {
        blockAHook: "DRAM 값이 왜 이렇게 움직였을까요?",
        blockBRoadmapLanding: "세 회사 이야기부터 봅니다.",
        estSeconds: 0,
      },
      ending: {
        partAClose: "HBM 생산이 늘수록 범용 DRAM 공급이 줄어서예요.",
        partBLanding: "",
        partCStandard: shorts.structure.scene_8.text,
        endscreenVideo: "",
        estSeconds: 0,
      },
    }),
    3
  ).violations.some((v) => v.includes("미리 말함"))
);

console.log("\n제목 약속(title_promise) 검사");
check(
  "답으로 적힌 약속은 탈락",
  promiseViolations("HBM 생산 쏠림이 일반 DRAM 공급을 줄여 가격을 끌어올리는 메커니즘을 설명한다").length > 0,
  promiseViolations("HBM 생산 쏠림이 일반 DRAM 공급을 줄여 가격을 끌어올리는 메커니즘을 설명한다")
);
check(
  "질문으로 적힌 약속은 통과",
  promiseViolations("HBM에 밀린 일반 DRAM 값은 어떻게 됐을까요?").length === 0,
  promiseViolations("HBM에 밀린 일반 DRAM 값은 어떻게 됐을까요?")
);
check("빈 약속은 탈락", promiseViolations("").length > 0);

console.log("\n썸네일 레이아웃");
check("2덩어리 → 2줄", layoutText("왜 붙였나").lines.length === 2);
check("공백 없는 긴 문구도 2줄로 쪼갬", layoutText("헬륨쇼크수혜주").lines.length === 2, layoutText("헬륨쇼크수혜주").lines);
check("168px 획 2px 이상", strokeAt168(layoutText("이상해요").sizes[0]) >= 2, strokeAt168(layoutText("이상해요").sizes[0]));

console.log(fail === 0 ? "\n✅ 전부 통과" : `\n❌ ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
