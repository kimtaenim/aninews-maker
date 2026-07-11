"use client";

import { CAPTION_STYLES } from "@/lib/captionPresets";

// 자막 스타일 프리셋 칩 — 2단계·미리보기 두 곳에서 같이 쓴다.
// (강조는 나레이션에 [[ ]] 를 직접 입력 — 단어 클릭 방식은 제거됨.)
export default function CaptionControls({
  captionStyle,
  onStyle,
  disabled,
}: {
  captionStyle?: string;
  onStyle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[10px] text-zinc-400">자막 스타일</span>
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
  );
}
