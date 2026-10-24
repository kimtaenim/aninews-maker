// 끊긴 작업 찾기 단위 테스트 — LLM 무관 순수함수.
//   실행: npx tsx scripts/test-pending-work.ts
//
// 생성은 돈이 나간다. 특히 이미 제출된 영상(videoJobId)을 다시 세면 같은 씬에
// 두 번 과금된다 — 그 경계를 여기서 못 박는다.
import { pendingVideoScenes, pendingAudioScenes } from "../lib/pendingWork";

let fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(ok ? "  ✓" : "  ✗", label, ok ? "" : `→ ${detail ?? ""}`);
  if (!ok) fail++;
};
const eq = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b);

type S = Parameters<typeof pendingVideoScenes>[0][number];
const scene = (p: Partial<S> = {}): S => ({ ...p }) as S;

console.log("[영상]");
{
  const r = pendingVideoScenes([scene(), scene(), scene()]);
  check("시작한 적 없으면 아무것도 안 센다", eq(r, []), JSON.stringify(r));
}
{
  const r = pendingVideoScenes([
    scene({ videoUrl: "u0" }),
    scene(),
    scene({ videoUrl: "u2" }),
  ]);
  check("빠진 씬만 센다", eq(r, [1]), JSON.stringify(r));
}
{
  const r = pendingVideoScenes([scene({ videoUrl: "u0" }), scene({ videoJobId: "job1" })]);
  check(
    "제출된 씬(videoJobId)은 안 센다 — 재제출하면 두 번 과금",
    eq(r, []),
    JSON.stringify(r)
  );
}
{
  const r = pendingVideoScenes([
    scene({ videoUrl: "u0" }),
    scene({ skipped: true }),
    scene({ videoSource: "upload" }),
  ]);
  check("건너뛴 씬·직접 올린 영상은 제외", eq(r, []), JSON.stringify(r));
}
{
  const r = pendingVideoScenes([scene({ videoJobId: "j0" }), scene(), scene()]);
  check("제출만 있어도 '시작함'으로 보고 나머지를 센다", eq(r, [1, 2]), JSON.stringify(r));
}

console.log("\n[음성]");
{
  const r = pendingAudioScenes([scene({ audioUrl: "a0" }), scene()], false);
  check("ttsEnabled 꺼져 있으면 안 센다", eq(r, []), JSON.stringify(r));
}
{
  const r = pendingAudioScenes([scene(), scene()], true);
  check("시작한 적 없으면 안 센다", eq(r, []), JSON.stringify(r));
}
{
  const r = pendingAudioScenes([scene({ audioUrl: "a0" }), scene(), scene()], true);
  check("빠진 씬만 센다", eq(r, [1, 2]), JSON.stringify(r));
}
{
  const r = pendingAudioScenes(
    [scene({ audioUrl: "a0" }), scene({ mood: true }), scene({ skipped: true })],
    true
  );
  check("분위기 씬·건너뛴 씬은 제외", eq(r, []), JSON.stringify(r));
}
{
  const r = pendingAudioScenes([scene({ audioUrl: "a0" }), scene({ audioUrl: "a1" })], true);
  check("다 됐으면 비어 있다", eq(r, []), JSON.stringify(r));
}

console.log(fail === 0 ? "\n전부 통과" : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
