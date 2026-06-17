import { NextResponse } from "next/server";

// 4. images — 씬별 이미지. 키프레임을 레퍼런스(edits)로 넣어 일관성 유지, 9:16.
// (3. keyframe 는 ../keyframe/route.ts, 씬0 1장으로 스타일 확정 후 여기로.)
// TODO: getOpenAI() images.edit with keyframe ref → uploadAsset() → scene.imageUrl
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
