// 최종 합성 — 씬별로 (영상 길이를 음성에 맞춰 슬로모션/트림) + 음성 + 자막 번인 →
// 이어붙이기 → mp4 → Blob. lang="ko" 또는 더빙 언어(en/es/ja…)로 어느 판을 구울지 결정.
// 다국어판 트랙은 scene.dub[lang] 에 있고, 기존 영어판은 narrationEn/audioUrlEn 에 폴백.
import { getProject, saveProject, logProgress, resetProgress } from "./store.mjs";
import { put } from "@vercel/blob";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { segmentCaptions } from "./captions.mjs";
import { stripMarks } from "./emphasis.mjs";
import { renderCaptionPng, renderWatermarkPng, renderCreditPng } from "./subtitle-image.mjs";

// 합성 캔버스 해상도는 프로젝트 포맷에 따라 결정(composeProject 안에서). 세로 숏폼
// 1080x1920, 가로 롱폼 1920x1080. 두 해상도는 픽셀 수가 같아 인코딩 부하도 동일.
// (lib/format.ts 가 앱 쪽 단일 원천 — 워커는 .mjs 라 같은 값을 여기 인라인으로 둔다.)
// 30fps — v6 에서 검증된 값. 24fps 로 바꿨더니 -loop 자막 오버레이 체인이 데드락(매달림)나서
// 복구. (인코딩 속도는 워커 인스턴스 상향으로 해결 — FPS 로 억지로 줄이지 않는다.)
const FPS = 30;

// 기본 타임아웃 150초 — 정상 인코딩은 그 안에 끝난다(v6 검증). 그 이상은 데드락/매달림으로
// 보고 죽여서 워커를 푼다(600초로 늘렸더니 매달린 잡이 10분씩 워커를 붙잡아 재시작 유발).
function run(cmd, args, timeoutMs = 150000) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args);
    let err = "";
    const timer = setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {}
      rej(
        new Error(
          `${cmd} 타임아웃(${Math.round(timeoutMs / 1000)}초) — 매달림. ffmpeg 마지막 출력: ${err.slice(-500)}`
        )
      );
    }, timeoutMs);
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      rej(e);
    });
    p.on("close", (c) => {
      clearTimeout(timer);
      c === 0 ? res() : rej(new Error(`${cmd} exit ${c}: ${err.slice(-700)}`));
    });
  });
}

function probeDuration(file) {
  return new Promise((res) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", file,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => res(parseFloat(out.trim()) || 0));
  });
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`다운로드 실패 ${r.status} ${url.slice(0, 80)}`);
  // 스트리밍 저장 — 영상 전체를 메모리(Buffer)에 올리지 않는다(OOM 방지).
  if (r.body) {
    await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
  } else {
    await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  }
}

