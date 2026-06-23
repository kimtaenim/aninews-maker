"use client";

import { useRef, useState } from "react";

// 네이티브 <audio controls> 는 모바일 Safari/Chrome 에서 최소 폭(~320px)을 강제해
// w-full/max-w-full 로도 못 줄인다 → 부모가 viewport 밖으로 늘어나 가로 스크롤 발생.
// 폭을 flex+min-w-0 로 완전히 제어하는 커스텀 미니 플레이어로 대체(네이티브 컨트롤 X).
export default function MiniAudio({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  }

  // 진행 바 클릭 → 해당 위치로 시킹.
  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = ref.current;
    if (!a || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * dur;
    setCur(a.currentTime);
  }

  const pct = dur > 0 ? (cur / dur) * 100 : 0;

  return (
    <div className={`flex w-full min-w-0 items-center gap-2 ${className}`}>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "일시정지" : "재생"}
        className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] text-white hover:bg-accent-strong"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div
        onClick={seek}
        className="h-1.5 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 w-9 text-right text-[10px] tabular-nums text-zinc-500">
        {fmt(cur)}
      </span>
    </div>
  );
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
