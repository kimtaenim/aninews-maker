"use client";

import { useRef, useState } from "react";
import { resolveSubtitleStyle } from "@/lib/subtitle";
import type { SubtitleSettings } from "@/lib/types";

// 씬 미리보기 — 영상(루프) + 음성 동기 재생 + 자막(나레이션) 오버레이.
// 정확한 길이 정렬(홀드/트림)은 최종 worker(ffmpeg)가 하고, 여기선 근사 미리보기.
// 음성이 마스터: 재생하면 영상은 루프로 음성 길이를 채우고, 음성이 끝나면 멈춘다.
export default function ScenePreview({
  index,
  videoUrl,
  audioUrl,
  subtitle,
  subtitleEn,
  sub,
}: {
  index: number;
  videoUrl?: string;
  audioUrl?: string;
  subtitle: string;
  subtitleEn?: string;
  sub: SubtitleSettings;
}) {
  const st = resolveSubtitleStyle(sub);
  // 언어 설정에 따라 표시할 줄
  const lines =
    sub.lang === "en"
      ? [subtitleEn || subtitle]
      : sub.lang === "both"
        ? [subtitle, subtitleEn || ""].filter(Boolean)
        : [subtitle];
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  function play() {
    const v = videoRef.current;
    const a = audioRef.current;
    if (a) {
      a.currentTime = 0;
      if (v) {
        v.currentTime = 0;
        // 영상이 음성보다 짧으면 루프 대신 '천천히'(슬로모션)로 길이를 채움.
        const vd = v.duration;
        const ad = a.duration;
        v.playbackRate =
          vd > 0 && ad > 0 && ad > vd ? Math.max(0.25, vd / ad) : 1;
        v.play().catch(() => {});
      }
      a.play().catch(() => {});
      setPlaying(true);
    } else if (v) {
      // 음성 없으면 영상만 한 번 재생
      v.currentTime = 0;
      v.playbackRate = 1;
      v.play().catch(() => {});
      setPlaying(true);
    }
  }

  function stop() {
    audioRef.current?.pause();
    videoRef.current?.pause();
    setPlaying(false);
  }

  return (
    <li className="grid gap-1.5">
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-black">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-zinc-400">
            영상 없음
          </div>
        )}
        {/* 자막 오버레이 (프로젝트 자막 설정 반영) */}
        <div className={`absolute inset-x-2 ${st.containerPosClass} ${st.alignClass}`}>
          <span
            style={{ fontFamily: st.fontFamily }}
            className={`inline-block rounded px-2 py-1 leading-snug ${st.weightClass} ${st.sizeClass} ${st.boxClass}`}
          >
            {lines.map((l, idx) => (
              <span key={idx} className="block line-clamp-2">
                {l}
              </span>
            ))}
          </span>
        </div>
      </div>

      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} onEnded={stop} className="hidden" />
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">씬 {index + 1}</span>
        <button
          type="button"
          onClick={playing ? stop : play}
          disabled={!videoUrl}
          className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
        >
          {playing ? "■ 정지" : "▶ 재생"}
        </button>
      </div>
      {!audioUrl && (
        <span className="text-[10px] text-zinc-400">음성 없음(6단계에서 생성)</span>
      )}
    </li>
  );
}
