// 자막 PNG 렌더러 — 미리보기와 같은 디자인(각진 단일 박스, 크기/위치/색/정렬),
// 줄바꿈은 균형 2줄(필요하면 3줄). 2줄을 넘기면 한 씬의 나레이션을 두 캡션으로
// 나눠 순차 표시한다(captionsFor). 합성(compose.mjs)과 동일 코드를 쓴다.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";

// 산세리프/세리프 각각 따로 등록해서, 자막 설정(font)에 맞게 쓴다.
const SANS_PATHS = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-VF.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto-cjk/NotoSansCJK-Regular.ttc",
  "C:/Windows/Fonts/malgun.ttf",
];
const SERIF_PATHS = [
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-VF.otf",
  "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto-cjk/NotoSerifCJK-Regular.ttc",
  "C:/Windows/Fonts/batang.ttc",
];
// 라틴+성조 부호(베트남어 ề/ữ/ộ … 등) 풀커버 폰트. Noto Sans CJK 의 라틴은 베트남어
// 합성 부호를 다 못 그려 자막이 □ 로 깨진다 — 이 폰트를 폴백 체인에 받쳐 CJK 가 못
// 그리는 글자만 여기서 그리게 한다(한·일은 CJK 가 먼저라 영향 없음).
const LATIN_PATHS = [
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  "/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "C:/Windows/Fonts/arial.ttf",
];

function registerFirst(paths, family) {
  for (const f of paths) {
    try {
      if (existsSync(f)) {
        GlobalFonts.registerFromPath(f, family);
        return f;
      }
    } catch {}
  }
  return null;
}

const sansSrc = registerFirst(SANS_PATHS, "SubSans");
const serifSrc = registerFirst(SERIF_PATHS, "SubSerif");
const latinSrc = registerFirst(LATIN_PATHS, "SubLatin");

// 경로로 못 찾은 패밀리는 시스템 폰트(fontconfig)에서 찾는다.
let _sysLoaded = false;
function sysFamily(re) {
  try {
    if (!_sysLoaded) {
      GlobalFonts.loadSystemFonts?.();
      _sysLoaded = true;
    }
    const fams = (GlobalFonts.families ?? []).map((x) => x.family);
    return fams.find((n) => re.test(n)) || null;
  } catch {
    return null;
  }
}

const SANS_FAMILY =
  sansSrc ? "SubSans" : sysFamily(/Noto Sans CJK|Noto Sans KR|Malgun|Apple SD|Nanum Gothic/i) || "sans-serif";
const SERIF_FAMILY =
  serifSrc ? "SubSerif" : sysFamily(/Noto Serif CJK|Noto Serif KR|Batang|Nanum Myeongjo/i) || SANS_FAMILY;
const LATIN_FAMILY =
  latinSrc ? "SubLatin" : sysFamily(/Noto Sans(?! CJK)|DejaVu Sans|Liberation Sans|Arial/i) || null;

// 자막 설정의 폰트(serif/sans)에 맞는 패밀리.
const familyFor = (sub) => (sub?.font === "serif" ? SERIF_FAMILY : SANS_FAMILY);

// 폰트 문자열 끝에 붙이는 라틴 폴백 — CJK 폰트가 못 그리는 베트남어 부호를 받친다.
// (canvas 는 콤마 구분 패밀리에서 글자별로 폴백한다.)
const LATIN_FALLBACK = LATIN_FAMILY ? `, "${LATIN_FAMILY}"` : "";

try {
  console.log(
    `[worker] 자막 폰트 sans=${SANS_FAMILY}(${sansSrc ?? "sys"}) serif=${SERIF_FAMILY}(${serifSrc ?? "sys/fallback"}) latin=${LATIN_FAMILY ?? "없음(베트남어 자막 깨질 수 있음)"}(${latinSrc ?? "sys"})`
  );
} catch {}

