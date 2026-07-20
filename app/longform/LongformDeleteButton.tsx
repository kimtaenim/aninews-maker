"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 롱폼 폴더 헤더의 통째 삭제 버튼 — 롱폼 + 세그먼트 + 진행자를 모두 지운다.
export default function LongformDeleteButton({ projectId, title }: { projectId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (
      !confirm(
        `"${title}" 롱폼을 삭제할까요?\n세그먼트·진행자까지 전부 지워지고 되돌릴 수 없어요.`
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/longform/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "삭제 실패");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "삭제 실패");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={del}
      disabled={busy}
      className="shrink-0 rounded-md border border-red-300 dark:border-red-800 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"
    >
      {busy ? "삭제 중…" : "🗑 삭제"}
    </button>
  );
}
