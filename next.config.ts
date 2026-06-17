import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 워크스페이스 루트를 이 디렉터리로 고정. 부모 C:\myapps 에 떠도는
  // package-lock.json 이 있어 Turbopack 이 lockfile 을 위로 거슬러 올라가며
  // C:\myapps 를 루트로 오인식 → @import "tailwindcss"(Tailwind v4) 를 못 찾고
  // dev 가 OOM 으로 죽는 문제 방지. (cardnews-maker 와 동일한 가드.)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
