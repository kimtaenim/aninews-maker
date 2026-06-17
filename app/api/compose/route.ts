import { NextResponse } from "next/server";

// 7. compose — ffmpeg 합성은 Vercel 한계를 넘으므로 worker 에 위임만 한다.
// 클립 이어붙이기 + 보이스오버 + BGM. 음성에 영상이 느슨하게 따라가게(끝프레임
// 홀드·연장), 오디오 속도 워핑 금지. 스톱모션 프로필이면 post_fx 프레임 스테핑.
// TODO: enqueueJob({ type:"compose", projectId, payload:{ scenes, ttsEnabled, styleProfileId } })
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
