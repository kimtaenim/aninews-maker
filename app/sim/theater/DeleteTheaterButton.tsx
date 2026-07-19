"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 자동극장 카드의 삭제 버튼 — 확인 후 DELETE 호출, 목록 새로고침.
export default function DeleteTheaterButton({
  theaterId,
  title,
}: {
  theaterId: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!confirm(`"${title || "이 극장"}" 을(를) 삭제할까요? 되돌릴 수 없어요.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sim/theater/${encodeURIComponent(theaterId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "삭제 중 오류가 발생했어요.");
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
