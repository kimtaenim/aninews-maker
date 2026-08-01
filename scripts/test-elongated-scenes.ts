// 챕터 본문 → 씬 펼치기 테스트(순수 함수, 모델·네트워크 없음).
//   npx tsx scripts/test-elongated-scenes.ts
import {
  SCENE_CHARS_MAX,
  SCENE_CHARS_MIN,
  buildScenesFromPlan,
  durationFor,
  splitIntoScenes,
  OUTRO_TEXT,
} from "../lib/elongatedScenes";
import { DURATION_MAX, DURATION_MIN } from "../lib/scenes";
import type { ElongatedPlan } from "../lib/types";

let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) return console.log(`  ✅ ${name}`);
  failed++;
  console.log(`  ❌ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
}

console.log(`\n씬 글자 범위: ${SCENE_CHARS_MIN}~${SCENE_CHARS_MAX}자 (${DURATION_MIN}~${DURATION_MAX}초)`);

console.log("\n[1] 근거 표시는 지워진다");
{
  const s = splitIntoScenes("금값이 크게 빠졌어요. [F-001] 이유는 금리예요. [F-002]");
  ok("[F-001] 이 안 남는다", !s.join(" ").includes("F-001"), s);
  ok("씬이 하나 이상", s.length >= 1, s);
}

console.log("\n[2] 강조 마크업은 남는다");
{
  const s = splitIntoScenes("금값을 누른 건 [[금리]]예요.");
  ok("[[ ]] 유지", s.join(" ").includes("[[금리]]"), s);
}

console.log("\n[3] 모든 씬이 상한 안");
{
  const body =
    "금은 오래전부터 안전자산이라 불려 왔어요. 그런데 반년 만에 4분의 1이 빠졌어요. " +
    "이유는 금리였어요. 금리가 오르면 금을 들고 버티는 값이 커져요. " +
    "그래서 안전자산이라는 말만으로는 설명이 안 되는 거예요.";
  const s = splitIntoScenes(body);
  const over = s.filter((x) => x.length > SCENE_CHARS_MAX);
  ok("상한 초과 씬 없음", over.length === 0, over);
  ok("씬이 2개 이상", s.length >= 2, s.length);
}

console.log("\n[4] 상한을 넘는 한 문장은 쉼표에서 나뉜다");
{
  const long =
    "금리가 오르면 이자를 낳지 않는 금을 들고 버티는 기회비용이 커지고, 그래서 금값이 눌리는 구조가 만들어져요.";
  const s = splitIntoScenes(long);
  ok("2개 이상으로 나뉜다", s.length >= 2, s);
  ok("전부 상한 안", s.every((x) => x.length <= SCENE_CHARS_MAX), s);
  ok("합치면 원문 글자가 보존된다", s.join("").replace(/\s/g, "").length === long.replace(/\s/g, "").length, {
    got: s.join("").replace(/\s/g, "").length,
    want: long.replace(/\s/g, "").length,
  });
}

console.log("\n[5] 마지막 토막은 앞 씬에 붙는다");
{
  const s = splitIntoScenes("금리가 오르면 금값이 눌리는 구조가 만들어져요. 그렇죠.");
  ok("토막 씬이 없다", s.every((x) => x.length >= SCENE_CHARS_MIN) || s.length === 1, s);
}

console.log("\n[6] 씬 길이는 4~7초로 잘린다");
{
  ok("짧아도 4초", durationFor(3) === DURATION_MIN, durationFor(3));
  ok("길어도 7초", durationFor(500) === DURATION_MAX, durationFor(500));
}

console.log("\n[7] 설계 → 씬 배열(챕터 순서 유지, index 연속)");
{
  const plan: ElongatedPlan = {
    openLoop: { question: "q", closesAtChapter: 2, closingLineHint: "" },
    chapters: [
      {
        index: 1,
        title: "1",
        sourceSceneIndexes: [0],
        role: "",
        blocks: [],
        body: "금은 안전자산이라 불려 왔어요. 그런데 반년 만에 크게 빠졌어요. [F-001]",
      },
      {
        index: 2,
        title: "2",
        sourceSceneIndexes: [1],
        role: "",
        blocks: [],
        body: "이유는 금리였어요. 금리가 오르면 금을 들고 버티는 값이 커져요.",
      },
    ],
    generatedAt: 0,
  };
  const scenes = buildScenesFromPlan(plan);
  ok("씬이 생겼다", scenes.length >= 2, scenes.length);
  ok("마지막이 구독 표준 문구", scenes[scenes.length - 1].narration === OUTRO_TEXT.trim(), scenes[scenes.length - 1].narration);
  ok(
    "index 가 0부터 연속",
    scenes.every((s, i) => s.index === i),
    scenes.map((s) => s.index)
  );
  ok("근거 표시 없음", !scenes.some((s) => s.narration.includes("F-001")), scenes);
  ok(
    "1번 챕터 내용이 앞에 온다",
    scenes[0].narration.includes("안전자산"),
    scenes[0].narration
  );
  ok(
    "길이가 전부 4~7초",
    scenes.every((s) => s.durationSec >= DURATION_MIN && s.durationSec <= DURATION_MAX),
    scenes.map((s) => s.durationSec)
  );
  ok(
    "이미지·모션 프롬프트는 비어 있다(기존 단계가 채운다)",
    scenes.every((s) => s.imagePrompt === "" && s.motion === ""),
    scenes[0]
  );
}

console.log(failed === 0 ? "\n전부 통과\n" : `\n실패 ${failed}건\n`);
process.exit(failed === 0 ? 0 : 1);
