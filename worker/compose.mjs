// 최종 합성 — 씬별로 (영상 길이를 음성에 맞춰 슬로모션/트림) + 음성 + 자막 번인 →
// 이어붙이기 → mp4 → Blob. lang="ko"|"en" 으로 어느 판을 구울지 결정.
import { getProject, saveProject } from "./store.mjs";
import { put } from "@vercel/blob";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// 자막 줄바꿈(최대 2줄). 공백 있으면 중간 공백에서, 없으면 글자수로.
function wrapSubtitle(text, perLine = 18) {
  const t = (text ?? "").trim();
  if (t.length <= perLine) return t;
  const sp = t.lastIndexOf(" ", perLine + 4);
  if (sp > perLine * 0.5) {
    return t.slice(0, sp) + "\n" + t.slice(sp + 1, sp + 1 + perLine * 1.6);
  }
  return t.slice(0, perLine) + "\n" + t.slice(perLine, perLine * 2);
}

export async function composeProject(projectId, lang) {
  const project = await getProject(projectId);
  if (!project) throw new Error("프로젝트를 찾을 수 없어요");
  const scenes = (project.scenes ?? []).filter((s) => s.videoUrl);
  if (scenes.length === 0) throw new Error("비디오가 있는 씬이 없어요");

  const sub = project.subtitle ?? {
    font: "sans", weight: "regular", size: "medium",
    position: "bottom", align: "center", box: "dark", lang: "ko",
  };
  const fontFamily = sub.font === "serif" ? "Noto Serif CJK KR" : "Noto Sans CJK KR";
  const fontsize = sub.size === "small" ? 54 : sub.size === "large" ? 84 : 66;
  const fontcolor = sub.box === "light" ? "black" : "white";
  const boxcolor = sub.box === "light" ? "white@0.85" : "black@0.6";
  const x = sub.align === "left" ? "80" : "(w-text_w)/2";
  const y = sub.position === "top" ? "h*0.04" : "h-text_h-h*0.04";

  const dir = await mkdtemp(join(tmpdir(), "compose-"));
  try {
    const sceneFiles = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const vPath = join(dir, `v${i}.mp4`);
      await download(s.videoUrl, vPath);

      const audioUrl = lang === "en" ? s.audioUrlEn : s.audioUrl;
      let aPath = null;
      if (audioUrl) {
        aPath = join(dir, `a${i}.mp3`);
        await download(audioUrl, aPath);
      }

      const vd = await probeDuration(vPath);
      const ad = aPath ? await probeDuration(aPath) : 0;
      const target = ad > 0 ? ad : s.durationSec || vd || 5;
      // 음성이 영상보다 길면 영상을 슬로모션으로(루프 X). 짧으면 트림(-t).
      const speed = vd > 0 && target > vd ? target / vd : 1;

      const text = (lang === "en" ? s.narrationEn || s.narration : s.narration) ?? "";
      const subPath = join(dir, `s${i}.txt`);
      await writeFile(subPath, wrapSubtitle(text), "utf8");

      const vf =
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setpts=${speed.toFixed(4)}*PTS,fps=${FPS},` +
        `drawtext=font='${fontFamily}':textfile='${subPath}':fontsize=${fontsize}:` +
        `fontcolor=${fontcolor}:box=1:boxcolor=${boxcolor}:boxborderw=18:line_spacing=10:` +
        `x=${x}:y=${y}`;

      const out = join(dir, `scene${i}.mp4`);
      const args = ["-y", "-i", vPath];
      if (aPath) args.push("-i", aPath);
      else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
      args.push(
        "-filter_complex", `[0:v]${vf}[v]`,
        "-map", "[v]", "-map", "1:a",
        "-t", String(target),
        "-r", String(FPS),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        out
      );
      await run("ffmpeg", args);
      sceneFiles.push(out);
    }

    // 이어붙이기 (재인코딩 — 씬 파라미터를 동일하게 맞췄지만 안전하게).
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, sceneFiles.map((f) => `file '${f}'`).join("\n"), "utf8");
    const finalPath = join(dir, "final.mp4");
    await run("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      finalPath,
    ]);

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