// 1080폭 기준 자막 크기 (작게 56 / 보통 68 / 크게 84).
const fontPx = (size) => (size === "small" ? 56 : size === "large" ? 84 : 68);
const fontStr = (sub) =>
  `${sub.weight === "bold" ? 700 : 500} ${fontPx(sub.size)}px "${familyFor(sub)}"${LATIN_FALLBACK}`;

// 그리디 줄바꿈. 폭까지 글자를 채우다 넘치면 줄을 바꾼다.
//  - 공백 있는 언어(한국어 어절·영어 단어): 직전 공백에서 끊어 단어를 안 쪼갠다.
//  - 공백 없는 언어(일본어·중국어): 글자 단위로 끊는다(이전엔 한 덩어리라 안 끊겨 가로로 넘침).
// 줄 첫머리에 혼자 오면 안 되는 닫는 구두점(일본어·중국어·영어). 넘쳐도 앞 줄에 붙인다.
const NO_LINE_START = /[。、，．！？!?…‥」』）)】〕》〉\]｝},.;:’””]/;

function wrapGreedyNoOrphan(ctx, text, maxW, maxLines = 3) {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  if (!t) return [];
  const fits = (s) => ctx.measureText(s).width <= maxW;
  const lines = [];
  let cur = "";
  for (const ch of [...t]) {
    if (cur === "" && ch === " ") continue; // 줄 앞 공백 무시
    if (!cur || fits(cur + ch)) {
      cur += ch;
      continue;
    }
    // 넘쳐도 닫는 구두점은 현재 줄에 붙임(줄 첫머리에 혼자 오는 것 방지).
    if (NO_LINE_START.test(ch)) {
      cur += ch;
      continue;
    }
    // 넘침 → 줄바꿈.
    if (ch === " ") {
      lines.push(cur);
      cur = "";
      continue;
    }
    const sp = cur.lastIndexOf(" ");
    if (sp > 0) {
      // 공백 있음 → 거기서 끊어 마지막 단어/어절을 다음 줄로(단어 보존).
      lines.push(cur.slice(0, sp));
      cur = cur.slice(sp + 1) + ch;
    } else {
      // 공백 없음(일본어·중국어 등) → 글자 단위로 끊음.
      lines.push(cur);
      cur = ch;
    }
  }
  if (cur.trim()) lines.push(cur.trim());

  // 고아 방지(공백 있는 언어에만): 마지막 줄이 너무 짧으면 윗줄 끝 어절을 내려본다.
  let guard = 0;
  while (lines.length >= 2 && guard++ < 30) {
    const li = lines.length - 1;
    if (ctx.measureText(lines[li]).width >= maxW * 0.5) break;
    if (!lines[li - 1].includes(" ")) break; // CJK 등 공백 없으면 스킵
    const prev = lines[li - 1].split(" ");
    if (prev.length <= 1) break;
    const moved = prev[prev.length - 1];
    const cand = moved + " " + lines[li];
    if (ctx.measureText(cand).width > maxW) break;
    prev.pop();
    lines[li - 1] = prev.join(" ");
    lines[li] = cand;
  }
  return lines.slice(0, maxLines);
}

// 캡션 분할은 captions.mjs(segmentCaptions)가 담당 — 미리보기와 동일 알고리즘.

// 캡션 한 개 → 전체 프레임(투명) PNG 버퍼. ffmpeg 에서 overlay=0:0 로 얹는다.
// opts.debugBg=true 면 회색 배경(로컬 확인용).
// 한글 폰트를 못 찾았는지 외부에서 확인용.
export const hasKoreanFont = () => SANS_FAMILY !== "sans-serif";

