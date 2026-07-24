// 롱폼 대본 코드 검수(순수 함수) 테스트 — npx tsx scripts/test-longform-screening.ts
import { screenScript, speakSeconds } from "../lib/longformScreening";
import { layoutText, strokeAt168 } from "../lib/thumbnailCompose";
import { titleViolations, thumbnailTextViolations } from "../lib/longformTitleCheck";
import type { LongformScriptPackage } from "../lib/types";

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
    opening: {
      blockAHook: "로봇개 두 마리가 붙었는데, 이긴 쪽이 아니라 붙인 쪽이 돈을 벌었어요.",
      blockBRoadmapLanding:
        "오늘 세 판을 봅니다. 첫 판은 누가 이겼는지보다 왜 붙였는지가 이상해요. 끝까지 보시면 이 판에서 돈 버는 한국 회사가 보입니다.",
      estSeconds: 0,
    },
    bridges: [
      {
        afterSegment: 0,
        emphasis: "이긴 건 로봇이 아니라 부품사였어요.",
        elevation: "그러면 전체 판의 승자도 선수가 아닐 수 있죠.",
        opening: "다음 판은 미국과 중국인데, 여기선 누가 부품을 대고 있을까요?",
        isMidpointReopen: true,
      },
      {
        afterSegment: 1,
        emphasis: "두 나라 다 같은 곳에서 감속기를 사 갔습니다.",
        elevation: "처음 질문이 점점 한 방향을 가리키네요.",
        opening: "마지막 판은 전시장인데, 왜 팔리지도 않는 로봇을 계속 만들까요?",
        isMidpointReopen: false,
      },
    ],
    ending: {
      partAClose: "승자는 싸운 쪽이 아니라 감속기를 판 회사였어요.",
      partBLanding: "답은 부품일까요? 단, 수주가 한 곳에 쏠릴 때는 다시 계산해 보시고요.",
      partCStandard: "아침저녁 쇼츠로 이런 이야기를 매일 올립니다. 구독해두시면 다음 이야기로 찾아뵐게요.",
      endscreenVideo: "로봇개 대결편",
      estSeconds: 0,
    },
    screening: {},
    generatedAt: 0,
    ...over,
  };
}

console.log("낭독 길이 추정");
check("25초 예산 안(오프닝)", speakSeconds(pkg().opening.blockAHook, pkg().opening.blockBRoadmapLanding) <= 25, speakSeconds(pkg().opening.blockAHook, pkg().opening.blockBRoadmapLanding));

console.log("\n정상 대본 — 위반 없음");
const ok = screenScript(pkg(), 3);
check("위반 0", ok.violations.length === 0, ok.violations);
check("중간점 1회 통과", ok.computed["중간점환기"].includes("통과"));

console.log("\n25초 초과 오프닝");
const long = screenScript(
  pkg({ opening: { ...pkg().opening, blockAHook: "가".repeat(200) } }),
  3
);
check("25초 초과 잡힘", long.violations.some((v) => v.includes("25초 초과")), long.violations);

console.log("\n중간점 환기 2회");
const mid = screenScript(
  pkg({ bridges: pkg().bridges.map((b) => ({ ...b, isMidpointReopen: true })) }),
  3
);
check("중간점 2회 잡힘", mid.violations.some((v) => v.includes("중간점")), mid.violations);

console.log("\n브리지 수 불일치 / 빈 말 승격 / 시점 표현");
const bad = screenScript(
  pkg({
    bridges: [{ ...pkg().bridges[0], elevation: "그런데 이건 시작에 불과합니다.", isMidpointReopen: true }],
    ending: { ...pkg().ending, partAClose: "최근 승자는 감속기 회사였어요." },
  }),
  3
);
check("브리지 수 불일치 잡힘", bad.violations.some((v) => v.includes("브리지")), bad.violations);
check("빈 말 승격 잡힘", bad.violations.some((v) => v.includes("빈 말")));
check("시점 표현 잡힘", bad.violations.some((v) => v.includes("시점 표현")));

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
check("'3가지' 탈락", titleViolations("반도체 관련주 3가지 — 진짜 수혜주는 따로", "반도체 관련주").length > 0);
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

console.log("\n썸네일 레이아웃");
check("2덩어리 → 2줄", layoutText("왜 붙였나").lines.length === 2);
check("공백 없는 긴 문구도 2줄로 쪼갬", layoutText("헬륨쇼크수혜주").lines.length === 2, layoutText("헬륨쇼크수혜주").lines);
check("168px 획 2px 이상", strokeAt168(layoutText("이상해요").sizes[0]) >= 2, strokeAt168(layoutText("이상해요").sizes[0]));

console.log(fail === 0 ? "\n✅ 전부 통과" : `\n❌ ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
