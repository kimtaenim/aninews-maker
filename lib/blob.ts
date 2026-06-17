// ============================================================================
// 에셋 저장소 추상화 (이미지 / 영상 / 오디오)
// ----------------------------------------------------------------------------
// Vercel Blob 사용. 운영(Vercel)에서는 Blob 스토어를 프로젝트에 연결하면
// BLOB_READ_WRITE_TOKEN 이 자동 주입되어 put() 이 그 값을 읽는다.
// access:"public" → blob.url 이 그대로 공개 URL 이라 <img src> 에 바로 쓴다.
// 나중에 R2/S3 로 갈아끼울 때도 이 모듈만 고치면 된다.
// ============================================================================

import { put, del, list } from "@vercel/blob";

export interface UploadedAsset {
  url: string;
}

export async function uploadAsset(
  pathname: string,
  data: ArrayBuffer | Buffer | Blob | string,
  contentType: string
): Promise<UploadedAsset> {
  const r = await put(pathname, data as Buffer | Blob | string, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
  return { url: r.url };
}

export { del as deleteAsset, list as listAssets };
