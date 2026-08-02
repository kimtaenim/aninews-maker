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
import {
  renderCaptionPng,
  renderWatermarkPng,
  renderCreditPng,
  mergePngLayers,
} from "./subtitle-image.mjs";

// 오버레이 타임라인(캡션들 + 정적 레이어)을 concat demuxer 목록 파일 1개로 굽는다.
// 왜: 예전엔 캡션 1컷 = ffmpeg 입력 1개(-loop 1)였다. -loop 입력은 프레임마다 PNG 를 다시
// 디코딩하므로 비용이 (씬 길이 × 30fps × 캡션 수)로 길이의 제곱이 됐다 — 실측 2.5fps,
// 씬 14초에서 150초 타임아웃 절벽. concat 목록이면 입력 1개·오버레이 1단·PNG 디코드는
// 컷당 1회라 비용이 길이에 선형이 된다. 구간이 0부터 빈틈없이 이어져야 한다(캡션 배분이 그렇다).
async function writeOverlayConcat(entries, listPath) {
  if (entries.length === 0) return null;
  const q = (p) => `file '${p.replace(/'/g, "'\\''")}'`;
  const lines = ["ffconcat version 1.0"];
  for (const e of entries) {
    lines.push(q(e.path), `duration ${e.duration.toFixed(3)}`);
  }
  // concat demuxer 는 마지막 항목의 duration 을 무시한다 — 같은 파일을 한 번 더 적어야
  // 마지막 컷이 제 길이만큼 남는다(공식 문서에 명시된 우회).
  lines.push(q(entries[entries.length - 1].path));
  await writeFile(listPath, lines.join("\n"), "utf8");
  return listPath;
}

// 캡션 구간 → concat 항목. 마지막 컷은 씬 끝까지 남긴다(예전 enable 이 duration+0.5 였던 것과 동일).
function overlayEntries(paths, durs, duration) {
  const out = [];
  let acc = 0;
  paths.forEach((p, j) => {
    const last = j === paths.length - 1;
    const d = last ? Math.max(durs[j], duration - acc) + 0.5 : durs[j];
    acc += durs[j];
    out.push({ path: p, duration: d });
  });
  return out;
}

// 합성 캔버스 해상도는 프로젝트 포맷에 따라 결정(composeProject 안에서). 세로 숏폼
// 1080x1920, 가로 롱폼 1920x1080. 두 해상도는 픽셀 수가 같아 인코딩 부하도 동일.
// (lib/format.ts 가 앱 쪽 단일 원천 — 워커는 .mjs 라 같은 값을 여기 인라인으로 둔다.)
// 30fps — v6 에서 검증된 값. 24fps 로 바꿨더니 -loop 자막 오버레이 체인이 데드락(매달림)나서
// 복구. (인코딩 속도는 워커 인스턴스 상향으로 해결 — FPS 로 억지로 줄이지 않는다.)
const FPS = 30;

// 지금 돌고 있는 자식 프로세스들 — 상위(index.mjs)의 합성 타임아웃이 이걸 실제로 죽인다.
// Promise.race 만으로는 진 쪽이 취소되지 않아 버려진 합성이 ffmpeg 를 계속 돌렸고, 다음
// 잡의 ffmpeg 와 겹쳐 메모리가 두 배가 됐다(OOM 유발 경로).
const activeChildren = new Set();
export function abortActiveWork() {
  let n = 0;
  for (const p of activeChildren) {
    try {
      p.kill("SIGKILL");
      n++;
    } catch {}
  }
  activeChildren.clear();
  return n;
}

