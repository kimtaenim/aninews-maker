import { NextResponse } from "next/server";

// 8. subtitle — (선택)번역 + 자막 번인. 타이밍은 TTS 타임스탬프 기준.
// 한글 폰트(Pretendard·Noto Sans KR) 등록. 번인은 worker(ffmpeg).
// TODO: (Claude 번역) → enqueueJob({ type:"subtitle", payload:{ words, finalVideoUrl, locale } })
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
