// ============================================================================
// 에셋 저장소 추상화 (이미지 / 영상 / 오디오)
// ----------------------------------------------------------------------------
// 시작은 Vercel Blob (cardnews-maker 와 동일). 영상 용량·비용이 커지면 여기
// 한 모듈만 R2/S3 구현으로 갈아끼우면 되도록 호출부는 이 함수들만 쓴다.
//
// access: "public" — blob.url 이 그대로 공개 URL 이라 <img src> 에 바로 쓸 수
// 있다(프록시 불필요). pathname 에 타임스탬프를 넣어 유니크하게 하므로 캐시
// 충돌·덮어쓰기 문제도 없다.
// ============================================================================

import { put, del, list } from "@vercel/blob";

export async function uploadAsset(
  pathname: string,
  data: ArrayBuffer | Buffer | Blob | string,
  contentType: string
) {
  return put(pathname, data, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
}

export { del as deleteAsset, list as listAssets };
