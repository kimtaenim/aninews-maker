// ============================================================================
// 카드뉴스 삽화 잘라내기 — 카드 한 장에서 가운데 그림 영역만 뽑는다.
// ----------------------------------------------------------------------------
// 잘라낸 그림은 키프레임 "참조"로만 쓴다(Project.keyframeReferenceUrl). 키프레임
// 자체가 되는 게 아니라, 기존 keyframe 단계가 프로젝트 포맷(세로 9:16)으로 다시
// 그린다 — 출력 비율은 언제나 포맷을 따른다.
//
// 좌표는 모델에 묻지 않고 픽셀로 찾는다. 카드 배경은 한 가지 색으로 평평하고,
// 삽화는 그 위에 얹힌 꽉 찬 사각형이다. 글자 줄은 글자 사이가 배경이라 성글고,
// 삽화 줄은 가로로 거의 꽉 찬다 — 이 밀도 차이로 위아래·좌우 경계를 잡는다.
// ============================================================================

import { createCanvas, loadImage } from "@napi-rs/canvas";

export interface ArtworkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 배경색으로 볼 허용 오차(채널별 최대 차). 카드 배경은 평평해서 작게 잡아도 된다.
const BG_TOLERANCE = 18;
// 이 비율 이상 배경이 아니면 "꽉 찬 줄"로 본다. 글자 줄은 여기에 한참 못 미친다.
const DENSE_RATIO = 0.6;
// 삽화로 인정할 최소 크기(이미지 대비). 아이콘·구분선을 삽화로 집지 않게.
const MIN_H_RATIO = 0.12;
const MIN_W_RATIO = 0.3;

type Rgb = [number, number, number];

function isBg(r: number, g: number, b: number, bg: Rgb): boolean {
  return (
    Math.abs(r - bg[0]) <= BG_TOLERANCE &&
    Math.abs(g - bg[1]) <= BG_TOLERANCE &&
    Math.abs(b - bg[2]) <= BG_TOLERANCE
  );
}

// 가장자리에서 가장 흔한 색 = 카드 배경색.
function edgeBackground(data: Uint8ClampedArray, W: number, H: number): Rgb {
  const counts = new Map<string, { n: number; rgb: Rgb }>();
  const inset = Math.max(1, Math.round(Math.min(W, H) * 0.01));
  const push = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
    // 양자화해서 미세한 노이즈를 한 칸으로 모은다.
    const key = `${rgb[0] >> 3}-${rgb[1] >> 3}-${rgb[2] >> 3}`;
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { n: 1, rgb });
  };
  for (let x = 0; x < W; x++) {
    push(x, inset);
    push(x, H - 1 - inset);
  }
  for (let y = 0; y < H; y++) {
    push(inset, y);
    push(W - 1 - inset, y);
  }
  let best: { n: number; rgb: Rgb } | null = null;
  for (const v of counts.values()) if (!best || v.n > best.n) best = v;
  return best ? best.rgb : [255, 255, 255];
}

// 값 배열에서 threshold 이상이 연속으로 가장 길게 이어지는 구간 [start, end].
function longestRun(ratios: number[], threshold: number): [number, number] | null {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] >= threshold) {
      if (curStart < 0) curStart = i;
      const len = i - curStart + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
    }
  }
  if (bestStart < 0) return null;
  return [bestStart, bestStart + bestLen - 1];
}

// 카드 한 장 → 삽화 영역. 못 찾으면 null(그때는 그림을 쓰지 않는다).
export async function detectArtworkBox(bytes: Buffer): Promise<ArtworkBox | null> {
  const img = await loadImage(bytes);
  const W = img.width;
  const H = img.height;
  if (!W || !H) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  const bg = edgeBackground(data, W, H);

  const rowRatio = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!isBg(data[i], data[i + 1], data[i + 2], bg)) n++;
    }
    rowRatio[y] = n / W;
  }
  const rows = longestRun(rowRatio, DENSE_RATIO);
  if (!rows) return null;
  const [y0, y1] = rows;
  const h = y1 - y0 + 1;
  if (h < H * MIN_H_RATIO) return null;

  const colRatio = new Array<number>(W).fill(0);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      const i = (y * W + x) * 4;
      if (!isBg(data[i], data[i + 1], data[i + 2], bg)) n++;
    }
    colRatio[x] = n / h;
  }
  const cols = longestRun(colRatio, DENSE_RATIO);
  if (!cols) return null;
  const [x0, x1] = cols;
  const w = x1 - x0 + 1;
  if (w < W * MIN_W_RATIO) return null;

  return { x: x0, y: y0, w, h };
}

// 찾은 영역을 PNG 로 잘라낸다.
export async function cropToPng(bytes: Buffer, box: ArtworkBox): Promise<Buffer> {
  const img = await loadImage(bytes);
  const canvas = createCanvas(box.w, box.h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return canvas.toBuffer("image/png");
}

// 카드 한 장 → 잘라낸 삽화 PNG. 못 찾으면 null.
export async function extractArtwork(
  bytes: Buffer
): Promise<{ png: Buffer; box: ArtworkBox } | null> {
  const box = await detectArtworkBox(bytes);
  if (!box) return null;
  return { png: await cropToPng(bytes, box), box };
}
