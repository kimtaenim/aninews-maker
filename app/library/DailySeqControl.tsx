"use client";

import { useEffect, useState } from "react";

// 오늘 드라이브 업로드 일련번호(날짜-번호-…의 번호)를 직접 갱신/초기화하는 버튼.
// 현재 카운터를 보여주고, 누르면 시작 번호를 입력받아 설정한다(다음 업로드 = 입력+1).
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export default function DailySeqControl() {
  const [seq, setSeq] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/upload/seq");
      const d = await r.json();
      if (d.ok) setSeq(d.seq as number);
    } catch {
      /* 무시 — 버튼은 그대로 동작 */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function renew() {
    const cur = seq ?? 0;
    const input = window.prompt(
      `오늘 업로드 번호를 몇 번부터 시작할까요?\n0 = 다음 업로드가 01번부터. (현재 다음 번호: ${pad2(cur + 1)})`,
      "0"
    );
    if (input === null) return;
    const value = Math.floor(Number(input));
    if (!Number.isFinite(value) || value < 0 || value > 998) {
      window.alert("0~998 사이 숫자를 넣어주세요.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/upload/seq", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setSeq(d.seq as number);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "번호 갱신 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={renew}
      disabled={busy}
      title="오늘 드라이브 업로드 번호를 초기화/지정합니다"
      className="text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
    >
      🔢 오늘 번호{seq !== null ? ` (다음 ${pad2(seq + 1)})` : ""} 갱신
    </button>
  );
}
