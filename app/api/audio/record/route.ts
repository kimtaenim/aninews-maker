import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { canStart } from "@/lib/stepMachine";
import { uploadAsset } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

// 6. voiceover (녹음) — 사용자가 마이크로 녹음한 오디오를 그대로 씬 음성(audioUrl)으로 저장.
// TTS 와 같은 서버 경로(uploadAsset)라 /api/upload 허용목록과 무관. 재녹음은 새 URL 로 덮어씀.
// multipart/form-data: { projectId, sceneIndex, audio(File) }
const ALLOWED = [
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
  "audio/x-m4a",
  "audio/aac",
];
const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};
const MAX_BYTES = 20 * 1024 * 1024; // 한 씬 녹음은 작음(수백 KB). 여유 20MB.

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid form-data" }, { status: 400 });
  }

  const projectId = String(form.get("projectId") ?? "").trim();
  const sceneIndex = Number(form.get("sceneIndex"));
  const file = form.get("audio");
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  if (!Number.isInteger(sceneIndex)) {
    return NextResponse.json({ ok: false, error: "sceneIndex 필요" }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "audio 파일 필요" }, { status: 400 });
  }

  const type = (file.type || "audio/webm").split(";")[0].trim().toLowerCase();
  if (!ALLOWED.includes(type)) {
    return NextResponse.json({ ok: false, error: `지원하지 않는 오디오 형식: ${type}` }, { status: 422 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "빈 녹음이에요" }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "녹음 파일이 너무 커요" }, { status: 413 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (!canStart(project, "voiceover")) {
    return NextResponse.json({ ok: false, error: "키프레임 단계를 먼저 승인해주세요" }, { status: 409 });
  }
  if (sceneIndex < 0 || sceneIndex >= project.scenes.length) {
    return NextResponse.json({ ok: false, error: "sceneIndex 범위 밖" }, { status: 422 });
  }
  if (project.scenes[sceneIndex]?.skipped) {
    return NextResponse.json({ ok: false, error: "건너뛴 씬이에요" }, { status: 422 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = EXT[type] ?? "webm";
  const { url } = await uploadAsset(
    `project/${projectId}/scene-${sceneIndex}-rec-${Date.now()}.${ext}`,
    bytes,
    type
  );

  // 합성·이미지 등 동시 저장이 있을 수 있으니 최신 재읽기 후 audio 필드만 머지(상호 덮어쓰기 방지).
  const fresh = (await getProject(projectId)) ?? project;
  const fScene = fresh.scenes[sceneIndex] ?? project.scenes[sceneIndex];
  fresh.scenes[sceneIndex] = { ...fScene, audioUrl: url, status: "generated" };
  const allDone = fresh.scenes.every((s) => s.skipped || !!s.audioUrl);
  fresh.steps.voiceover.status = allDone ? "generated" : "generating";
  fresh.steps.voiceover.updatedAt = Date.now();
  fresh.updatedAt = Date.now();
  await saveProject(fresh);

  return NextResponse.json({ ok: true, url, sceneIndex, allDone });
}
