// ============================================================================
// [롱폼 모듈 5] 썸네일 글씨 합성 — 생성된 배경(글씨 없음) 위에 thumbnail_text 를 얹는다.
// ----------------------------------------------------------------------------
// 한글 렌더링은 이미지 모델이 신뢰 불가 → 후처리로 얹는다(원칙 2).
//  · 렌더러: @napi-rs/canvas — 워커 자막(worker/subtitle-image.mjs)과 같은 엔진·같은 폰트.
//    (next/og 도 되지만 sharp 를 같이 쓰면 libvips 가 Next 내장 sharp 와 충돌한다.)
//  · 위치: 좌상 또는 우상(원칙 6 — 우하단은 유튜브 재생시간 자리라 비운다).
//  · 크기: 글자 블록이 가로의 45~55%를 차지하게 자동 계산하되, 168px 축소본에서 획이
//    2px 이상 남도록 하한(≈128px)을 둔다(원칙 3 · 소형 판독).
//  · 출력: 1280x720 JPG(2MB 이하) + 168px 축소 검증본(실제 리샘플).
// ============================================================================

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const THUMB_W = 1280;
export const THUMB_H = 720;
export const PREVIEW_W = 168;
export const PREVIEW_H = Math.round((THUMB_H / THUMB_W) * PREVIEW_W); // 95
export const MAX_BYTES = 2 * 1024 * 1024;

// Black Han Sans — 굵은 한글 디스플레이체(워커 자막에서 쓰는 것과 동일 자산).
const FONT_FAMILY = "AninewsThumb";
const FONT_PATH = join(process.cwd(), "worker", "fonts", "BlackHanSans-Regular.ttf");
let fontReady = false;
function ensureFont(): void {
  if (fontReady) return;
  if (existsSync(FONT_PATH)) GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
  fontReady = true;
}

// Black Han Sans 의 획(스템) 두께 ≈ 0.12em. 168px 축소 시 남는 두께를 추정한다.
const STEM_RATIO = 0.12;
export function strokeAt168(fontSize: number): number {
  return Math.round(fontSize * STEM_RATIO * (PREVIEW_W / THUMB_W) * 100) / 100;
}

export interface TextLayout {
  lines: string[]; // 1~2줄(2덩어리면 두 줄, 핵심 단어가 윗줄)
  sizes: number[]; // 줄별 글자 크기
}

// 7자 이내 문구를 최대 2덩어리로 나눠 배치. 윗줄이 핵심 단어 — 더 크게.
export function layoutText(text: string): TextLayout {
  const chunks = (text ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (chunks.length === 0) return { lines: [""], sizes: [160] };
  const maxChars = Math.max(...chunks.map((c) => c.length));
  // 글자 블록이 가로의 약 50%(640px)를 차지하도록. 소형 판독 하한 128px.
  const base = Math.round(Math.min(260, Math.max(128, 640 / Math.max(1, maxChars))));
  return chunks.length === 2
    ? { lines: chunks, sizes: [base, Math.round(base * 0.78)] }
    : { lines: chunks, sizes: [base] };
}

export interface ComposeResult {
  jpg: Buffer;
  preview: Buffer;
  fontSize: number;
  strokePx: number;
}

// 배경 PNG + 문구 → 시안 JPG + 168px 검증본.
export async function composeThumbnail(args: {
  background: Buffer;
  text: string;
  side: "left" | "right"; // 글씨를 어느 위(좌상/우상)에 둘지 — 피사체 반대편
}): Promise<ComposeResult> {
  const { background, text, side } = args;
  ensureFont();
  const layout = layoutText(text);

  const canvas = createCanvas(THUMB_W, THUMB_H);
  const ctx = canvas.getContext("2d");

  // 배경 — 비율이 달라도 캔버스를 꽉 채우게 cover.
  const img = await loadImage(background);
  const scale = Math.max(THUMB_W / img.width, THUMB_H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);

  // 글씨 뒤 반투명 띠 — 배경이 복잡할 때 대비 확보(원칙 4).
  const gx0 = side === "left" ? 0 : THUMB_W;
  const gx1 = side === "left" ? THUMB_W * 0.62 : THUMB_W * 0.38;
  const grad = ctx.createLinearGradient(gx0, 0, gx1, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.5)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H); // 가로 그라데이션만 — 중간에 가로 경계선이 생기지 않게

  // 글씨 — 외곽선(stroke) + 그림자로 어떤 배경에서도 읽히게.
  const PAD = 64;
  ctx.textBaseline = "top";
  ctx.textAlign = side === "left" ? "left" : "right";
  const x = side === "left" ? PAD : THUMB_W - PAD;
  let y = PAD;
  for (let i = 0; i < layout.lines.length; i++) {
    const size = layout.sizes[i];
    ctx.font = `${size}px "${FONT_FAMILY}"`;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = Math.round(size * 0.12);
    ctx.shadowOffsetY = Math.round(size * 0.04);
    ctx.lineWidth = Math.max(8, Math.round(size * 0.14));
    ctx.strokeStyle = "#111111";
    ctx.strokeText(layout.lines[i], x, y);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = i === 0 ? "#FFE24D" : "#FFFFFF"; // 핵심 단어(윗줄)를 강조색으로
    ctx.fillText(layout.lines[i], x, y);
    y += Math.round(size * 0.95);
  }

  // JPG 2MB 이하로 — 품질을 낮춰가며 맞춘다.
  let jpg = canvas.toBuffer("image/jpeg", 92);
  for (const q of [80, 70, 60]) {
    if (jpg.byteLength <= MAX_BYTES) break;
    jpg = canvas.toBuffer("image/jpeg", q);
  }

  // 소형 판독 검증본 — 실제 축소 리샘플(모바일 검색 결과 폭 168px).
  const pv = createCanvas(PREVIEW_W, PREVIEW_H);
  const pctx = pv.getContext("2d");
  pctx.drawImage(canvas, 0, 0, PREVIEW_W, PREVIEW_H);
  const preview = pv.toBuffer("image/jpeg", 85);

  return { jpg, preview, fontSize: layout.sizes[0], strokePx: strokeAt168(layout.sizes[0]) };
}
