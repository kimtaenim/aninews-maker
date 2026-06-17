import { NextResponse } from "next/server";

// 3. keyframe — 씬0 키프레임 1장으로 스타일·인물·팔레트 확정. 이후 전 씬의
// 레퍼런스가 된다. style profile 의 image_bible 주입.
// TODO: getOpenAI() images.generate(IMAGE_SIZE) → uploadAsset → project.keyframeUrl
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
