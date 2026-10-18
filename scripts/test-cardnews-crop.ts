// 카드뉴스 삽화 잘라내기 검증 — 실제 카드 이미지로 돌린다(LLM 무관).
//   실행: npx tsx scripts/test-cardnews-crop.ts <카드이미지...> [-o 출력폴더]
//
// 잘라낸 PNG 를 출력 폴더에 쓰므로 눈으로 확인할 수 있다. 인자가 없으면
// 합성 카드(배경 + 제목 줄 + 삽화 블록 + 본문 줄)를 만들어 자동 검증한다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { detectArtworkBox, cropToPng } from "../lib/cardnewsCrop";

let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(ok ? "  ✓" : "  ✗", label, ok ? "" : `→ ${detail ?? ""}`);
  if (!ok) fail++;
}

// 카드 레이아웃을 흉내 낸 합성 이미지 — 배경 위에 제목 줄, 삽화 블록, 본문 줄.
function syntheticCard(): { png: Buffer; expect: { x: number; y: number; w: number; h: number } } {
  const W = 1024;
  const H = 1280;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e9f0fb"; // 카드 배경
  ctx.fillRect(0, 0, W, H);

  // 제목 — 글자 사이가 배경이라 성글게. 네모 몇 개로 흉내.
  ctx.fillStyle = "#1b2a6b";
  for (let i = 0; i < 9; i++) ctx.fillRect(60 + i * 70, 70, 44, 54);

  // 삽화 — 꽉 찬 블록.
  const box = { x: 48, y: 320, w: W - 96, h: 470 };
  ctx.fillStyle = "#5b8f4e";
  ctx.fillRect(box.x, box.y, box.w, box.h);

  // 본문 — 성근 글자 줄 5개.
  ctx.fillStyle = "#222222";
  for (let line = 0; line < 5; line++) {
    for (let i = 0; i < 16; i++) ctx.fillRect(48 + i * 58, 840 + line * 56, 34, 30);
  }
  // 푸터
  ctx.fillStyle = "#8b9bb4";
  for (let i = 0; i < 8; i++) ctx.fillRect(600 + i * 44, 1200, 26, 24);

  return { png: canvas.toBuffer("image/png"), expect: box };
}

async function main() {
  const argv = process.argv.slice(2);
  const oIdx = argv.indexOf("-o");
  const outDir = oIdx >= 0 ? argv[oIdx + 1] : "";
  const files = (oIdx >= 0 ? [...argv.slice(0, oIdx), ...argv.slice(oIdx + 2)] : argv).filter(
    (a) => !a.startsWith("-")
  );
  if (outDir) await mkdir(outDir, { recursive: true });

  if (files.length === 0) {
    console.log("[합성 카드 — 삽화 블록을 집어내는가]");
    const { png, expect } = syntheticCard();
    const box = await detectArtworkBox(png);
    if (!box) {
      check("삽화 검출", false, "null");
    } else {
      console.log("    검출:", JSON.stringify(box), "기대:", JSON.stringify(expect));
      const near = (a: number, b: number) => Math.abs(a - b) <= 4;
      check("y 위치", near(box.y, expect.y), `${box.y} vs ${expect.y}`);
      check("높이", near(box.h, expect.h), `${box.h} vs ${expect.h}`);
      check("x 위치", near(box.x, expect.x), `${box.x} vs ${expect.x}`);
      check("너비", near(box.w, expect.w), `${box.w} vs ${expect.w}`);
      check("제목·본문 줄은 안 집힘", box.y > 200 && box.y + box.h < 820);
    }
    console.log(fail === 0 ? "\n전부 통과" : `\n실패 ${fail}건`);
    process.exit(fail === 0 ? 0 : 1);
  }

  console.log("[실제 카드 이미지]");
  for (const f of files) {
    const bytes = await readFile(f);
    const box = await detectArtworkBox(bytes);
    const name = path.basename(f);
    if (!box) {
      check(`${name} 삽화 검출`, false, "null — 못 찾음");
      continue;
    }
    const ratio = (box.w / box.h).toFixed(2);
    console.log(`  ${name}: ${JSON.stringify(box)} 가로세로비 ${ratio}`);
    check(`${name} 검출`, true);
    if (outDir) {
      const out = path.join(outDir, name.replace(/\.[^.]+$/, "") + "-artwork.png");
      await writeFile(out, await cropToPng(bytes, box));
      console.log("    →", out);
    }
  }
  console.log(fail === 0 ? "\n전부 통과" : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
