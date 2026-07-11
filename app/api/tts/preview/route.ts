import { NextRequest, NextResponse } from "next/server";
import { synthesize } from "@/lib/tts";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST { provider, voiceId?, text? } → 그 목소리로 짧은 샘플을 합성해 오디오(mp3)로 반환.
// 목소리 선택 시 귀로 확인용. voiceId 가 비면 그 엔진의 env 기본 목소리로 미리듣기.
const SAMPLE = "안녕하세요. 이 목소리로 뉴스 영상이 만들어집니다. 어떤가요?";

export async function POST(req: NextRequest) {
  let body: { provider?: string; voiceId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const provider = (body.provider ?? "").trim();
  const voiceId = (body.voiceId ?? "").trim();
  const text = (typeof body.text === "string" && body.text.trim() ? body.text : SAMPLE).slice(0, 300);

  try {
    const { audioBuffer } = await synthesize({
      text,
      lang: "ko",
      provider,
      voiceId: voiceId || undefined, // 비면 엔진 env 기본 목소리
    });
    return new Response(Buffer.from(audioBuffer), {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "미리듣기 실패" },
      { status: 500 }
    );
  }
}
