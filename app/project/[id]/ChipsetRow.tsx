"use client";

import { useRef, useState } from "react";
import type { Chipset, ChipsetStage } from "@/lib/chipsets";
import { CHIPSET_LABEL_MAX, CHIPSET_TEXT_MAX } from "@/lib/chipsets";

// 단계별 사용자 칩셋 줄 — 등록해 두면 다음 프로젝트에서도 그대로 뜬다.
// 코드에 박힌 기본 칩(스타일 칩·카메라 프리셋) 옆에 붙여 쓴다. 여러 개 동시에 켤 수 있다.
//
// 삭제 버튼을 칩 위에 겹쳐 두면 켜고 끄다가 잘못 지운다 → 지우기·고치기는 "관리" 패널에서만.
export default function ChipsetRow({
  stage,
  chipsets,
  activeIds,
  onToggle,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
  onSync,
  syncLabel,
  disabled,
  hint,
}: {
  stage: ChipsetStage;
  chipsets: Chipset[];
  activeIds: string[];
  onToggle: (c: Chipset) => void;
  onAdd: (input: { stage: ChipsetStage; label: string; text: string }) => Promise<string | null>;
  onUpdate: (id: string, patch: { label: string; text: string }) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (stage: ChipsetStage, ids: string[]) => Promise<void>;
  // 씬별로 거는 줄에서만 쓴다 — 이 씬의 칩 선택을 나머지 씬에 복사.
  onSync?: () => void;
  syncLabel?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const [panel, setPanel] = useState<null | "add" | "manage">(null);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 수정 중인 칩 id — 관리 목록에서 [고치기]를 누르면 그 줄이 입력칸으로 바뀐다.
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editText, setEditText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const mine = chipsets.filter((c) => c.stage === stage);
  const active = new Set(activeIds);

  // 드래그로 순서 바꾸기. dragId=집어 든 칩, overId=지금 올라가 있는 칩(그 앞에 꽂힌다).
  // 드래그가 실제로 일어났으면 놓는 순간의 click 은 무시한다(칩이 토글돼 버리지 않게).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const draggedRef = useRef(false);

  function reorderTo(targetId: string | null) {
    if (!dragId) return;
    const ids = mine.map((c) => c.id).filter((id) => id !== dragId);
    const at = targetId ? ids.indexOf(targetId) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, dragId);
    setDragId(null);
    setOverId(null);
    void onReorder(stage, ids);
  }

  function openPanel(which: "add" | "manage") {
    setErr(null);
    setEditId(null);
    setConfirmId(null);
    setPanel((p) => (p === which ? null : which));
  }

  async function submitAdd() {
    setBusy(true);
    setErr(null);
    const e = await onAdd({ stage, label, text });
    setBusy(false);
    if (e) return setErr(e);
    setLabel("");
    setText("");
    setPanel(null);
  }

  function startEdit(c: Chipset) {
    setEditId(c.id);
    setEditLabel(c.label);
    setEditText(c.text);
    setConfirmId(null);
    setErr(null);
  }

  async function submitEdit() {
    if (!editId) return;
    setBusy(true);
    setErr(null);
    const e = await onUpdate(editId, { label: editLabel, text: editText });
    setBusy(false);
    if (e) return setErr(e);
    setEditId(null);
  }

  async function confirmDelete(id: string) {
    setBusy(true);
    await onDelete(id);
    setBusy(false);
    setConfirmId(null);
    if (editId === id) setEditId(null);
  }

  const inputCls =
    "w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-accent";

  return (
    <div className="grid gap-1">
      <span className="text-[10px] text-zinc-400">
        🧩 내 칩셋{hint ? ` — ${hint}` : ""} (등록해 두면 다음 영상에서도 그대로 뜹니다
        {mine.length > 1 ? " · 칩을 끌어서 순서 변경" : ""})
      </span>
      <div
        className="flex flex-wrap items-center gap-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          reorderTo(null); // 빈 곳에 놓으면 맨 뒤로
        }}
      >
        {mine.map((c) => {
          const on = active.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              draggable={!disabled}
              onDragStart={(e) => {
                setDragId(c.id);
                draggedRef.current = false;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDrag={() => (draggedRef.current = true)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
                // 놓은 뒤 곧바로 오는 click 만 막고 원상복구
                setTimeout(() => (draggedRef.current = false), 0);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragId && dragId !== c.id) setOverId(c.id);
              }}
              onDragLeave={() => setOverId((v) => (v === c.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                reorderTo(c.id);
              }}
              onClick={() => {
                if (draggedRef.current) return; // 방금 드래그였으면 토글 안 함
                onToggle(c);
              }}
              disabled={disabled}
              title={`${c.text}\n\n(끌어서 순서 변경)`}
              className={`cursor-grab active:cursor-grabbing text-[10px] rounded-md border px-1.5 py-0.5 disabled:opacity-40 ${
                overId === c.id ? "ring-2 ring-accent " : ""
              }${dragId === c.id ? "opacity-40 " : ""}${
                on
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {c.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => openPanel("add")}
          className="text-[10px] rounded-md border border-dashed border-zinc-400 dark:border-zinc-600 px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          {panel === "add" ? "취소" : "+ 칩 등록"}
        </button>
        {mine.length > 0 && (
          <button
            type="button"
            onClick={() => openPanel("manage")}
            className="text-[10px] rounded-md border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {panel === "manage" ? "닫기" : `⚙ 관리 (${mine.length})`}
          </button>
        )}
        {onSync && mine.length > 0 && (
          <button
            type="button"
            onClick={onSync}
            disabled={disabled}
            title="이 씬에서 켠 칩을 나머지 씬에도 똑같이 적용합니다"
            className="text-[10px] rounded-md border border-accent px-1.5 py-0.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {syncLabel ?? "⇄ 다른 씬에도"}
          </button>
        )}
      </div>

      {panel === "add" && (
        <div className="grid gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={CHIPSET_LABEL_MAX}
            placeholder="칩 이름 (예: 황금 팔레트, 거대 금화, 주인공)"
            className={inputCls}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={CHIPSET_TEXT_MAX}
            rows={2}
            placeholder="프롬프트에 붙을 내용 (예: 짙은 남색 배경에 금색 포인트, 채도 낮게)"
            className={`${inputCls} resize-y`}
          />
          {err && <p className="text-[10px] text-red-500">{err}</p>}
          <button
            type="button"
            onClick={submitAdd}
            disabled={busy || !label.trim() || !text.trim()}
            className="justify-self-start rounded-md bg-accent hover:bg-accent-strong disabled:opacity-40 px-2.5 py-1 text-[11px] font-medium text-white"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {panel === "manage" && (
        <div className="grid gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
          <p className="text-[10px] text-zinc-400">
            이 단계의 칩 {mine.length}개 — 고치거나 지웁니다. 지우면 되돌릴 수 없어요.
          </p>
          {err && <p className="text-[10px] text-red-500">{err}</p>}
          <ul className="grid gap-1.5">
            {mine.map((c) => (
              <li key={c.id} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-1.5">
                {editId === c.id ? (
                  <div className="grid gap-1">
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      maxLength={CHIPSET_LABEL_MAX}
                      className={inputCls}
                    />
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={CHIPSET_TEXT_MAX}
                      rows={2}
                      className={`${inputCls} resize-y`}
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={submitEdit}
                        disabled={busy || !editLabel.trim() || !editText.trim()}
                        className="rounded-md bg-accent hover:bg-accent-strong disabled:opacity-40 px-2 py-0.5 text-[10px] font-medium text-white"
                      >
                        {busy ? "저장 중…" : "저장"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditId(null)}
                        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium">{c.label}</p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[10px] text-zinc-500">
                        {c.text}
                      </p>
                    </div>
                    {confirmId === c.id ? (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => confirmDelete(c.id)}
                          disabled={busy}
                          className="rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 px-2 py-0.5 text-[10px] font-medium text-white"
                        >
                          정말 삭제
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                          고치기
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(c.id)}
                          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
