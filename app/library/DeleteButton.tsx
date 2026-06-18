"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 라이브러리 카드의 삭제 버튼 — 확인 후 DELETE 호출, 목록 새로고침.
export default function DeleteButton({
  projectId,
  title,
}: {
  projectId: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!confirm(`"${title || "이 영상"}" 을(를) 삭제할까요? 되돌릴 수 없어요.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/project/state?projectId=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      aria-label="삭제"
      className="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-sm text-white hover:bg-red-600 disabled:opacity-50"
    >
      {busy ? "…" : "✕"}
    </button>
  );
}
