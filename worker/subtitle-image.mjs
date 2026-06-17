// 자막 PNG 렌더러 — 미리보기와 같은 디자인(각진 단일 박스, 크기/위치/색/정렬),
// 줄바꿈은 균형 2줄(필요하면 3줄). 2줄을 넘기면 한 씬의 나레이션을 두 캡션으로
// 나눠 순차 표시한다(captionsFor). 합성(compose.mjs)과 동일 코드를 쓴다.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";

const FONT_CANDIDATES = [
  // 워커(리눅스) — fonts-noto-cjk
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  // 로컬(윈도우) 확인용
  "C:/Windows/Fonts/malgunbd.ttf",
  "C:/Windows/Fonts/malgun.ttf",
];
let FONT_FAMILY = "sans-serif";
for (const f of FONT_CANDIDATES) {
  if (existsSync(f)) {
    GlobalFonts.registerFromPath(f, "SubKR");
    FONT_FAMILY = "SubKR";
    break;
  }
}

// 1080폭 기준 자막 크기 (작게 56 / 보통 68 / 크게 84).
const fontPx = (size) => (size === "small" ? 56 : size === "large" ? 84 : 68);
const fontStr = (sub) =>
  `${sub.weight === "bold" ? 700 : 500} ${fontPx(sub.size)}px ${FONT_FAMILY}`;

// 그리디 줄바꿈 + 고아글자 방지. 첫 줄을 폭까지 채우되, 마지막 줄이 너무 짧으면
// (한두 글자만 남는 고아) 윗줄 끝 어절을 한 개씩 내려 마지막 두 줄을 보기 좋게.
function wrapGreedyNoOrphan(ctx, text, maxW, maxLines = 3) {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  if (!t) return [];
  const words = t.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (cur && ctx.measureText(trial).width > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);

  // 고아 방지: 마지막 줄이 maxW의 절반에 못 미치면 윗줄 끝 어절을 내려본다.
  let guard = 0;
  while (lines.length >= 2 && guard++ < 30) {
    const li = lines.length - 1;
    if (ctx.measureText(lines[li]).width >= maxW * 0.5) break;
    const prev = lines[li - 1].split(" ");
    if (prev.length <= 1) break;
    const moved = prev[prev.length - 1];
    const cand = moved + " " + lines[li];
    if (ctx.measureText(cand).width > maxW) break; // 더 내리면 넘침
    prev.pop();
    lines[li - 1] = prev.join(" ");
    lines[li] = cand;
  }
  return lines.slice(0, maxLines);
}

// 캡션 분할은 captions.mjs(segmentCaptions)가 담당 — 미리보기와 동일 알고리즘.

// 캡션 한 개 → 전체 프레임(투명) PNG 버퍼. ffmpeg 에서 overlay=0:0 로 얹는다.
// opts.debugBg=true 면 회색 배경(로컬 확인용).
export async function renderCaptionPng(text, sub, opts = {}) {
  const W = opts.W ?? 1080;
  const H = opts.H ?? 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (opts.debugBg) {
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(0, 0, W, H);
  }
  const size = opts.sizePx ?? fontPx(sub.size);
  ctx.font = `${sub.weight === "bold" ? 700 : 500} ${size}px ${FONT_FAMILY}`;
  ctx.textBaseline = "alphabetic";

  const padX = Math.round(size * 0.45);
  const padY = Math.round(size * 0.28);
  const lineH = Math.round(size * 1.3);
  const maxBoxW = Math.round(W * 0.91); // 미리보기 컨테이너 폭에 해당(여백 ~4.5%)
  const wrapW = maxBoxW - padX * 2;

  const lines = wrapGreedyNoOrphan(ctx, text, wrapW, 3);
  const lineWidths = lines.map((l) => ctx.measureText(l).width);
  const textW = Math.max(...lineWidths, 0);
  // 미리보기처럼: 여러 줄(줄바꿈 발생)이면 박스는 고정 폭, 한 줄이면 글자에 맞춤.
  // → 끝줄이 짧아도 박스가 일정해 왼쪽 정렬이어도 비뚤어 보이지 않는다.
  const boxW = lines.length >= 2 ? maxBoxW : Math.round(textW + padX * 2);
  const boxH = Math.round(lines.length * lineH + padY * 2);

  const left = sub.align === "left";
  const top = sub.position === "top";
  const boxX = left ? Math.round(W * 0.045) : Math.round((W - boxW) / 2);
  const boxY = top ? Math.round(H * 0.04) : Math.round(H - H * 0.04 - boxH);

  const lightBox = sub.box === "light";
  ctx.fillStyle = lightBox ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.6)";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // 왼쪽 정렬=박스 안 왼쪽, 가운데 정렬=박스 안 가운데. (박스 위치도 정렬따라)
  ctx.fillStyle = lightBox ? "#18181b" : "#ffffff";
  lines.forEach((l, i) => {
    const tx = left ? boxX + padX : boxX + Math.round((boxW - lineWidths[i]) / 2);
    const ty = boxY + padY + i * lineH + Math.round(size * 0.8);
    ctx.fillText(l, tx, ty);
  });

  return canvas.encode("png");
}