// 타임아웃 기본 150초. 씬이 길면 호출자가 길이에 비례해 넉넉히 준다(sceneTimeout).
// stderr 은 상한을 둬서 무한 누적을 막고, stdout 은 아예 안 연다 — 파이프가 차서
// 영구 블록되는 "매달림" 경로를 없앤다(ffmpeg 진행 로그는 stderr 로 나온다).
const ERR_KEEP = 4000;
function run(cmd, args, timeoutMs = 150000) {
  return new Promise((res, rej) => {
    let p;
    try {
      p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      rej(e);
      return;
    }
    activeChildren.add(p);
    let err = "";
    const done = (fn, arg) => {
      clearTimeout(timer);
      activeChildren.delete(p);
      fn(arg);
    };
    const timer = setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {}
      done(
        rej,
        new Error(
          `${cmd} 타임아웃(${Math.round(timeoutMs / 1000)}초) — 매달림. ffmpeg 마지막 출력: ${err.slice(-500)}`
        )
      );
    }, timeoutMs);
    p.stderr.on("data", (d) => {
      err += d;
      if (err.length > ERR_KEEP * 2) err = err.slice(-ERR_KEEP);
    });
    p.on("error", (e) => done(rej, e));
    p.on("close", (c, sig) =>
      c === 0
        ? done(res, undefined)
        : done(
            rej,
            new Error(
              `${cmd} exit ${c}${sig ? ` (신호 ${sig} — 메모리 부족으로 강제 종료됐을 수 있음)` : ""}: ${err.slice(-700)}`
            )
          )
    );
  });
}

// 씬 하나에 허용할 ffmpeg 시간 — 길이에 비례(초당 8초, 최소 150초, 최대 8분).
// 예전엔 150초 고정이라 인코딩이 느려지면 긴 씬이 무조건 절벽에서 죽었다.
function sceneTimeout(durationSec) {
  return Math.min(480000, Math.max(150000, Math.round(durationSec * 8000)));
}

// ffprobe — 'error' 리스너가 없으면 spawn 실패(메모리 부족 시의 ENOMEM/EAGAIN 등)가
// uncaught exception 이 되어 워커 프로세스를 통째로 죽인다. 타임아웃도 없으면 영원히 pending.
function probeDuration(file, timeoutMs = 30000) {
  return new Promise((res) => {
    let p;
    try {
      p = spawn("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", file,
      ]);
    } catch {
      res(0);
      return;
    }
    activeChildren.add(p);
    let out = "";
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(p);
      res(v);
    };
    const timer = setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {}
      finish(0);
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => finish(0));
    p.on("close", () => finish(parseFloat(out.trim()) || 0));
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
  // 자막 오버레이는 concat 목록 1개(씬 루프와 동일 이유 — 캡션당 입력은 길이의 제곱 비용).
  const ovList = await writeOverlayConcat(
    overlayEntries(capPaths, durs, duration),
    join(dir, `${tag}-ov.txt`)
  );
  const baseF =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `crop=${W}:${H},setpts=${speed.toFixed(4)}*PTS,fps=${FPS}`;
  const fadeSt = Math.max(0, duration - FADE_SEC).toFixed(2);
  const vfade = `fade=t=out:st=${fadeSt}:d=${FADE_SEC}`;
  const filter =
    (ovList ? `${baseF}[bg];[bg][2:v]overlay=0:0,${vfade}[v]` : `${baseF},${vfade}[v]`) +
    `;[1:a]afade=t=out:st=${fadeSt}:d=${FADE_SEC}[aud]`;
  const out = join(dir, `${tag}.mp4`);
  const args = ["-y", "-i", vPath];
  if (aPath) args.push("-i", aPath);
  else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  if (ovList) args.push("-f", "concat", "-safe", "0", "-i", ovList);
  args.push(
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[aud]",
    "-t", String(duration), "-r", String(FPS),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    out
  );
  await run("ffmpeg", args, sceneTimeout(duration));
  return out;
}

// 롱폼 자막 기본값(진행자 없을 때 폴백).
function defaultLongSub(project) {
  return project.subtitle ?? {
    font: "sans", weight: "regular", size: "small",
    position: "two-thirds", align: "center", box: "dark", lang: "ko",
  };
}

