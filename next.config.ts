import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 워크스페이스 루트를 이 디렉터리로 고정. 부모 C:\myapps 에 떠도는
  // package-lock.json 이 있어 Turbopack 이 lockfile 을 위로 거슬러 올라가며
  // C:\myapps 를 루트로 오인식 → @import "tailwindcss"(Tailwind v4) 를 못 찾고
  // dev 가 OOM 으로 죽는 문제 방지. (cardnews-maker 와 동일한 가드.)
  turbopack: {
    root: __dirname,
  },
  // [롱폼 모듈 5] 썸네일 글씨 합성이 런타임에 한글 굵은 폰트 파일을 읽는다(next/og 에 버퍼로
  // 주입). 서버리스 번들에 폰트가 안 들어가면 배포에서만 깨지므로 트레이싱에 명시.
  outputFileTracingIncludes: {
    "/api/longform/thumbnail": ["./worker/fonts/BlackHanSans-Regular.ttf"],
  },
};

export default nextConfig;
