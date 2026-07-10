"use client";

import { wordTokens, toggleWordEmphasis } from "@/lib/emphasis";
import { CAPTION_STYLES } from "@/lib/captionPresets";

// 자막 편집 공용 컨트롤 — 2단계·미리보기 두 곳에서 같이 쓴다.
//  - 단어 칩을 누르면 그 단어 강조를 토글([[ ]] 삽입/제거) → onNarration 으로 새 문자열 전달.
//  - 스타일 칩(기본/강조박스/감성명조/말풍선) → onStyle 로 프리셋 id 전달.
// 상태는 부모가 project.scenes 로 들고 있고, 이 컴포넌트는 그걸 그려주고 콜백만 쏜다.
export default function CaptionControls({
  narration,
  captionStyle,
  onNarration,
  onStyle,
  disabled,
}: {
  narration: string;
  captionStyle?: string;
  onNarration: (next: string) => void;
  onStyle: (id: string) => void;
  disabled?: boolean;
}) {
  const toks = wordTokens(narration ?? "");
  const anyWord = toks.some((t) => !t.space);

  return (
    <div className="grid gap-1.5">
      {/* 자막을 문장 그대로 보여주고, 단어를 눌러 강조 토글(강조=골드·굵게 인라인 표시). */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 px-2 py-1.5 text-[13px] leading-relaxed">
        <span className="mr-1 select-none text-[10px] text-zinc-400">강조 (단어 클릭)</span>{" "}
        {anyWord ? (
          toks.map((t, i) =>
            t.space ? (
              <span key={i}>{t.text}</span>
            ) : (
              <span
                key={i}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onClick={() => !disabled && onNarration(toggleWordEmphasis(narration, i))}
                onKeyDown={(e) => {
                  if (!disabled && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onNarration(toggleWordEmphasis(narration, i));
                  }
                }}
                className={
                  "cursor-pointer rounded-sm " +
                  (t.em
                    ? "font-bold text-amber-600 dark:text-amber-400"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-amber-100/70 dark:hover:bg-amber-900/30")
                }
              >
                {t.text}
              </span>
            )
          )
        ) : (
          <span className="text-[10px] text-zinc-400">나레이션을 입력하면 여기서 단어를 눌러 강조할 수 있어요</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] text-zinc-400">스타일</span>
        {CAPTION_STYLES.map(([id, label]) => {
          const active = (captionStyle ?? "") === id;
          return (
            <button
              key={id || "default"}
              type="button"
              disabled={disabled}
              onClick={() => onStyle(id)}
              className={
                "rounded-md px-2 py-0.5 text-[11px] border transition-colors disabled:opacity-40 " +
                (active
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900")
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
