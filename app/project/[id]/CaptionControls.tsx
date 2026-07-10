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
  const anyEm = toks.some((t) => !t.space && t.em);

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] text-zinc-400">강조</span>
        {anyWord ? (
          toks.map((t, i) =>
            t.space ? null : (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => onNarration(toggleWordEmphasis(narration, i))}
                className={
                  "rounded px-1.5 py-0.5 text-[12px] border transition-colors disabled:opacity-40 " +
                  (t.em
                    ? "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500/60 dark:bg-amber-900/40 dark:text-amber-200 font-medium"
                    : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900")
                }
              >
                {t.text}
              </button>
            )
          )
        ) : (
          <span className="text-[10px] text-zinc-400">나레이션을 입력하면 단어가 여기 나와요</span>
        )}
        {anyWord && !anyEm && (
          <span className="ml-1 text-[10px] text-zinc-400">← 크게 강조할 단어를 누르세요</span>
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
