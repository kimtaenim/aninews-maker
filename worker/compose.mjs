// 최종 합성 — 씬별로 (영상 길이를 음성에 맞춰 슬로모션/트림) + 음성 + 자막 번인 →
// 이어붙이기 → mp4 → Blob. lang="ko"|"en" 으로 어느 판을 구울지 결정.
import { getProject, saveProject } from "./store.mjs";
import { put } from "@vercel/blob";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { segmentCaptions } from "./captions.mjs";
import { renderCaptionPng } from "./subtitle-image.mjs";

const W = 1080;
const H = 1920;
const FPS = 30;

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) =>
      c === 0 ? res() : rej(new Error(`${cmd} exit ${c}: ${err.slice(-700)}`))
    );
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
  // stderr 로 즉시 flush 되는 진행 로그 — 어디서 멈추는지 한 줄씩 보이게.
  const log = (...a) => console.error("[worker]", ...a);
  log("composeProject 진입 — getProject 호출…");
  const project = await getProject(projectId);
  if (!project) throw new Error("프로젝트를 찾을 수 없어요");
  const scenes = (project.scenes ?? []).filter((s) => s.videoUrl);
  log(`프로젝트 로드됨 — 비디오 있는 씬 ${scenes.length}개`);
  if (scenes.length === 0) throw new Error("비디오가 있는 씬이 없어요");

  const sub = project.subtitle ?? {
    font: "sans", weight: "regular", size: "medium",
    position: "bottom", align: "center", box: "dark", lang: "ko",
  };
  console.log(
    `[worker] 렌더러=캡션PNG 오버레이(미리보기와 동일 디자인·캡션 분할) + cover-crop, 씬 ${scenes.length}개, lang=${lang}`
  );
  const dir = await mkdtemp(join(tmpdir(), "compose-"));
  try {
    const sceneFiles = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const vPath = join(dir, `v${i}.mp4`);
      log(`씬 ${i + 1}/${scenes.length}: 영상 다운로드…`);
      await download(s.videoUrl, vPath);

      const audioUrl = lang === "en" ? s.audioUrlEn : s.audioUrl;
      let aPath = null;
      if (audioUrl) {
        aPath = join(dir, `a${i}.mp3`);
        await download(audioUrl, aPath);
      }

      const vd = await probeDuration(vPath);
      const ad = aPath ? await probeDuration(aPath) : 0;
      const audioLen = ad > 0 ? ad : s.durationSec || vd || 5;

      const text = (lang === "en" ? s.narrationEn || s.narration : s.narration) ?? "";
      // 긴 나레이션은 캡션 여러 개로 분할(미리보기와 동일 알고리즘) → 씬 안에서 순차 표시.
      const caps = segmentCaptions(text, sub.size);
      // 각 캡션을 미리보기와 같은 디자인의 전체프레임 투명 PNG로 렌더.
      const capPaths = [];
      for (let j = 0; j < caps.length; j++) {
        const png = await renderCaptionPng(caps[j], sub, { W, H });
        const cp = join(dir, `cap${i}_${j}.png`);
        await writeFile(cp, png);
        capPaths.push(cp);
      }
      // 캡션당 3초 보장. 캡션 수×3초가 음성보다 길면 장면을 그만큼 늘린다(음성은 끝까지).
      const PER = 3;
      const duration = capPaths.length
        ? Math.max(audioLen, capPaths.length * PER)
        : audioLen;
      // 음성/자막이 영상보다 길면 영상을 슬로모션으로 늘림(루프 X).
      const speed = vd > 0 && duration > vd ? duration / vd : 1;
      const spans = [];
      let acc = 0;
      capPaths.forEach((_, j) => {
        const start = acc;
        acc += PER;
        const end = j === capPaths.length - 1 ? duration + 0.5 : acc;
        spans.push([start, end]);
      });

      // 미리보기(object-cover)와 동일: 9:16 꽉 채우고 가운데 크롭(검은 테두리 없음).
      const base =
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},setpts=${speed.toFixed(4)}*PTS,fps=${FPS}`;
      // 자막 PNG들을 시간 구간별로 오버레이(앞 0=video, 1=audio, 2..=png).
      let filter;
      if (capPaths.length === 0) {
        filter = `${base}[v]`;
      } else {
        filter = `${base}[bg]`;
        let prev = "bg";
        capPaths.forEach((_, j) => {
          const inIdx = 2 + j;
          const label = j === capPaths.length - 1 ? "v" : `o${j}`;
          const [st, en] = spans[j];
          filter +=
            `;[${prev}][${inIdx}:v]overlay=0:0:` +
            `enable='between(t,${st.toFixed(3)},${en.toFixed(3)})'[${label}]`;
          prev = label;
        });
      }

      const out = join(dir, `scene${i}.mp4`);
      const args = ["-y", "-i", vPath];
      if (aPath) args.push("-i", aPath);
      else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
      for (const cp of capPaths) args.push("-i", cp);
      args.push(
        "-filter_complex", filter,
        "-map", "[v]", "-map", "1:a",
        "-t", String(duration),
        "-r", String(FPS),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        out
      );
      log(`씬 ${i + 1}: 인코딩 (캡션 ${capPaths.length}개, ${duration.toFixed(1)}s)…`);
      await run("ffmpeg", args);
      log(`씬 ${i + 1}: 완료`);
      sceneFiles.push(out);
    }

    // 이어붙이기 — 씬들이 동일 코덱/파라미터라 재인코딩 없이 무손실 복사(빠름).
    log("이어붙이기(무손실 copy)…");
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, sceneFiles.map((f) => `file '${f}'`).join("\n"), "utf8");
    const finalPath = join(dir, "final.mp4");
    await run("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-movflags", "+faststart",
      finalPath,
    ]);

    log("Blob 업로드…");
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
