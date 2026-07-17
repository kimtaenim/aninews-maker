"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// 씬 영상 썸네일 — 그리드 영상을 전부 autoPlay 하면 크롬이 무거워진다(동시 디코딩 + 전부 다운로드).
// 그래서 "한 줄(row)만" 재생한다: 화면에 여러 줄이 보여도 가장 잘 보이는 한 줄만 play.
// 2열이면 2개, 3열이면 3개만 동시에 재생. 보이기 전엔 preload="none" 이라 네트워크도 안 쓰고,
// 씬 이미지를 poster 로 깔아 화면은 그대로 보인다.

// 그리드의 실제 열 수 + 지금 재생할 줄(row)을 계산한다. 열 수는 CSS grid 계산값에서 읽어
// 반응형(2열↔3열)이 바뀌어도 따라간다. 화면에 걸친 줄 중 뷰포트 중앙에 가장 가까운 줄을 고르고,
// 그리드가 화면 밖이면 -1(아무것도 재생 안 함).
export function useActiveRow(containerRef: RefObject<HTMLElement | null>, itemCount: number) {
  const [state, setState] = useState<{ cols: number; activeRow: number }>({
    cols: 1,
    activeRow: -1,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const measure = () => {
      const cont = containerRef.current;
      if (!cont) return;
      const cols = Math.max(
        1,
        getComputedStyle(cont)
          .gridTemplateColumns.split(" ")
          .filter((v) => v && v !== "none").length
      );
      const items = Array.from(cont.children) as HTMLElement[];
      if (items.length === 0) return;
      const rows = Math.ceil(items.length / cols);
      const vpH = window.innerHeight;
      const vpCenter = vpH / 2;

      let best = -1;
      let bestDist = Infinity;
      for (let r = 0; r < rows; r++) {
        const first = items[r * cols];
        if (!first) continue;
        const rect = first.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= vpH) continue; // 화면 밖 줄은 후보 제외
        const dist = Math.abs(rect.top + rect.height / 2 - vpCenter);
        if (dist < bestDist) {
          bestDist = dist;
          best = r;
        }
      }
      setState((s) => (s.cols === cols && s.activeRow === best ? s : { cols, activeRow: best }));
    };

    // 스크롤/리사이즈에서 바로 측정한다(측정은 rect 몇 개라 가볍고, setState 는 값이 바뀔 때만
    // 리렌더한다). rAF 스로틀은 안 쓴다 — 백그라운드 탭에서 rAF 가 멈춰 갱신이 끊길 수 있어서.
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, itemCount]);

  return state;
}

export default function SceneVideoThumb({
  src,
  poster,
  className,
  play,
}: {
  src: string;
  poster?: string;
  className?: string;
  play: boolean; // 이 씬이 "지금 재생할 줄"에 있는지 — 부모(useActiveRow)가 정한다
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (play) el.play().catch(() => {});
    else el.pause();
  }, [play]);

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
