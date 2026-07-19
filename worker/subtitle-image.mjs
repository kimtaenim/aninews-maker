// 자막 PNG 렌더러 — 미리보기와 같은 디자인(각진 단일 박스, 크기/위치/색/정렬),
// 줄바꿈은 균형 2줄(필요하면 3줄). 2줄을 넘기면 한 씬의 나레이션을 두 캡션으로
// 나눠 순차 표시한다(captionsFor). 합성(compose.mjs)과 동일 코드를 쓴다.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { splitRuns, stripMarks } from "./emphasis.mjs";
import { resolveCaptionRecipe } from "./caption-presets.mjs";

// 리포에 번들한 손글씨 폰트(나눔펜, OFL). apt·경로 불확실성 없이 확실히 로드된다.
const BUNDLED_HAND = fileURLToPath(new URL("./fonts/NanumPenScript-Regular.ttf", import.meta.url));

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

// 손글씨(펜) — 나눔 펜, 없으면 붓. 자막 스타일 프리셋 "손글씨"용.
const HAND_PATHS = [
  BUNDLED_HAND, // 리포 번들(최우선) — 항상 존재
  "/usr/share/fonts/truetype/nanum/NanumPen.ttf",
  "/usr/share/fonts/truetype/nanum/NanumBrush.ttf",
  "/usr/share/fonts/opentype/nanum/NanumPen.ttf",
];

const sansSrc = registerFirst(SANS_PATHS, "SubSans");
const serifSrc = registerFirst(SERIF_PATHS, "SubSerif");
const latinSrc = registerFirst(LATIN_PATHS, "SubLatin");
const handSrc = registerFirst(HAND_PATHS, "SubHand");

// ani-cliché 장식 글꼴 — 리포 번들(OFL). 화려한 자막 프리셋용. 로컬·도커 공통 경로.
const bundled = (file) => fileURLToPath(new URL(`./fonts/${file}`, import.meta.url));
const impactSrc = registerFirst([bundled("BlackHanSans-Regular.ttf")], "SubImpact");
const romanceSrc = registerFirst([bundled("SongMyung-Regular.ttf")], "SubRomance");
const brushSrc = registerFirst([bundled("NanumBrushScript-Regular.ttf")], "SubBrush");
const juaSrc = registerFirst([bundled("Jua-Regular.ttf")], "SubJua");
const retroSrc = registerFirst([bundled("KirangHaerang-Regular.ttf")], "SubKirang");

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
// 손글씨 — 못 찾으면 세리프(그나마 표정 있음)로 폴백.
const HAND_FAMILY =
  handSrc ? "SubHand" : sysFamily(/Nanum ?Pen|Nanum ?Brush|Gaegu|Handwriting|Gungsuh/i) || SERIF_FAMILY;
// 장식 글꼴 패밀리 — 번들 실패 시 안전 폴백(sans/serif/hand).
const IMPACT_FAMILY = impactSrc ? "SubImpact" : SANS_FAMILY;
const ROMANCE_FAMILY = romanceSrc ? "SubRomance" : SERIF_FAMILY;
const BRUSH_FAMILY = brushSrc ? "SubBrush" : HAND_FAMILY;
const JUA_FAMILY = juaSrc ? "SubJua" : SANS_FAMILY;
const KIRANG_FAMILY = retroSrc ? "SubKirang" : SERIF_FAMILY;

// 자막 설정의 폰트(serif/sans)에 맞는 패밀리.
const familyFor = (sub) => (sub?.font === "serif" ? SERIF_FAMILY : SANS_FAMILY);
// 프리셋 recipe.font → 패밀리 (sans/serif/hand + 장식체 impact/romance/brush/jua/retro).
const familyOf = (f) =>
  f === "serif"
    ? SERIF_FAMILY
    : f === "hand"
      ? HAND_FAMILY
      : f === "impact"
        ? IMPACT_FAMILY
        : f === "romance"
          ? ROMANCE_FAMILY
          : f === "brush"
            ? BRUSH_FAMILY
            : f === "jua"
              ? JUA_FAMILY
              : f === "retro"
                ? KIRANG_FAMILY
                : SANS_FAMILY;

// 폰트 문자열 끝에 붙이는 라틴 폴백 — CJK 폰트가 못 그리는 베트남어 부호를 받친다.
// (canvas 는 콤마 구분 패밀리에서 글자별로 폴백한다.)
const LATIN_FALLBACK = LATIN_FAMILY ? `, "${LATIN_FAMILY}"` : "";

