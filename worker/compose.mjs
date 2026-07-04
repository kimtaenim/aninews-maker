// 최종 합성 — 씬별로 (영상 길이를 음성에 맞춰 슬로모션/트림) + 음성 + 자막 번인 →
// 이어붙이기 → mp4 → Blob. lang="ko" 또는 더빙 언어(en/es/ja…)로 어느 판을 구울지 결정.
// 다국어판 트랙은 scene.dub[lang] 에 있고, 기존 영어판은 narrationEn/audioUrlEn 에 폴백.
import { getProject, saveProject, logProgress, resetProgress } from "./store.mjs";
import { put } from "@vercel/blob";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { segmentCaptions } from "./captions.mjs";
import { renderCaptionPng, renderWatermarkPng, renderCreditPng } from "./subtitle-image.mjs";

const W = 1080;
const H = 1920;
const FPS = 30;

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
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

export async function composeProject(projectId, lang) {
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
  const scenes = (project.scenes ?? []).filter((s) => s.videoUrl && !s.skipped);
  await log(`프로젝트 로드됨 — 비디오 있는 씬 ${scenes.length}개`);
  if (scenes.length === 0) throw new Error("비디오가 있는 씬이 없어요");

  const sub = project.subtitle ?? {
    font: "sans", weight: "regular", size: "small",
    position: "three-quarters", align: "center", box: "dark", lang: "ko",
  };
  console.log(
    `[worker] 렌더러=캡션PNG 오버레이(미리보기와 동일 디자인·캡션 분할) + cover-crop, 씬 ${scenes.length}개, lang=${lang}`
  );
  const dir = await mkdtemp(join(tmpdir(), "compose-"));
  try {
    // 워터마크는 모든 씬에 동일하게 들어가므로 한 번만 렌더(전체프레임 투명 PNG).
    let wmPath = null;
    if (project.watermark?.text?.trim()) {
      const wmPng = await renderWatermarkPng(project.watermark, { W, H });
      wmPath = join(dir, "watermark.png");
      await writeFile(wmPath, wmPng);
      await log(`워터마크 "${project.watermark.text}" (${project.watermark.position})`);
    }
    // 제작 크레딧 — 마지막 2씬에만. 워터마크 위치 기준 옆에 1.5배로. (워터마크 유무와 무관)
    let creditPath = null;
    const creditName = (project.credit ?? "").trim();
    if (creditName) {
      const cPng = await renderCreditPng(creditName, project.watermark ?? { position: "br" }, { W, H });
      creditPath = join(dir, "credit.png");
      await writeFile(creditPath, cPng);
      await log(`제작 크레딧 "${creditName}" (마지막 2씬)`);
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

      const vd = await probeDuration(vPath);
      const ad = aPath ? await probeDuration(aPath) : 0;
      const audioLen = ad > 0 ? ad : s.durationSec || vd || 5;

      const dubText =
        lang === "ko" ? "" : s.dub?.[lang]?.narration ?? (lang === "en" ? s.narrationEn : "");
      const text = (lang === "ko" ? s.narration : dubText || s.narration) ?? "";
      // 긴 나레이션은 캡션 여러 개로 분할(미리보기와 동일 알고리즘) → 씬 안에서 순차 표시.
      const caps = segmentCaptions(text, sub.size);
      await log(`씬 ${i + 1}: 자막 캡션 ${caps.length}컷 렌더(canvas)…`);
      // 각 캡션을 미리보기와 같은 디자인의 전체프레임 투명 PNG로 렌더.
      const capPaths = [];
      for (let j = 0; j < caps.length; j++) {
        const png = await renderCaptionPng(caps[j], sub, { W, H });
        const cp = join(dir, `cap${i}_${j}.png`);
        await writeFile(cp, png);
        capPaths.push(cp);
      }
      // 비례 타이밍: 캡션을 글자수에 비례해 음성 길이에 배분(음성이 마스터) → 자막이
      // 말 속도를 따라간다. 너무 짧으면 못 읽으니 캡션당 최소 1.2초 보장. 최소시간 합이
      // 음성보다 길면(짧은 음성에 캡션 多) 그만큼 장면을 늘린다. 미리보기와 동일 공식.
      const MIN_CAP = 1.2;
      const weights = caps.map((c) => Math.max(1, c.replace(/\s/g, "").length));
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
      // 제작 크레딧: 마지막 2씬에만. 입력 순서는 (자막들 → 워터마크 → 크레딧).
      const showCredit = creditPath && i >= scenes.length - 2;
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
      if (aPath) args.push("-i", aPath);
      else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
      // 자막 PNG는 -loop 1 로 연속 스트림화(단일 프레임 입력 + overlay 체인은 데드락).
      // 출력 -t 가 전체 길이를 제한하므로 입력은 무한 루프로 둬도 안전(v6 검증됨).
      for (const cp of capPaths) args.push("-loop", "1", "-framerate", String(FPS), "-i", cp);
      if (wmPath) args.push("-loop", "1", "-framerate", String(FPS), "-i", wmPath);
      if (showCredit) args.push("-loop", "1", "-framerate", String(FPS), "-i", creditPath);
      args.push(
        "-filter_complex", filter,
        "-map", "[v]", "-map", "1:a",
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
    const bytes = await readFile(finalPath);
    const { url } = await put(
      `project/${projectId}/final-${lang}-${Date.now()}.mp4`,
      bytes,
      { access: "public", contentType: "video/mp4", addRandomSuffix: false }
    );

    const p2 = await getProject(projectId);
    if (p2) {
      p2.finalVideoUrl = url;
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