// [롱폼] 진행자 씬 하나를 클립으로 렌더 — 영상+음성+자막(커버크롭), 세그먼트 완성본과 동일
// 인코딩(libx264/yuv420p/30fps/aac128k, 동일 W·H)이라 -c copy concat 가능. 기존 씬 루프
// (composeProject)는 안 건드리고 진행자 씬용으로 별도(효과음·워터마크·크레딧 없음).
async function renderHostSceneClip(s, dir, tag, sub, W, H) {
  const vPath = join(dir, `${tag}-v.mp4`);
  await download(s.videoUrl, vPath);
  let aPath = null;
  if (s.audioUrl) {
    aPath = join(dir, `${tag}-a.mp3`);
    await download(s.audioUrl, aPath);
  }
  const vd = await probeDuration(vPath);
  const ad = aPath ? await probeDuration(aPath) : 0;
  const audioLen = ad > 0 ? ad : s.durationSec || vd || 4;
  const caps = segmentCaptions(s.narration ?? "", sub.size);
  const capPaths = [];
  for (let j = 0; j < caps.length; j++) {
    const png = await renderCaptionPng(caps[j], sub, { W, H, preset: s.captionStyle });
    const cp = join(dir, `${tag}-cap${j}.png`);
    await writeFile(cp, png);
    capPaths.push(cp);
  }
  const MIN_CAP = 1.2;
  const weights = caps.map((c) => Math.max(1, stripMarks(c).replace(/\s/g, "").length));
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const durs = weights.map((w) => Math.max(MIN_CAP, (audioLen * w) / wSum));
  const capTotal = durs.reduce((a, b) => a + b, 0);
  const duration = capPaths.length ? Math.max(audioLen, capTotal) : audioLen;
  const speed = vd > 0 && duration > vd ? duration / vd : 1;
  const spans = [];
  let acc = 0;
  durs.forEach((d, j) => {
    const start = acc;
    acc += d;
    const end = j === durs.length - 1 ? duration + 0.5 : acc;
    spans.push([start, end]);
  });
  const baseF =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `crop=${W}:${H},setpts=${speed.toFixed(4)}*PTS,fps=${FPS}`;
  let filter;
  if (capPaths.length === 0) {
    filter = `${baseF}[v]`;
  } else {
    filter = `${baseF}[bg]`;
    let prev = "bg";
    capPaths.forEach((_, k) => {
      const label = k === capPaths.length - 1 ? "v" : `o${k}`;
      filter += `;[${prev}][${2 + k}:v]overlay=0:0:enable='between(t,${spans[k][0].toFixed(3)},${spans[k][1].toFixed(3)})'[${label}]`;
      prev = label;
    });
  }
  const out = join(dir, `${tag}.mp4`);
  const args = ["-y", "-i", vPath];
  if (aPath) args.push("-i", aPath);
  else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  for (const cp of capPaths) args.push("-loop", "1", "-framerate", String(FPS), "-i", cp);
  args.push(
    "-filter_complex", filter,
    "-map", "[v]", "-map", "1:a",
    "-t", String(duration), "-r", String(FPS),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    out
  );
  await run("ffmpeg", args);
  return out;
}