try {
  console.log(
    `[worker] 자막 폰트 sans=${SANS_FAMILY}(${sansSrc ?? "sys"}) serif=${SERIF_FAMILY}(${serifSrc ?? "sys/fallback"}) hand=${HAND_FAMILY}(${handSrc ?? "sys/fallback"}) latin=${LATIN_FAMILY ?? "없음(베트남어 자막 깨질 수 있음)"}(${latinSrc ?? "sys"}) deco=[impact:${impactSrc ? "✓" : "✗"} romance:${romanceSrc ? "✓" : "✗"} brush:${brushSrc ? "✓" : "✗"} jua:${juaSrc ? "✓" : "✗"} retro:${retroSrc ? "✓" : "✗"}]`
  );
} catch {}

// 자막 크기 = 프레임 "높이" 비례. 세로(H=1920) 기준 작게 56 / 보통 68 / 크게 84 를 유지하고,
// 가로 롱폼(H=1080)에선 자동으로 절반쯤(×1080/1920)으로 줄어든다. (절대 px 를 그대로 가로에
// 얹으면 높이 대비 1.8배로 커지던 버그 수정 — 자막은 프레임 높이에 비례해야 일관됨.)
const fontPx = (size, H = 1920) => {
  const base = size === "small" ? 56 : size === "large" ? 84 : 68;
  return Math.round((base * H) / 1920);
};
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

// 강조([[..]]) 런을 반영한 그리디 줄바꿈. 각 문자를 자기 폰트(base/em)로 측정하고,
// 넘치면 wrapGreedyNoOrphan 과 같은 규칙(공백에서 끊고, 닫는 구두점은 앞줄에)으로 줄을
// 나눈다. 반환: 줄 배열, 각 줄 = { segs:[{t,em,w}], width, size }(size=그 줄의 대표 크기).
function wrapRuns(ctx, runs, maxW, baseFont, emFont, baseSize, emSize, maxLines = 3) {
  // 문자 스트림(+em). 공백 정규화.
  const chars = [];
  for (const r of runs) {
    const norm = (r.t ?? "").replace(/\s+/g, " ");
    for (const c of norm) chars.push({ c, em: !!r.em });
  }
  while (chars.length && chars[0].c === " ") chars.shift();
  while (chars.length && chars[chars.length - 1].c === " ") chars.pop();
  if (!chars.length) return [];

  // [{c,em}] 묶음의 폭 — 같은 em 끼리 이어 측정.
  const widthOf = (arr) => {
    let w = 0;
    let i = 0;
    while (i < arr.length) {
      const em = arr[i].em;
      let s = "";
      while (i < arr.length && arr[i].em === em) {
        s += arr[i].c;
        i++;
      }
      ctx.font = em ? emFont : baseFont;
      w += ctx.measureText(s).width;
    }
    return w;
  };

  const rawLines = [];
  let cur = [];
  for (const ch of chars) {
    if (cur.length === 0 && ch.c === " ") continue; // 줄 앞 공백 무시
    if (cur.length === 0 || widthOf(cur.concat(ch)) <= maxW) {
      cur.push(ch);
      continue;
    }
    if (NO_LINE_START.test(ch.c)) {
      cur.push(ch); // 닫는 구두점은 현재 줄에
      continue;
    }
    if (ch.c === " ") {
      rawLines.push(cur);
      cur = [];
      continue;
    }
    let sp = -1;
    for (let k = cur.length - 1; k >= 0; k--)
      if (cur[k].c === " ") {
        sp = k;
        break;
      }
    if (sp > 0) {
      rawLines.push(cur.slice(0, sp));
      cur = cur.slice(sp + 1);
      cur.push(ch);
    } else {
      rawLines.push(cur);
      cur = [ch];
    }
  }
  if (cur.length) rawLines.push(cur);

  return rawLines.slice(0, maxLines).map((arr) => {
    while (arr.length && arr[arr.length - 1].c === " ") arr.pop();
    const segs = [];
    let i = 0;
    let anyEm = false;
    while (i < arr.length) {
      const em = arr[i].em;
      let s = "";
      while (i < arr.length && arr[i].em === em) {
        s += arr[i].c;
        i++;
      }
      ctx.font = em ? emFont : baseFont;
      segs.push({ t: s, em, w: ctx.measureText(s).width });
      if (em) anyEm = true;
    }
    const width = segs.reduce((a, b) => a + b.w, 0);
    return { segs, width, size: anyEm ? Math.max(baseSize, emSize) : baseSize };
  });
}

// 둥근 모서리 사각형 path (ctx.roundRect 미지원 환경 대비 수동).
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 캡션 분할은 captions.mjs(segmentCaptions)가 담당 — 미리보기와 동일 알고리즘.

