import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";

// 사용자 업로드(참조 이미지 / 직접 이미지 / 직접 영상)용 Blob 클라이언트 업로드 핸들러.
// 브라우저가 @vercel/blob/client 의 upload()로 파일을 Blob 에 직접 올린다(서버리스 본문
// 4.5MB 한계 우회 — 영상이 클 수 있어 필수). 이 라우트는 토큰 발급/완료 콜백만 담당.
const ALLOWED = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];
const MAX_BYTES = 300 * 1024 * 1024; // 300MB (직접 촬영 영상 여유)

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED,
        addRandomSuffix: true, // 같은 파일명 충돌 방지(클라이언트 pathname 그대로 사용)
        maximumSizeInBytes: MAX_BYTES,
      }),
      // 업로드 완료 후처리 없음 — 클라이언트가 받은 blob.url 을 /api/scene/source 로 저장.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (e) {
    const error = e instanceof Error ? e.message : "업로드 실패";
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
}