export async function renderCaptionPng(text, sub, opts = {}) {
  // 한글 폰트가 없으면 canvas 가 한글 셰이핑에서 멈출 수 있으니, 얼지 말고 명확히 실패.
  if (!opts.allowNoFont && familyFor(sub) === "sans-serif") {
    throw new Error(
      "자막용 한글 폰트를 못 찾았어요 (워커에 fonts-noto-cjk 설치/경로 확인 필요)"
    );
  }
  const W = opts.W ?? 1080;
  const H = opts.H ?? 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (opts.debugBg) {
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(0, 0, W, H);
  }
  const size = opts.sizePx ?? fontPx(sub.size);
  ctx.font = `${sub.weight === "bold" ? 700 : 500} ${size}px "${familyFor(sub)}"${LATIN_FALLBACK}`;
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
  const boxX = left ? Math.round(W * 0.045) : Math.round((W - boxW) / 2);
  // 위치별 세로 배치. 중앙·2/3·3/4 는 박스 중심을 그 지점에 둔다. 하단은 바닥에서 10% 위.
  const boxY =
    sub.position === "top"
      ? Math.round(H * 0.09)
      : sub.position === "one-third"
        ? Math.round(H / 3 - boxH / 2)
      : sub.position === "center"
        ? Math.round(H * 0.5 - boxH / 2)
        : sub.position === "two-thirds"
          ? Math.round((H * 2) / 3 - boxH / 2)
          : sub.position === "three-quarters"
            ? Math.round(H * 0.75 - boxH / 2)
            : Math.round(H - H * 0.1 - boxH);

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

// 워터마크 PNG — 네 모서리 중 한 곳에 작은 반투명 텍스트. 전체 프레임 투명 PNG.
// position: tl=좌상 tr=우상 bl=좌하 br=우하.
export async function renderWatermarkPng(wm, opts = {}) {
  const W = opts.W ?? 1080;
  const H = opts.H ?? 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (opts.debugBg) {
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(0, 0, W, H);
  }
  const text = (wm?.text ?? "").trim();
  if (!text) return canvas.encode("png");

  const size = Math.round(W * 0.033); // ≈36px @1080
  ctx.font = `600 ${size}px "${SANS_FAMILY}"${LATIN_FALLBACK}`;
  ctx.textBaseline = "top";
  const tw = ctx.measureText(text).width;
  const th = Math.round(size * 1.2);
  const margin = Math.round(W * 0.03);

  const pos = wm.position || "br";
  const x = pos.includes("l") ? margin : Math.round(W - margin - tw);
  const y = pos.startsWith("t") ? margin : Math.round(H - margin - th);

  ctx.fillStyle = "rgba(0,0,0,0.45)"; // 가독성용 그림자
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(text, x, y);
  return canvas.encode("png");
}

// 제작 크레딧 "제작 : {name}" — 마지막 2씬에만. 워터마크(wm) 위치를 기준으로 바로 옆에:
//  - 하단(bl/br): 워터마크 바로 위 / 상단(tl/tr): 바로 아래.
//  - 오른쪽(r): 오른쪽 정렬 / 왼쪽(l): 왼쪽 정렬(워터마크와 같은 모서리 여백에 맞춤).
// 시그니처보다 뒤에 나오는 만큼 폰트는 워터마크의 1.5배.
export async function renderCreditPng(name, wm, opts = {}) {
  const W = opts.W ?? 1080;
  const H = opts.H ?? 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const nm = (name ?? "").trim();
  if (!nm) return canvas.encode("png");
  const text = `제작 : ${nm}`;

  const wmSize = Math.round(W * 0.033); // 워터마크 기준 크기
  const size = Math.round(wmSize * 1.5); // 1.5배
  ctx.font = `600 ${size}px "${SANS_FAMILY}"${LATIN_FALLBACK}`;
  ctx.textBaseline = "top";
  const tw = ctx.measureText(text).width;
  const th = Math.round(size * 1.2);
  const wmTh = Math.round(wmSize * 1.2);
  const margin = Math.round(W * 0.03);
  const gap = Math.round(wmSize * 0.5);

  const pos = wm?.position || "br";
  const x = pos.includes("l") ? margin : Math.round(W - margin - tw); // 좌/우 정렬
  const wmY = pos.startsWith("t") ? margin : Math.round(H - margin - wmTh);
  const y = pos.startsWith("t")
    ? wmY + wmTh + gap // 상단 워터마크 → 바로 아래
    : wmY - gap - th; // 하단 워터마크 → 바로 위

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(text, x, y);
  return canvas.encode("png");
}