// 캡션 한 개 → 전체 프레임(투명) PNG 버퍼. ffmpeg 에서 overlay=0:0 로 얹는다.
// opts.debugBg=true 면 회색 배경(로컬 확인용).
// 한글 폰트를 못 찾았는지 외부에서 확인용.
export const hasKoreanFont = () => SANS_FAMILY !== "sans-serif";

// 렌더용 캔버스 재사용 — 캡션마다 1080×1920(≈8MB) 캔버스를 새로 만들면 메모리 할당
// churn 이 커져 워커가 OOM 날 수 있다. 워커는 한 번에 하나씩(순차) 렌더하고 encode 를
// 기다린 뒤 다음으로 넘어가므로, 하나를 지워가며 재사용해도 안전하다.
let _canvas = null;
function getCanvas(W, H) {
  if (!_canvas || _canvas.width !== W || _canvas.height !== H) {
    _canvas = createCanvas(W, H);
  }
  const ctx = _canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H); // 이전 렌더 잔상 제거(투명 초기화)
  return { canvas: _canvas, ctx };
}

export async function renderCaptionPng(text, sub, opts = {}) {
  // 한글 폰트가 없으면 canvas 가 한글 셰이핑에서 멈출 수 있으니, 얼지 말고 명확히 실패.
  if (!opts.allowNoFont && SANS_FAMILY === "sans-serif") {
    throw new Error(
      "자막용 한글 폰트를 못 찾았어요 (워커에 fonts-noto-cjk 설치/경로 확인 필요)"
    );
  }
  const W = opts.W ?? 1080;
  const H = opts.H ?? 1920;
  const { canvas, ctx } = getCanvas(W, H);
  if (opts.debugBg) {
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(0, 0, W, H);
  }
  // 씬별 자막 스타일 프리셋 — 폰트·박스·색·모서리·외곽선을 결정(위치·크기·정렬은 sub).
  const recipe = resolveCaptionRecipe(sub, opts.preset);
  const size = opts.sizePx ?? fontPx(sub.size, H);
  const fam = familyOf(recipe.font);
  const baseFont = `${recipe.weight} ${size}px "${fam}"${LATIN_FALLBACK}`;
  const emSize = Math.round(size * 1.3); // 강조어는 1.3배 크게
  const emFont = `700 ${emSize}px "${fam}"${LATIN_FALLBACK}`;
  ctx.font = baseFont;
  ctx.textBaseline = "alphabetic";

  const padX = Math.round(size * 0.45);
  const padY = Math.round(size * 0.28);
  const maxBoxW = Math.round(W * 0.91); // 미리보기 컨테이너 폭에 해당(여백 ~4.5%)
  const wrapW = maxBoxW - padX * 2;

  const normColor = recipe.textColor;
  const emColor = recipe.emColor;

  // 강조 마커([[..]])가 없으면 기존 경로(문자열·단일 폰트) 그대로 — 결과 픽셀 동일.
  // 있을 때만 런(run) 렌더로 분기해 그 조각만 크게·강조색으로 그린다.
  const runs = splitRuns(text);
  const anyEm = runs.some((r) => r.em);

  // linesMeta[i] = { text? | segs?, width, size } — size 는 그 줄의 대표 글자 크기(줄높이 계산용).
  let linesMeta;
  if (!anyEm) {
    ctx.font = baseFont;
    const strs = wrapGreedyNoOrphan(ctx, stripMarks(text), wrapW, 3);
    linesMeta = strs.map((l) => ({ text: l, width: ctx.measureText(l).width, size }));
  } else {
    linesMeta = wrapRuns(ctx, runs, wrapW, baseFont, emFont, size, emSize, 3);
  }
  if (!linesMeta.length) return canvas.encode("png");

  const textW = Math.max(...linesMeta.map((l) => l.width), 0);
  // 미리보기처럼: 여러 줄이면 박스 고정 폭, 한 줄이면 글자에 맞춤(끝줄 짧아도 안 비뚤어짐).
  const boxW = linesMeta.length >= 2 ? maxBoxW : Math.round(textW + padX * 2);
  const lineHs = linesMeta.map((l) => Math.round(l.size * 1.3));
  const boxH = Math.round(lineHs.reduce((a, b) => a + b, 0) + padY * 2);

  const left = sub.align === "left";
  const boxX = left ? Math.round(W * 0.045) : Math.round((W - boxW) / 2);
  // 위치별 세로 배치. 중앙·2/3·3/4 는 박스 중심을 그 지점에 둔다. 하단은 바닥에서 10% 위.
  const boxY =
    sub.position === "top"
      ? Math.round(H * 0.09)
      : sub.position === "one-quarter"
        ? Math.round(H * 0.25 - boxH / 2)
      : sub.position === "one-third"
        ? Math.round(H / 3 - boxH / 2)
      : sub.position === "center"
        ? Math.round(H * 0.5 - boxH / 2)
        : sub.position === "two-thirds"
          ? Math.round((H * 2) / 3 - boxH / 2)
          : sub.position === "three-quarters"
            ? Math.round(H * 0.75 - boxH / 2)
            : Math.round(H - H * 0.1 - boxH);

  // 박스: solid 면 채우고(모서리 radiusRel×size, 알약이면 높이 절반까지 클램프), none 이면 안 그림.
  if (recipe.box === "solid") {
    ctx.fillStyle = recipe.boxFill;
    const r = Math.min((recipe.radiusRel || 0) * size, boxH / 2, boxW / 2);
    if (r > 0.5) {
      roundRectPath(ctx, boxX, boxY, boxW, boxH, r);
      ctx.fill();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }
  }

  // 외곽선(박스 없을 때 가독성) — 어두운 헤일로(그림자) + 굵은 stroke 로 어떤 배경에서도
  // 뜨게 한다(감성명조 등 boxless 프리셋). 그림자는 stroke 에만 걸고 fill 은 크게 선명하게.
  ctx.lineJoin = "round";
  const draw = (t, x, y, font, color, sz) => {
    ctx.font = font;
    if (recipe.outline) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = Math.round(sz * 0.28);
      ctx.lineWidth = Math.max(3, Math.round(sz * 0.18));
      ctx.strokeStyle = "rgba(0,0,0,0.95)";
      ctx.strokeText(t, x, y); // 헤일로 + 두꺼운 외곽선
      ctx.strokeText(t, x, y); // 한 번 더 겹쳐 진하게
      ctx.restore();
    }
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  };

  // 줄마다: 세로로 그 줄 높이만큼 누적, 베이스라인은 줄 상단 + size*0.8(기존과 동일 정렬).
  // 강조 세그먼트는 큰 폰트·강조색으로 alphabetic 베이스라인에 맞춰 그린다(아래 정렬).
  let yTop = boxY + padY;
  linesMeta.forEach((l, i) => {
    const baseline = yTop + Math.round(l.size * 0.8);
    let tx = left ? boxX + padX : boxX + Math.round((boxW - l.width) / 2);
    if (l.text != null) {
      draw(l.text, tx, baseline, baseFont, normColor, size);
    } else {
      for (const seg of l.segs) {
        draw(seg.t, tx, baseline, seg.em ? emFont : baseFont, seg.em ? emColor : normColor, seg.em ? emSize : size);
        tx += seg.w;
      }
    }
    yTop += lineHs[i];
  });

  return canvas.encode("png");
}

