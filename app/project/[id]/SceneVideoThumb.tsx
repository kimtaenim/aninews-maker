"use client";

import { useEffect, useRef } from "react";

// 씬 영상 썸네일 — 그리드의 영상을 전부 autoPlay 하면 크롬이 무거워진다(동시 디코딩 + 전부 다운로드).
// 그래서: 화면에 보일 때만 재생하고, 벗어나면 멈춘다(IntersectionObserver).
// 보이기 전엔 preload="none" 이라 네트워크도 안 쓰고, 씬 이미지를 poster 로 깔아 화면은 그대로 보인다.
export default function SceneVideoThumb({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // IntersectionObserver 미지원 환경(구형)에서는 그냥 재생 — 기존 동작으로 폴백.
    if (typeof IntersectionObserver === "undefined") {
      el.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) el.play().catch(() => {});
          else el.pause();
        }
      },
      { threshold: 0.25 } // 4분의 1 이상 보이면 재생
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      className={className}
      loop
      muted
      playsInline
      preload="none"
    />
  );
}
