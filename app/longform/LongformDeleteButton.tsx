"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 롱폼 폴더 헤더의 통째 삭제 버튼 — 롱폼 + 세그먼트 + 진행자를 모두 지운다.
// 확장판(kind="elongated")은 세그먼트·진행자가 없어 자신만 지워지므로 문구가 다르다.
// 어느 쪽이든 원본 숏폼은 건드리지 않는다(참조만 하기 때문).
export default function LongformDeleteButton({
  projectId,
  title,
  kind = "compilation",
}: {
  projectId: string;
  title: string;
  kind?: "compilation" | "elongated";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const warn =
      kind === "elongated"
        ? `"${title}"을(를) 삭제할까요?\n원본 숏폼은 그대로 남고, 이 확장판만 지워져요. 되돌릴 수 없어요.`
        : `"${title}" 롱폼을 삭제할까요?\n세그먼트·진행자까지 전부 지워지고 되돌릴 수 없어요.`;
    if (!confirm(warn)) return;
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