// 워터마크 PNG — 네 모서리 중 한 곳에 작은 반투명 텍스트. 전체 프레임 투명 PNG.
// position: tl=좌상 tr=우상 bl=좌하 br=우하.
export async function renderWatermarkPng(wm, opts = {}) {
  const W = opts.W ?? 1080;
  const H = opts.H ?? 1920;
  const { canvas, ctx } = getCanvas(W, H);
  if (opts.debugBg) {
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(0, 0, W, H);
  }
  const text = (wm?.text ?? "").trim();
  if (!text) return canvas.encode("png");

  // 워터마크 크기 = 짧은 변 기준(세로·가로 둘 다 1080 → 약 36px). 가로에서 폭(1920) 비례로
  // 커지던 것 교정("세로때 크기"). 위치 여백은 그대로 W 비례(가장자리 인셋).
  const size = Math.round(Math.min(W, H) * 0.033); // ≈36px (세로 크기)
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

// 제작 크레딧 "제작 : {name}" — 마지막 N씬에만(compose 에서 개수 지정). 워터마크(wm) 위치를 기준으로 바로 옆에:
//  - 하단(bl/br): 워터마크 바로 위 / 상단(tl/tr): 바로 아래.
//  - 오른쪽(r): 오른쪽 정렬 / 왼쪽(l): 왼쪽 정렬(워터마크와 같은 모서리 여백에 맞춤).
// 시그니처보다 뒤에 나오는 만큼 폰트는 워터마크의 1.5배.
export async function renderCreditPng(name, wm, opts = {}) {
  const W = opts.W ?? 1080;
  const H = opts.H ?? 1920;
  const { canvas, ctx } = getCanvas(W, H);
  const nm = (name ?? "").trim();
  if (!nm) return canvas.encode("png");
  const text = `제작 : ${nm}`;

  const wmSize = Math.round(Math.min(W, H) * 0.033); // 워터마크 기준 크기(짧은 변=세로 크기)
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
