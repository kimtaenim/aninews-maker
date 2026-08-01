"use client";

import { useState } from "react";
import type { Chipset, ChipsetStage } from "@/lib/chipsets";
import { CHIPSET_LABEL_MAX, CHIPSET_TEXT_MAX } from "@/lib/chipsets";

// 단계별 사용자 칩셋 줄 — 등록해 두면 다음 프로젝트에서도 그대로 뜬다.
// 코드에 박힌 기본 칩(스타일 칩·카메라 프리셋) 옆에 붙여 쓴다. 여러 개 동시에 켤 수 있다.
export default function ChipsetRow({
  stage,
  chipsets,
  activeIds,
  onToggle,
  onAdd,
  onDelete,
  disabled,
  hint,
}: {
  stage: ChipsetStage;
  chipsets: Chipset[];
  activeIds: string[];
  onToggle: (c: Chipset) => void;
  onAdd: (input: { stage: ChipsetStage; label: string; text: string }) => Promise<string | null>;
  onDelete: (id: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mine = chipsets.filter((c) => c.stage === stage);
  const active = new Set(activeIds);

  async function submit() {
    setBusy(true);
    setErr(null);
    const e = await onAdd({ stage, label, text });
    setBusy(false);
    if (e) {
      setErr(e);
      return;
    }
    setLabel("");
    setText("");
    setOpen(false);
  }

  return (
    <div className="grid gap-1">
      <span className="text-[10px] text-zinc-400">
        🧩 내 칩셋{hint ? ` — ${hint}` : ""} (등록해 두면 다음 영상에서도 그대로 뜹니다)
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {mine.map((c) => {
          const on = active.has(c.id);
          return (
            <span key={c.id} className="group relative inline-flex">
              <button
                type="button"
                onClick={() => onToggle(c)}
                disabled={disabled}
                title={c.text}
                className={`text-[10px] rounded-md border pl-1.5 pr-4 py-0.5 disabled:opacity-40 ${
                  on
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                {c.label}
              </button>
              {/* 삭제는 칩 안 오른쪽 작은 ✕ — 목록이 길어져도 정리할 수 있게. */}
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                title={`"${c.label}" 칩 삭제`}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 px-0.5 text-[9px] leading-none text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-500"
              >
                ✕
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] rounded-md border border-dashed border-zinc-400 dark:border-zinc-600 px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          {open ? "취소" : "+ 칩 등록"}
        </button>
      </div>
      {open && (
        <div className="grid gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={CHIPSET_LABEL_MAX}
            placeholder="칩 이름 (예: 황금 팔레트, 거대 금화, 주인공)"
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-accent"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={CHIPSET_TEXT_MAX}
            rows={2}
            placeholder="프롬프트에 붙을 내용 (예: 짙은 남색 배경에 금색 포인트, 채도 낮게)"
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-accent resize-y"
          />
          {err && <p className="text-[10px] text-red-500">{err}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !label.trim() || !text.trim()}
            className="justify-self-start rounded-md bg-accent hover:bg-accent-strong disabled:opacity-40 px-2.5 py-1 text-[11px] font-medium text-white"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </div>
  );
}
