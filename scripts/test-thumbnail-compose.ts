// 썸네일 글씨 합성 검증 — 이미지 생성 API 없이(단색 배경) 렌더가 실제로 도는지 확인.
//   npx tsx scripts/test-thumbnail-compose.ts
// 산출물은 scripts/out/ 에 떨어진다(커밋 대상 아님).
import { createCanvas } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { composeThumbnail, layoutText, strokeAt168, THUMB_W, THUMB_H } from "../lib/thumbnailCompose";

async function main() {
  const outDir = join(process.cwd(), "scripts", "out");
  await mkdir(outDir, { recursive: true });

  // 레이아웃 단위 확인
  const cases = ["왜 붙였나", "이상해요", "로봇개 전쟁", "가스가 반도체를"];
  for (const c of cases) {
    const l = layoutText(c);
    console.log(`"${c}" → ${l.lines.length}줄 ${JSON.stringify(l.sizes)} · 168px 획 ${strokeAt168(l.sizes[0])}px`);
    if (strokeAt168(l.sizes[0]) < 2) throw new Error(`소형 판독 하한 위반: ${c}`);
  }

  // 단색 배경(순백·순흑 아님)으로 실제 합성
  const bgCanvas = createCanvas(THUMB_W, THUMB_H);
  const bctx = bgCanvas.getContext("2d");
  bctx.fillStyle = "#183E78";
  bctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const bg = bgCanvas.toBuffer("image/png");

  for (const [side, text] of [
    ["left", "왜 붙였나"],
    ["right", "가스가 반도체를"],
  ] as const) {
    const r = await composeThumbnail({ background: bg, text, side });
    await writeFile(join(outDir, `thumb-${side}.jpg`), r.jpg);
    await writeFile(join(outDir, `thumb-${side}-168.jpg`), r.preview);
    console.log(
      `${side}: ${(r.jpg.byteLength / 1024).toFixed(0)}KB · 검증본 ${(r.preview.byteLength / 1024).toFixed(1)}KB · 획 ${r.strokePx}px`
    );
    if (r.jpg.byteLength > 2 * 1024 * 1024) throw new Error("2MB 초과");
    if (r.preview.byteLength < 200) throw new Error("검증본이 비었어요");
  }
  console.log("OK — scripts/out 확인");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