// [롱폼] 교차 합성 — 진행자 오프닝 → [세그먼트 → 진행자 연결] 반복 → 마지막 세그먼트 뒤
// 진행자 마무리(구독). 진행자 씬은 렌더, 세그먼트는 완성본 사용. 모두 동일 파라미터라 -c copy.
//   dir/log/W/H 는 호출자(composeProject)에서 받아 공유.
async function runLongformConcat(project, lang, dir, log, W, H) {
  const segIds = project.sourceProjectIds ?? [];
  if (segIds.length === 0) throw new Error("롱폼에 세그먼트(sourceProjectIds)가 없어요");

  const sub = project.subtitle ?? {
    font: "sans", weight: "regular", size: "small",
    position: "two-thirds", align: "center", box: "dark", lang: "ko",
  };

  // 1) 진행자 프로젝트 씬 수집(슬롯별). videoUrl 없는(미생성) 씬은 건너뜀.
  const hostOpening = [];
  const hostConnectors = new Map(); // connectorAfter → scene
  const hostClosing = [];
  let hostSub = sub;
  if (project.hostProjectId) {
    const host = await getProject(project.hostProjectId);
    if (host) {
      hostSub = host.subtitle ?? sub;
      for (const s of host.scenes ?? []) {
        if (!s.videoUrl) continue;
        if (s.hostSlot === "opening") hostOpening.push(s);
        else if (s.hostSlot === "connector") hostConnectors.set(s.connectorAfter ?? 0, s);
        else if (s.hostSlot === "closing") hostClosing.push(s);
      }
    }
  }
  await log(`진행자 씬 — 오프닝 ${hostOpening.length}·연결 ${hostConnectors.size}·마무리 ${hostClosing.length}`);

  // 2) 각 세그먼트 완성본 다운로드
  const segFiles = [];
  for (let i = 0; i < segIds.length; i++) {
    const sp = await getProject(segIds[i]);
    const url = sp?.finalVideoUrl;
    if (!url) throw new Error(`세그먼트 ${i + 1}(${segIds[i]}) 완성본(finalVideoUrl)이 없어요`);
    const f = join(dir, `seg${i}.mp4`);
    await log(`세그먼트 ${i + 1}/${segIds.length} 다운로드…`);
    await download(url, f);
    segFiles.push(f);
  }

  // 3) 교차 순서: 진행자 오프닝 → [세그 → 진행자 연결] → 마무리(구독). 진행자 씬은 클립으로 렌더.
  const order = [];
  let oi = 0;
  for (const s of hostOpening) {
    await log(`오프닝 진행자 씬 렌더 ${oi + 1}/${hostOpening.length}…`);
    order.push(await renderHostSceneClip(s, dir, `open${oi++}`, hostSub, W, H));
  }
  for (let i = 0; i < segFiles.length; i++) {
    order.push(segFiles[i]);
    const conn = hostConnectors.get(i);
    if (conn) {
      await log(`연결 진행자 씬 렌더(세그 ${i + 1} 뒤)…`);
      order.push(await renderHostSceneClip(conn, dir, `conn${i}`, hostSub, W, H));
    }
  }
  let ci = 0;
  for (const s of hostClosing) {
    await log("마무리 진행자 씬 렌더…");
    order.push(await renderHostSceneClip(s, dir, `close${ci++}`, hostSub, W, H));
  }

  const listPath = join(dir, "list.txt");
  await writeFile(listPath, order.map((f) => `file '${f}'`).join("\n"), "utf8");
  const finalPath = join(dir, "final.mp4");
  await log("이어붙이기(무손실 copy)…");
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c", "copy", "-movflags", "+faststart",
    finalPath,
  ]);

  // 4) 업로드 + 저장 — 저장 직전 fresh 재읽기 후 finalVideoUrl 만 머지(통째 저장 금지 규약).
  await log("Blob 업로드…");
  const { url } = await put(
    `project/${project.id}/final-${lang}-${Date.now()}.mp4`,
    createReadStream(finalPath),
    { access: "public", contentType: "video/mp4", addRandomSuffix: false }
  );
  const p2 = await getProject(project.id);
  if (p2) {
    p2.finalVideoUrl = url;
    p2.steps.compose.status = "generated";
    p2.steps.compose.error = undefined;
    p2.steps.compose.updatedAt = Date.now();
    p2.updatedAt = Date.now();
    await saveProject(p2);
  }
  await log("롱폼 합성 완료");
  return url;
}