// [롱폼] 진행자 프로젝트 씬을 슬롯별로 수집 — videoUrl 없는(미생성) 씬은 건너뜀.
//   hostConnectors 는 connectorAfter(전역 세그먼트 인덱스, 0-based) → scene 맵.
async function collectHostScenes(project, fallbackSub) {
  const hostOpening = [];
  const hostConnectors = new Map();
  const hostClosing = [];
  let hostSub = fallbackSub;
  if (project.hostProjectId) {
    const host = await getProject(project.hostProjectId);
    if (host) {
      hostSub = host.subtitle ?? fallbackSub;
      for (const s of host.scenes ?? []) {
        if (!s.videoUrl) continue;
        if (s.hostSlot === "opening") hostOpening.push(s);
        else if (s.hostSlot === "connector") hostConnectors.set(s.connectorAfter ?? 0, s);
        else if (s.hostSlot === "closing") hostClosing.push(s);
      }
    }
  }
  return { hostOpening, hostConnectors, hostClosing, hostSub };
}

// 세그먼트 완성본(finalVideoUrl) 다운로드 → 로컬 경로 반환.
async function downloadSegment(segId, idx, total, dir, log) {
  const sp = await getProject(segId);
  const url = sp?.finalVideoUrl;
  if (!url) throw new Error(`세그먼트 ${idx + 1}(${segId}) 완성본(finalVideoUrl)이 없어요`);
  const f = join(dir, `seg-${segId}.mp4`);
  await log(`세그먼트 ${idx + 1}/${total} 다운로드…`);
  await download(url, f);
  return f;
}

// [부 전환 휴식] 오프닝↔세그먼트↔진행자↔엔딩 사이 페이드아웃 + 0.4초 검은 쉼 —
// 너무 빨리 넘어가 보기 불편하다는 지적(2026-08-02). 진행자 씬끼리(오프닝 1→2,
// 답→구독)는 이어지는 말이라 붙여 둔다.
// 0.7초로 상향(2026-08-02 지시) — 영상·음성·자막 모두 같이 쉰다: 쉼 클립이 검은 화면
// +무음 트랙을 함께 갖고, concat 의 오디오 무음 채움이 타임라인을 1:1 로 고정한다.
const GAP_SEC = 0.7;
const FADE_SEC = 0.4;

