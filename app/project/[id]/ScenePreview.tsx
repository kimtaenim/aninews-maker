"use client";

import { useMemo, useRef, useState } from "react";
import { resolveSubtitleStyle } from "@/lib/subtitle";
import { segmentCaptions } from "@/lib/captions";
import { splitRuns, stripMarks } from "@/lib/emphasis";
import { resolveCaptionRecipe } from "@/lib/captionPresets";
import CaptionControls from "./CaptionControls";
import type { SubtitleSettings } from "@/lib/types";

// 씬 미리보기 — 영상 + 음성 동기 재생 + 자막(캡션) 오버레이.
// 긴 나레이션은 캡션으로 분할(합성과 동일 segmentCaptions)해 재생 중 순차로 보여준다.
// 캡션당 3초 기본(음성이 짧으면 균등 분할). 음성이 마스터.
export default function ScenePreview({
  index,
  videoUrl,
  audioUrl,
  subtitle,
  subtitleEn,
  sub,
  captionStyle,
  onCaptionStyle,
  onSaveLines,
  onReRecord,
}: {
  index: number;
  videoUrl?: string;
  audioUrl?: string;
  subtitle: string;
  subtitleEn?: string;
  sub: SubtitleSettings;
  captionStyle?: string;
  onCaptionStyle?: (id: string) => void;
  onSaveLines?: (text: string) => void; // 자막 줄바꿈(행) 편집 저장 — 결과는 다시 싱크됨
  onReRecord?: () => void; // 음성 다시 녹음 — 6단계 그 씬으로 이동
}) {
  const st = resolveSubtitleStyle(sub);
  const recipe = resolveCaptionRecipe(sub, captionStyle);
  const FONT_CSS: Record<string, string> = {
    serif: "var(--font-noto-serif-kr), 'Noto Serif KR', serif",
    hand: "var(--font-nanum-pen), 'Nanum Pen Script', cursive",
    impact: "var(--font-black-han), 'Black Han Sans', sans-serif",
    romance: "var(--font-song-myung), 'Song Myung', serif",
    brush: "var(--font-nanum-brush), 'Nanum Brush Script', cursive",
    jua: "var(--font-jua), 'Jua', sans-serif",
    retro: "var(--font-kirang), 'Kirang Haerang', cursive",
  };
  const fontFamily = FONT_CSS[recipe.font] ?? "var(--font-noto-sans-kr), sans-serif";
  const koCaps = useMemo(() => segmentCaptions(subtitle, sub.size), [subtitle, sub.size]);
  const enCaps = useMemo(
    () => segmentCaptions(subtitleEn || subtitle, sub.size),
    [subtitleEn, subtitle, sub.size]
  );
  // 인덱싱 기준 캡션 수(주 언어).
  const capCount = (sub.lang === "en" ? enCaps : koCaps).length || 1;

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [capIdx, setCapIdx] = useState(0);
  // 자막 줄 조절(행 편집) — 열면 현재 자막을 초기값으로. 저장하면 위 미리보기가 다시 싱크됨.
  const [editLines, setEditLines] = useState(false);
  const [draft, setDraft] = useState(subtitle);

  // 현재 캡션(언어별).
  const lines =
    sub.lang === "en"
      ? [enCaps[capIdx] ?? ""]
      : sub.lang === "both"
        ? [koCaps[capIdx] ?? "", enCaps[capIdx] ?? ""].filter(Boolean)
        : [koCaps[capIdx] ?? ""];

  // 비례 타이밍 — worker(compose.mjs)와 동일 공식. 캡션을 글자수에 비례해 음성
  // 길이에 배분, 캡션당 최소 1.2초. capEnds[j] = 캡션 j 의 종료 시각(초).
  const primaryCaps = sub.lang === "en" ? enCaps : koCaps;
  function capEnds(duration: number): number[] {
    const MIN_CAP = 1.2;
    const weights = primaryCaps.map((c) => Math.max(1, stripMarks(c).replace(/\s/g, "").length));
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const ends: number[] = [];
    let acc = 0;
    for (const w of weights) {
      acc += Math.max(MIN_CAP, (duration * w) / wSum);
      ends.push(acc);
    }
    return ends;
  }

  function onTime() {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const ends = capEnds(a.duration);
    let idx = ends.findIndex((e) => a.currentTime < e);
    if (idx < 0) idx = capCount - 1;
    setCapIdx(Math.min(capCount - 1, idx));
  }

  function play() {
    const v = videoRef.current;
    const a = audioRef.current;
    setCapIdx(0);
    if (a) {
      a.currentTime = 0;
      if (v) {
        v.currentTime = 0;
        const vd = v.duration;
        const ad = a.duration;
        v.playbackRate = vd > 0 && ad > 0 && ad > vd ? Math.max(0.25, vd / ad) : 1;
        v.play().catch(() => {});
      }
      a.play().catch(() => {});
      setPlaying(true);
    } else if (v) {
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
      {/* 프레임을 컨테이너로 — 자막을 cqw(컨테이너폭 %)로 그려 1080폭 합성과 같은 비율. */}
      <div
        className="relative aspect-[9/16] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-black"
        style={{ containerType: "inline-size" }}
      >
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
        {/* 자막 오버레이 (현재 캡션). 워커와 동일: 각진 박스·91%폭·비례 폰트/패딩. */}
        <div className={`absolute inset-x-0 ${st.alignClass}`} style={st.containerPos}>
          <span
            style={{
              fontFamily,
              fontSize: `${st.fontCqw}cqw`,
              lineHeight: 1.3,
              padding: `${st.fontCqw * 0.28}cqw ${st.fontCqw * 0.45}cqw`,
              maxWidth: "91cqw",
              fontWeight: recipe.weight,
              color: recipe.textColor,
              background: recipe.box === "solid" ? recipe.boxFill : "transparent",
              borderRadius:
                recipe.box === "solid" && recipe.radiusRel
                  ? recipe.radiusRel >= 1
                    ? "9999px"
                    : `${st.fontCqw * recipe.radiusRel}cqw`
                  : undefined,
              textShadow: recipe.outline
                ? "0 0 0.35cqw rgba(0,0,0,0.95), 0 0 0.7cqw rgba(0,0,0,0.85), 0 0.15cqw 0.3cqw rgba(0,0,0,0.9)"
                : undefined,
            }}
            className="inline-block"
          >
            {lines.map((l, idx) => (
              <span key={idx} className="block line-clamp-3">
                {splitRuns(l).map((r, k) =>
                  r.em ? (
                    <span
                      key={k}
                      style={{ fontSize: "1.3em", fontWeight: 700, color: recipe.emColor }}
                    >
                      {r.t}
                    </span>
                  ) : (
                    <span key={k}>{r.t}</span>
                  )
                )}
              </span>
            ))}
          </span>
        </div>
      </div>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={onTime}
          onEnded={stop}
          className="hidden"
        />
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

      {/* 자막 줄 조절(행 편집) + 다시 녹음. 줄바꿈(Enter)이 자막 캡션 경계 → 저장하면 위
          미리보기가 그 줄 나눔으로 다시 싱크된다. 다시 녹음은 6단계 그 씬으로 보낸다. */}
      {(onSaveLines || onReRecord) && (
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {onSaveLines && (
              <button
                type="button"
                onClick={() => {
                  setDraft(subtitle);
                  setEditLines((v) => !v);
                }}
                className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                {editLines ? "− 닫기" : "✏️ 자막 줄 조절"}
              </button>
            )}
            {onReRecord && (
              <button
                type="button"
                onClick={onReRecord}
                title="이 씬의 음성(6단계)으로 이동해서 다시 녹음·생성할 수 있어요"
                className="text-[11px] rounded-md border border-accent text-accent px-2 py-0.5 hover:bg-accent/10"
              >
                🎙️ 다시 녹음
              </button>
            )}
          </div>
          {editLines && onSaveLines && (
            <div className="grid gap-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const t = draft.replace(/^\n+|\n+$/g, "");
                    if (!t.trim()) return;
                    onSaveLines(t);
                    setEditLines(false);
                  }}
                  className="text-[11px] rounded-md bg-accent hover:bg-accent-strong text-white font-medium px-2.5 py-0.5"
                >
                  저장 (싱크 반영)
                </button>
                <span className="text-[10px] text-zinc-400">
                  ⏎ Enter = 자막 줄 나눔 (음성엔 영향 없음). 저장하면 위 미리보기가 다시 싱크돼요.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 자막 스타일 프리셋(위 미리보기·최종 합성에 즉시 반영). 강조는 2단계에서 [[ ]]로. */}
      {onCaptionStyle && (
        <CaptionControls captionStyle={captionStyle} onStyle={onCaptionStyle} />
      )}
      {!audioUrl && (
        <span className="text-[10px] text-zinc-400">음성 없음(6단계에서 생성)</span>
      )}
    </li>
  );
}