// opts.clean=true → "영상만" 합성: 보이스·자막·효과음·워터마크·크레딧 전부 제외.
// 단, 씬 길이는 음성 길이 기준 그대로(외부 편집기에서 풀버전과 타이밍이 맞게).
// 결과는 finalVideoUrl 이 아닌 cleanVideoUrl 에 저장(정식 합성본을 안 덮음).
export async function composeProject(projectId, lang, opts = {}) {
  const clean = opts?.clean === true;
  // 진행 로그 — stderr + Redis(원격에서 lrange 로 추적). await 로 확실히 기록해서
  // 프로세스가 죽어도(OOM 등) 어느 단계까지 갔는지 Redis에 남게 한다.
  await resetProgress(projectId);
  const log = async (...a) => {
    const msg = a.join(" ");
    console.error("[worker]", msg);
    await logProgress(projectId, msg);
  };
  await log("composeProject 진입 — getProject 호출…");
  const project = await getProject(projectId);
  if (!project) throw new Error("프로젝트를 찾을 수 없어요");
  // 포맷별 합성 해상도 — long=가로 16:9, 그 외=세로 9:16(기존 기본). 자막·워터마크·
  // 크레딧 렌더러는 모두 { W, H } 를 받으므로 이 두 값만 바꾸면 전부 따라온다.
  const isLong = project.format === "long";
  const W = isLong ? 1920 : 1080;
  const H = isLong ? 1080 : 1920;
  // 롱폼(세그먼트 이어붙이기) 여부 — sourceProjectIds 로 판별. 롱폼은 자기 씬이 없고
  // 세그먼트(재합성된 숏폼) 완성본 + 아이캐치를 concat 한다(아래 runLongformConcat).
  const isLongform =
    project.format === "long" &&
    Array.isArray(project.sourceProjectIds) &&
    project.sourceProjectIds.length > 0;
  const scenes = isLongform ? [] : (project.scenes ?? []).filter((s) => s.videoUrl && !s.skipped);
  if (isLongform) {
    await log(`롱폼 합성 — 세그먼트 ${project.sourceProjectIds.length}개 + 아이캐치`);
  } else {
    await log(`프로젝트 로드됨 — 비디오 있는 씬 ${scenes.length}개`);
    if (scenes.length === 0) throw new Error("비디오가 있는 씬이 없어요");
  }

  const sub = project.subtitle ?? {
    font: "sans", weight: "regular", size: "small",
    position: "three-quarters", align: "center", box: "dark", lang: "ko",
  };
  console.log(
    `[worker] 렌더러=캡션PNG 오버레이(미리보기와 동일 디자인·캡션 분할) + cover-crop, 씬 ${scenes.length}개, lang=${lang}`
  );
  const dir = await mkdtemp(join(tmpdir(), "compose-"));
  try {
    // 롱폼: 세그먼트 완성본 + 아이캐치를 이어붙이는 경량 경로(씬 재인코딩 없음).
    if (isLongform) {
      const url = await runLongformConcat(project, lang, dir, log, W, H);
      return url;
    }
    if (clean) await log("클린 합성 모드 — 보이스·자막·효과음·워터마크 제외(영상만)");
    // 워터마크는 모든 씬에 동일하게 들어가므로 한 번만 렌더(전체프레임 투명 PNG).
    let wmPath = null;
    if (!clean && project.watermark?.text?.trim()) {
      const wmPng = await renderWatermarkPng(project.watermark, { W, H });
      wmPath = join(dir, "watermark.png");
      await writeFile(wmPath, wmPng);
      await log(`워터마크 "${project.watermark.text}" (${project.watermark.position})`);
    }
    // 제작 크레딧 — 마지막 3씬에만. 워터마크 위치 기준 옆에 1.5배로. (워터마크 유무와 무관)
    const CREDIT_LAST_SCENES = 3; // 크레딧을 노출할 끝 씬 개수
    let creditPath = null;
    const creditName = clean ? "" : (project.credit ?? "").trim();
    if (creditName) {
      const cPng = await renderCreditPng(creditName, project.watermark ?? { position: "br" }, { W, H });
      creditPath = join(dir, "credit.png");
      await writeFile(creditPath, cPng);
      await log(`제작 크레딧 "${creditName}" (마지막 ${CREDIT_LAST_SCENES}씬)`);
    }

    const sceneFiles = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const vPath = join(dir, `v${i}.mp4`);
      await log(`씬 ${i + 1}/${scenes.length}: 영상 다운로드…`);
      await download(s.videoUrl, vPath);

      const audioUrl =
        lang === "ko"
          ? s.audioUrl
          : s.dub?.[lang]?.audioUrl ?? (lang === "en" ? s.audioUrlEn : undefined);
      let aPath = null;
      if (audioUrl) {
        aPath = join(dir, `a${i}.mp3`);
        await download(audioUrl, aPath);
      }
      // [cliche] 효과음 — 목소리 밑에 깔 사운드(있으면 다운로드해 뒤에서 믹싱). 클린 모드 제외.
      let sfxPath = null;
      if (!clean && s.sfxUrl) {
        try {
          sfxPath = join(dir, `sfx${i}.mp3`);
          await download(s.sfxUrl, sfxPath);
        } catch {
          sfxPath = null; // 효과음 다운로드 실패해도 씬은 계속(목소리만).
        }
      }

      const vd = await probeDuration(vPath);
      const ad = aPath ? await probeDuration(aPath) : 0;
      const audioLen = ad > 0 ? ad : s.durationSec || vd || 5;

      const dubText =
        lang === "ko" ? "" : s.dub?.[lang]?.narration ?? (lang === "en" ? s.narrationEn : "");
      // [cliche] 분위기 씬(mood) — 자막 없이 영상+효과음만 나간다(narration 은 분위기 묘사라 안 그림).
      // 클린 모드는 전 씬 자막 생략(음성 길이 기반 타이밍은 아래에서 그대로 유지).
      const text = s.mood || clean ? "" : (lang === "ko" ? s.narration : dubText || s.narration) ?? "";
      // 긴 나레이션은 캡션 여러 개로 분할(미리보기와 동일 알고리즘) → 씬 안에서 순차 표시.
      const caps = segmentCaptions(text, sub.size);
      await log(`씬 ${i + 1}: 자막 캡션 ${caps.length}컷 렌더(canvas)…`);
      // 각 캡션을 미리보기와 같은 디자인의 전체프레임 투명 PNG로 렌더.
      const capPaths = [];
      for (let j = 0; j < caps.length; j++) {
        const png = await renderCaptionPng(caps[j], sub, { W, H, preset: s.captionStyle });
        const cp = join(dir, `cap${i}_${j}.png`);
        await writeFile(cp, png);
        capPaths.push(cp);
      }
      // 비례 타이밍: 캡션을 글자수에 비례해 음성 길이에 배분(음성이 마스터) → 자막이
      // 말 속도를 따라간다. 너무 짧으면 못 읽으니 캡션당 최소 1.2초 보장. 최소시간 합이
      // 음성보다 길면(짧은 음성에 캡션 多) 그만큼 장면을 늘린다. 미리보기와 동일 공식.
      const MIN_CAP = 1.2;
      const weights = caps.map((c) => Math.max(1, stripMarks(c).replace(/\s/g, "").length));
      const wSum = weights.reduce((a, b) => a + b, 0) || 1;
      const durs = weights.map((w) => Math.max(MIN_CAP, (audioLen * w) / wSum));
      const capTotal = durs.reduce((a, b) => a + b, 0);
      const duration = capPaths.length ? Math.max(audioLen, capTotal) : audioLen;
      // 음성/자막이 영상보다 길면 영상을 슬로모션으로 늘림(루프 X).
      const speed = vd > 0 && duration > vd ? duration / vd : 1;
      const spans = [];
      let acc = 0;
      durs.forEach((d, j) => {
        const start = acc;
        acc += d;
        const end = j === durs.length - 1 ? duration + 0.5 : acc;
        spans.push([start, end]);
      });

      // 미리보기(object-cover)와 동일: 9:16 꽉 채우고 가운데 크롭(검은 테두리 없음).
      const base =
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},setpts=${speed.toFixed(4)}*PTS,fps=${FPS}`;
      // 오버레이: 자막(시간 구간 enable) + 워터마크(항상). 입력은 0=video,1=audio,2..=캡션,그 뒤=워터마크.
      const overlays = capPaths.map((_, j) => ({
        inIdx: 2 + j,
        enable: `between(t,${spans[j][0].toFixed(3)},${spans[j][1].toFixed(3)})`,
      }));
      if (wmPath) overlays.push({ inIdx: 2 + capPaths.length, enable: null });
      // 제작 크레딧: 마지막 N씬에만. 입력 순서는 (자막들 → 워터마크 → 크레딧).
      const showCredit = creditPath && i >= scenes.length - CREDIT_LAST_SCENES;
      if (showCredit) {
        overlays.push({ inIdx: 2 + capPaths.length + (wmPath ? 1 : 0), enable: null });
      }

      let filter;
      if (overlays.length === 0) {
        filter = `${base}[v]`;
      } else {
        filter = `${base}[bg]`;
        let prev = "bg";
        overlays.forEach((ov, k) => {
          const label = k === overlays.length - 1 ? "v" : `o${k}`;
          const en = ov.enable ? `:enable='${ov.enable}'` : "";
          filter += `;[${prev}][${ov.inIdx}:v]overlay=0:0${en}[${label}]`;
          prev = label;
        });
      }

      const out = join(dir, `scene${i}.mp4`);
      const args = ["-y", "-i", vPath];
      // 클린 모드: 음성 파일은 길이 측정에만 쓰고 트랙엔 안 싣는다(무음) — 타이밍 동일 유지.
      if (aPath && !clean) args.push("-i", aPath);
      else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
      // 자막 PNG는 -loop 1 로 연속 스트림화(단일 프레임 입력 + overlay 체인은 데드락).
      // 출력 -t 가 전체 길이를 제한하므로 입력은 무한 루프로 둬도 안전(v6 검증됨).
      for (const cp of capPaths) args.push("-loop", "1", "-framerate", String(FPS), "-i", cp);
      if (wmPath) args.push("-loop", "1", "-framerate", String(FPS), "-i", wmPath);
      if (showCredit) args.push("-loop", "1", "-framerate", String(FPS), "-i", creditPath);
      // [cliche] 효과음 믹싱 — 목소리(1:a) 밑에 효과음을 볼륨 낮춰 amix. sfx 입력은 -stream_loop
      // 로 반복하되 -t 로 씬 길이만큼만 읽어 유한하게(무한 입력 + amix=longest 는 매달림 위험).
      let filterFull = filter;
      let audioMap = "1:a";
      if (sfxPath) {
        const sfxIdx = 2 + capPaths.length + (wmPath ? 1 : 0) + (showCredit ? 1 : 0);
        args.push("-stream_loop", "-1", "-t", String(duration), "-i", sfxPath);
        const sfxVol = typeof s.sfxVolume === "number" ? Math.min(1, Math.max(0, s.sfxVolume)) : 0.35;
        // amix 는 입력 수(2)로 볼륨을 반씩 줄인다 → 미리 2배로 올려 상쇄(목소리 원음 유지,
        // 효과음은 지정 볼륨). normalize 옵션 없이 써서 구버전 ffmpeg 도 호환.
        filterFull =
          `${filter};[1:a]volume=2[voca];[${sfxIdx}:a]volume=${(sfxVol * 2).toFixed(2)}[sfxa];` +
          `[voca][sfxa]amix=inputs=2:duration=longest[aout]`;
        audioMap = "[aout]";
      }
      args.push(
        "-filter_complex", filterFull,
        "-map", "[v]", "-map", audioMap,
        "-t", String(duration),
        "-r", String(FPS),
        // v6 검증 설정(8씬 70초 완성). 단일스레드/ultrafast 는 오히려 매달려서 제거.
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        out
      );
      await log(`씬 ${i + 1}: 인코딩 (캡션 ${capPaths.length}개, ${duration.toFixed(1)}s)…`);
      await run("ffmpeg", args);
      await log(`씬 ${i + 1}: 완료`);
      sceneFiles.push(out);
    }

    // 이어붙이기 — 씬들이 동일 코덱/파라미터라 재인코딩 없이 무손실 복사(빠름).
    await log("이어붙이기(무손실 copy)…");
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, sceneFiles.map((f) => `file '${f}'`).join("\n"), "utf8");
    const finalPath = join(dir, "final.mp4");
    await run("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-movflags", "+faststart",
      finalPath,
    ]);

    await log("Blob 업로드…");
    // 스트리밍 업로드 — 최종 영상을 통째로 메모리에 읽지 않는다(OOM 방지).
    const { url } = await put(
      `project/${projectId}/${clean ? "clean" : "final"}-${lang}-${Date.now()}.mp4`,
      createReadStream(finalPath),
      { access: "public", contentType: "video/mp4", addRandomSuffix: false }
    );

    const p2 = await getProject(projectId);
    if (p2) {
      // 클린 합성본은 별도 보관 — 정식 합성본(finalVideoUrl)을 덮지 않는다.
      if (clean) p2.cleanVideoUrl = url;
      else p2.finalVideoUrl = url;
      p2.steps.compose.status = "generated";
      p2.steps.compose.error = undefined;
      p2.steps.compose.updatedAt = Date.now();
      p2.updatedAt = Date.now();
      await saveProject(p2);
    }
    return url;
  } catch (e) {
    const p2 = await getProject(projectId);
    if (p2) {
      p2.steps.compose.status = "error";
      p2.steps.compose.error = String(e?.message ?? e);
      p2.steps.compose.updatedAt = Date.now();
      await saveProject(p2);
    }
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