async function makeGapClip(dir, W, H) {
  const out = join(dir, "gap.mp4");
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=${FPS}:d=${GAP_SEC}`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", String(GAP_SEC),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    out,
  ]);
  return out;
}

// 부(部) 꼬리 페이드아웃 — 세그먼트 완성본은 무손실 복사 대상이라 여기서 한 번만 재인코딩.
// (섹션 영상 꼬리는 섹션 합성 때 이미 페이드된 세그 꼬리라 최종 join 에선 다시 안 건다.)
async function fadeTail(src, dir, tag, log) {
  const d = await probeDuration(src);
  if (!d || d < FADE_SEC + 0.2) return src;
  const st = (d - FADE_SEC).toFixed(2);
  const out = join(dir, `${tag}-fade.mp4`);
  if (log) await log(`꼬리 페이드아웃(${tag})…`);
  await run("ffmpeg", [
    "-y", "-i", src,
    "-vf", `fade=t=out:st=${st}:d=${FADE_SEC}`,
    "-af", `afade=t=out:st=${st}:d=${FADE_SEC}`,
    "-r", String(FPS),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    out,
  ], sceneTimeout(d));
  return out;
}

// 진행자 씬끼리만 붙이고, 부가 바뀌는 모든 자리엔 검은 쉼을 끼운다.
function interleaveGaps(entries, gapPath) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && !(entries[i - 1].kind === "host" && entries[i].kind === "host")) out.push(gapPath);
    out.push(entries[i].f);
  }
  return out;
}

// concat 리스트 작성 + 무손실 이어붙이기 → 로컬 out 경로 반환.
async function concatClips(order, dir, log, outName = "final.mp4") {
  const listPath = join(dir, `list-${outName}.txt`);
  await writeFile(listPath, order.map((f) => `file '${f}'`).join("\n"), "utf8");
  const finalPath = join(dir, outName);
  // 비디오는 무손실 copy, 오디오만 재인코딩 — 각 조각의 오디오가 비디오보다 몇십 ms 짧아
  // 생기는 타임스탬프 구멍을 진짜 무음으로 채운다(aresample async). 구멍을 무시하는
  // 플레이어에서 조각 수만큼 누적돼 뒤로 갈수록 음성이 앞서던 싱크 밀림의 근본 수정
  // (2026-08-02 — 끝부분 1.4초까지 벌어진 실측).
  await log("이어붙이기(비디오 무손실 + 오디오 싱크 고정)…");
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c:v", "copy",
    "-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    finalPath,
  ]);
  // [검증 게이트] 결과 길이 = 입력 길이 합인지 대조 — 어긋난 결과물을 성공인 척 저장해
  // 사용자에게 보내는 사고 차단(2026-08-02). 프로브가 0(실패)이면 검증 불가라 건너뛴다
  // (가짜 실패로 정상 합성을 죽이지 않기 위해).
  const inDur = [];
  for (const f of order) inDur.push(await probeDuration(f));
  const expected = inDur.reduce((a, b) => a + b, 0);
  const actual = await probeDuration(finalPath);
  if (actual > 0 && inDur.every((d) => d > 0)) {
    const tol = Math.max(2, expected * 0.01);
    if (Math.abs(actual - expected) > tol) {
      throw new Error(
        `이어붙이기 길이 검증 실패 — 결과 ${actual.toFixed(1)}초 ≠ 기대 ${expected.toFixed(1)}초(입력 ${order.length}개 합). 결과물을 저장하지 않았어요.`
      );
    }
    await log(`길이 검증 통과 — ${actual.toFixed(1)}초 (기대 ${expected.toFixed(1)}초)`);
  } else {
    await log("길이 검증 건너뜀 — ffprobe 실패(합성 자체는 계속)");
  }
  return finalPath;
}

// 최종 합성본 업로드 + 저장 — 저장 직전 fresh 재읽기 후 finalVideoUrl 만 머지(통째 저장 금지).
async function uploadAndSaveFinal(project, lang, finalPath, log) {
  await log("Blob 업로드…");
  // multipart — 대용량을 조각으로 나눠 조각 단위 재시도. 통짜 스트림은 업로드가 순간
  // 실패해 SDK가 재시도할 때 이미 소진된 스트림을 못 다시 읽어 "Response body …
  // disturbed or locked"로 죽는다(2026-08-02 join 사고).
  const { url } = await put(
    `project/${project.id}/final-${lang}-${Date.now()}.mp4`,
    createReadStream(finalPath),
    { access: "public", contentType: "video/mp4", addRandomSuffix: false, multipart: true }
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
  return url;
}

// 섹션 결과를 저장 — fresh 재읽기 후 해당 섹션 필드만 머지(통째 저장 금지 규약).
async function saveSectionResult(projectId, sectionId, patch) {
  const p = await getProject(projectId);
  if (!p || !Array.isArray(p.sections)) return;
  const sec = p.sections.find((s) => s.id === sectionId);
  if (!sec) return;
  Object.assign(sec, patch, { updatedAt: Date.now() });
  p.updatedAt = Date.now();
  await saveProject(p);
}

// [롱폼] 교차 합성(레거시 단일 경로) — 진행자 오프닝 → [세그먼트 → 진행자 연결] 반복 →
// 마지막 세그먼트 뒤 진행자 마무리(구독). 섹션이 없는 롱폼(구버전)에서만 사용.
// 진행자 씬은 렌더, 세그먼트는 완성본 사용. 모두 동일 파라미터라 -c copy.
async function runLongformConcat(project, lang, dir, log, W, H) {
  const segIds = project.sourceProjectIds ?? [];
  if (segIds.length === 0) throw new Error("롱폼에 세그먼트(sourceProjectIds)가 없어요");
  const sub = defaultLongSub(project);
  const { hostOpening, hostConnectors, hostClosing, hostSub } = await collectHostScenes(project, sub);
  await log(`진행자 씬 — 오프닝 ${hostOpening.length}·연결 ${hostConnectors.size}·마무리 ${hostClosing.length}`);

  const segFiles = [];
  for (let i = 0; i < segIds.length; i++) {
    segFiles.push(await downloadSegment(segIds[i], i, segIds.length, dir, log));
  }

  const gap = await makeGapClip(dir, W, H);
  const entries = [];
  let oi = 0;
  for (const s of hostOpening) {
    await log(`오프닝 진행자 씬 렌더 ${oi + 1}/${hostOpening.length}…`);
    entries.push({ f: await renderHostSceneClip(s, dir, `open${oi++}`, hostSub, W, H), kind: "host" });
  }
  for (let i = 0; i < segFiles.length; i++) {
    entries.push({ f: await fadeTail(segFiles[i], dir, `seg${i}`, log), kind: "seg" });
    const conn = hostConnectors.get(i);
    if (conn) {
      await log(`연결 진행자 씬 렌더(세그 ${i + 1} 뒤)…`);
      entries.push({ f: await renderHostSceneClip(conn, dir, `conn${i}`, hostSub, W, H), kind: "host" });
    }
  }
  let ci = 0;
  for (const s of hostClosing) {
    await log("마무리 진행자 씬 렌더…");
    entries.push({ f: await renderHostSceneClip(s, dir, `close${ci++}`, hostSub, W, H), kind: "host" });
  }

  const finalPath = await concatClips(interleaveGaps(entries, gap), dir, log);
  const url = await uploadAndSaveFinal(project, lang, finalPath, log);
  await log("롱폼 합성 완료");
  return url;
}

// [롱폼-섹션] 섹션 하나(2~3 세그 + 내부 연결)를 부분 합성 → 중간본을 Blob 에 올리고
// project.sections[k].videoUrl 에 저장. 이 잡은 그 섹션 세그먼트만 다운로드하므로
// 총 편수와 무관하게 리소스가 고정된다(OOM 안전판). 섹션 "경계" 연결은 최종 join 이 처리.
async function runLongformSectionConcat(project, sectionId, lang, dir, log, W, H) {
  const segIds = project.sourceProjectIds ?? [];
  const sections = project.sections ?? [];
  const section = sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`섹션을 찾을 수 없어요: ${sectionId}`);
  const sub = defaultLongSub(project);
  const { hostConnectors, hostSub } = await collectHostScenes(project, sub);

  // 섹션 세그먼트의 전역 인덱스(연결 위치 매핑용) — sourceProjectIds 순서 기준.
  const globalIdx = section.segmentIds.map((id) => segIds.indexOf(id));
  if (globalIdx.some((g) => g < 0)) throw new Error("섹션 세그먼트가 롱폼 소스에 없어요");
  await log(`섹션 합성 — 세그먼트 ${section.segmentIds.length}편(전역 ${globalIdx.join(",")})`);

  try {
    const gap = await makeGapClip(dir, W, H);
    const entries = [];
    for (let k = 0; k < section.segmentIds.length; k++) {
      const g = globalIdx[k];
      const segF = await downloadSegment(section.segmentIds[k], k, section.segmentIds.length, dir, log);
      entries.push({ f: await fadeTail(segF, dir, `sseg${g}`, log), kind: "seg" });
      // 내부 연결만: 섹션 마지막 세그(뒤=경계)는 건너뜀 → 경계 연결은 최종 join 이 넣는다.
      const isLastInSection = k === section.segmentIds.length - 1;
      if (!isLastInSection) {
        const conn = hostConnectors.get(g);
        if (conn) {
          await log(`연결 진행자 씬 렌더(섹션 내부, 세그 ${g + 1} 뒤)…`);
          entries.push({ f: await renderHostSceneClip(conn, dir, `conn${g}`, hostSub, W, H), kind: "host" });
        }
      }
    }
    const finalPath = await concatClips(interleaveGaps(entries, gap), dir, log, "section.mp4");
    await log("섹션 Blob 업로드…");
    const { url } = await put(
      `project/${project.id}/section-${section.id}-${lang}-${Date.now()}.mp4`,
      createReadStream(finalPath),
      { access: "public", contentType: "video/mp4", addRandomSuffix: false, multipart: true }
    );
    await saveSectionResult(project.id, section.id, { videoUrl: url, status: "generated", error: undefined });
    await log("섹션 합성 완료");
    return url;
  } catch (e) {
    await saveSectionResult(project.id, section.id, { status: "error", error: String(e?.message ?? e) });
    throw e;
  }
}

// [롱폼-최종] 섹션 영상들 + 진행자(오프닝·경계연결·마무리)를 이어붙여 finalVideoUrl 생성.
// 섹션 영상(파일 몇 개)만 다운로드하므로 가볍다. 모든 섹션이 합성(videoUrl)돼 있어야 한다.
async function runLongformJoin(project, lang, dir, log, W, H) {
  const segIds = project.sourceProjectIds ?? [];
  const sections = project.sections ?? [];
  if (sections.length === 0) throw new Error("섹션이 없어요");
  const missing = sections.filter((s) => !s.videoUrl);
  if (missing.length) {
    throw new Error(`아직 합성 안 된 섹션이 ${missing.length}개 있어요 — 섹션부터 합성해 주세요`);
  }
  const sub = defaultLongSub(project);
  const { hostOpening, hostConnectors, hostClosing, hostSub } = await collectHostScenes(project, sub);
  await log(`최종 이어붙이기 — 섹션 ${sections.length}·오프닝 ${hostOpening.length}·마무리 ${hostClosing.length}`);

  const gap = await makeGapClip(dir, W, H);
  const entries = [];
  let oi = 0;
  for (const s of hostOpening) {
    await log(`오프닝 진행자 씬 렌더 ${oi + 1}/${hostOpening.length}…`);
    entries.push({ f: await renderHostSceneClip(s, dir, `open${oi++}`, hostSub, W, H), kind: "host" });
  }
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const f = join(dir, `sec-${sec.id}.mp4`);
    await log(`섹션 ${si + 1}/${sections.length} 다운로드…`);
    await download(sec.videoUrl, f);
    // 섹션 꼬리는 섹션 합성 때 이미 페이드된 세그 꼬리 — 여기선 재인코딩하지 않는다.
    entries.push({ f, kind: "seg" });
    // 경계 연결: 이 섹션 마지막 세그의 전역 인덱스 뒤 연결(섹션 합성에서 건너뛴 것).
    const lastG = segIds.indexOf(sec.segmentIds[sec.segmentIds.length - 1]);
    const conn = hostConnectors.get(lastG);
    if (conn) {
      await log(`경계 연결 진행자 씬 렌더(섹션 ${si + 1} 뒤)…`);
      entries.push({ f: await renderHostSceneClip(conn, dir, `bconn${si}`, hostSub, W, H), kind: "host" });
    }
  }
  let ci = 0;
  for (const s of hostClosing) {
    await log("마무리 진행자 씬 렌더…");
    entries.push({ f: await renderHostSceneClip(s, dir, `close${ci++}`, hostSub, W, H), kind: "host" });
  }

  const finalPath = await concatClips(interleaveGaps(entries, gap), dir, log);
  const url = await uploadAndSaveFinal(project, lang, finalPath, log);
  await log("롱폼 최종 합성 완료");
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
  // 섹션 합성 잡 판별 — payload.sectionId(섹션 부분 합성) / payload.joinSections(최종 이어붙이기).
  const sectionId = typeof opts?.sectionId === "string" ? opts.sectionId : null;
  const wantJoin = opts?.joinSections === true;
  const hasSections = Array.isArray(project.sections) && project.sections.length > 0;
  if (isLongform) {
    if (sectionId) await log(`롱폼 섹션 부분 합성 — sectionId=${sectionId}`);
    else if (wantJoin || hasSections) await log(`롱폼 최종 이어붙이기 — 섹션 ${project.sections?.length ?? 0}개`);
    else await log(`롱폼 합성(레거시 단일) — 세그먼트 ${project.sourceProjectIds.length}개`);
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
    // 롱폼: 세그먼트 완성본을 이어붙이는 경량 경로(씬 재인코딩 없음).
    //  · sectionId  → 섹션 하나만 부분 합성(그 섹션 세그먼트만 다운로드 → 리소스 고정).
    //  · joinSections/섹션 존재 → 섹션 영상들을 최종 이어붙이기.
    //  · 둘 다 아님(섹션 없는 구버전) → 레거시 단일 교차 합성.
    if (isLongform) {
      if (sectionId) {
        const url = await runLongformSectionConcat(project, sectionId, lang, dir, log, W, H);
        return url;
      }
      if (wantJoin || hasSections) {
        const url = await runLongformJoin(project, lang, dir, log, W, H);
        return url;
      }
      const url = await runLongformConcat(project, lang, dir, log, W, H);
      return url;
    }
    if (clean) await log("클린 합성 모드 — 보이스·자막·효과음·워터마크 제외(영상만)");
    // 워터마크·크레딧은 모든 씬에 동일하게 들어가므로 한 번만 렌더(전체프레임 투명 PNG).
    // 파일이 아니라 버퍼로 들고 있다가 씬마다 캡션 PNG 에 미리 합성한다 — ffmpeg 입력을
    // 늘리지 않으려고(입력 1개 = 매 프레임 풀프레임 디코드 1회).
    let wmPng = null;
    if (!clean && project.watermark?.text?.trim()) {
      wmPng = await renderWatermarkPng(project.watermark, { W, H });
      await log(`워터마크 "${project.watermark.text}" (${project.watermark.position})`);
    }
    // 제작 크레딧 — 마지막 3씬에만. 워터마크 위치 기준 옆에 1.5배로. (워터마크 유무와 무관)
    const CREDIT_LAST_SCENES = 3; // 크레딧을 노출할 끝 씬 개수
    let creditPng = null;
    const creditName = clean ? "" : (project.credit ?? "").trim();
    if (creditName) {
      creditPng = await renderCreditPng(creditName, project.watermark ?? { position: "br" }, { W, H });
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
      // 비례 타이밍: 캡션을 글자수에 비례해 음성 길이에 배분(음성이 마스터) → 자막이
      // 말 속도를 따라간다. 너무 짧으면 못 읽으니 캡션당 최소 1.2초 보장. 최소시간 합이
      // 음성보다 길면(짧은 음성에 캡션 多) 그만큼 장면을 늘린다. 미리보기와 동일 공식.
      const MIN_CAP = 1.2;
      const weights = caps.map((c) => Math.max(1, stripMarks(c).replace(/\s/g, "").length));
      const wSum = weights.reduce((a, b) => a + b, 0) || 1;
      const durs = weights.map((w) => Math.max(MIN_CAP, (audioLen * w) / wSum));
      const capTotal = durs.reduce((a, b) => a + b, 0);
      const duration = caps.length ? Math.max(audioLen, capTotal) : audioLen;
      // 음성/자막이 영상보다 길면 영상을 슬로모션으로 늘림(루프 X).
      const speed = vd > 0 && duration > vd ? duration / vd : 1;

      // 정적 레이어(워터마크 + 마지막 N씬 크레딧)는 캡션 PNG 에 미리 합성한다 — 입력을 안 늘리려고.
      const showCredit = creditPng && i >= scenes.length - CREDIT_LAST_SCENES;
      const staticPng = await mergePngLayers([wmPng, showCredit ? creditPng : null], { W, H });

      await log(`씬 ${i + 1}: 자막 캡션 ${caps.length}컷 렌더(canvas)…`);
      // 각 캡션을 미리보기와 같은 디자인의 전체프레임 투명 PNG로 렌더(정적 레이어 합성 포함).
      const capPaths = [];
      for (let j = 0; j < caps.length; j++) {
        const png = await renderCaptionPng(caps[j], sub, { W, H, preset: s.captionStyle });
        const cp = join(dir, `cap${i}_${j}.png`);
        await writeFile(cp, await mergePngLayers([png, staticPng], { W, H }));
        capPaths.push(cp);
      }
      // 오버레이 입력은 항상 1개(캡션 concat). 자막 없는 씬(분위기 씬 등)이라도 워터마크·
      // 크레딧이 있으면 그 한 장을 씬 길이만큼 깔아 같은 경로로 처리한다.
      let ovEntries = overlayEntries(capPaths, durs, duration);
      if (ovEntries.length === 0 && staticPng) {
        const sp = join(dir, `static${i}.png`);
        await writeFile(sp, staticPng);
        ovEntries = [{ path: sp, duration: duration + 0.5 }];
      }
      const ovList = await writeOverlayConcat(ovEntries, join(dir, `ov${i}.txt`));

      // 미리보기(object-cover)와 동일: 9:16 꽉 채우고 가운데 크롭(검은 테두리 없음).
      const base =
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},setpts=${speed.toFixed(4)}*PTS,fps=${FPS}`;
      // 입력은 0=video, 1=audio, 2=오버레이 concat(있으면), 그 뒤=효과음.
      const filter = ovList ? `${base}[bg];[bg][2:v]overlay=0:0[v]` : `${base}[v]`;

      const out = join(dir, `scene${i}.mp4`);
      const args = ["-y", "-i", vPath];
      // 클린 모드: 음성 파일은 길이 측정에만 쓰고 트랙엔 안 싣는다(무음) — 타이밍 동일 유지.
      if (aPath && !clean) args.push("-i", aPath);
      else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
      if (ovList) args.push("-f", "concat", "-safe", "0", "-i", ovList);
      // [cliche] 효과음 믹싱 — 목소리(1:a) 밑에 효과음을 볼륨 낮춰 amix. sfx 입력은 -stream_loop
      // 로 반복하되 -t 로 씬 길이만큼만 읽어 유한하게(무한 입력 + amix=longest 는 매달림 위험).
      let filterFull = filter;
      let audioMap = "1:a";
      if (sfxPath) {
        const sfxIdx = ovList ? 3 : 2;
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
      await run("ffmpeg", args, sceneTimeout(duration));
      await log(`씬 ${i + 1}: 완료`);
      sceneFiles.push(out);
    }

    // 이어붙이기 — 씬들이 동일 코덱/파라미터라 재인코딩 없이 무손실 복사(빠름).
    await log("이어붙이기(무손실 copy)…");
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, sceneFiles.map((f) => `file '${f}'`).join("\n"), "utf8");
    const finalPath = join(dir, "final.mp4");
    // 비디오 무손실 + 오디오 재인코딩(무음 채움) — 씬마다 오디오가 비디오보다 몇십 ms
    // 짧아 누적되던 싱크 밀림 수정(위 concatClips 와 같은 원리).
    await run("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:v", "copy",
      "-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      finalPath,
    ]);

    await log("Blob 업로드…");
    // 스트리밍 업로드 — 최종 영상을 통째로 메모리에 읽지 않는다(OOM 방지).
    const { url } = await put(
      `project/${projectId}/${clean ? "clean" : "final"}-${lang}-${Date.now()}.mp4`,
      createReadStream(finalPath),
      { access: "public", contentType: "video/mp4", addRandomSuffix: false, multipart: true }
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
