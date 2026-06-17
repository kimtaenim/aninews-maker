import { NextResponse } from "next/server";

// 6. voiceover (선택) — ElevenLabs TTS. 단어 타임스탬프를 받아 자막 타이밍 소스로.
// 오디오 속도 워핑 금지. project.ttsEnabled 가 false 면 단계 스킵.
// TODO: synthesize(narration) → uploadAsset(audio) → scene.audioUrl + ttsTimestamps
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
