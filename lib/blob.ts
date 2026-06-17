// ============================================================================
// 에셋 저장소 추상화 (이미지 / 영상 / 오디오)
// ----------------------------------------------------------------------------
// 시작은 Vercel Blob (cardnews-maker 와 동일). 영상 용량·비용이 커지면 여기
// 한 모듈만 R2/S3 구현으로 갈아끼우면 되도록 호출부는 이 함수들만 쓴다.
// ============================================================================

import { put, del, list } from "@vercel/blob";

export async function uploadAsset(
  pathname: string,
  data: ArrayBuffer | Blob | string,
  contentType: string
) {
  return put(pathname, data, {
    access: "private",
    contentType,
    addRandomSuffix: false,
  });
}

export { del as deleteAsset, list as listAssets };
