"use client";

import { useState } from "react";

// 완성 영상을 내 Google 드라이브(ANINEWS 폴더)에 업로드. 연결 안 됐으면 연결 플로우로.
// uploaded=true(이미 업로드됨, 재합성 안 됨)면 처음부터 "보기" 링크로 시작 — 리로드해도 유지.
export default function DriveUploadButton({
  projectId,
  driveLink,
  uploaded,
}: {
  projectId: string;
  driveLink?: string;
  uploaded?: boolean;
}) {
  const alreadyUp = !!(uploaded && driveLink);
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">(
    alreadyUp ? "done" : "idle"
  );
  const [link, setLink] = useState<string | null>(alreadyUp ? driveLink! : null);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload() {
    setState("uploading");
    setMsg(null);
    try {
      const r = await fetch("/api/upload/drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await r.json();
      if (r.status === 409 && data.needConnect) {
        // 드라이브 미연결 → 연결 화면으로(돌아오면 라이브러리).
        window.location.href = `/api/google/connect?back=${encodeURIComponent("/library")}`;
        return;
      }
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setLink(data.link as string);
      setState("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "업로드 실패");
      setState("error");
    }
  }

  if (state === "done" && link) {
    return (
      <div className="mt-1 flex items-center gap-1">
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 text-center text-[11px] font-medium text-accent rounded-lg border border-accent/40 py-1 hover:bg-accent/10"
        >
          ✓ 드라이브에서 보기
        </a>
        <button
          type="button"
          onClick={upload}
          title="드라이브에 다시 업로드 (새 파일로)"
          className="shrink-0 text-[11px] rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          ↻
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={upload}
        disabled={state === "uploading"}
        className="w-full text-center text-[11px] font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
      >
        {state === "uploading" ? "업로드 중…" : "📁 드라이브 업로드"}
      </button>
      {state === "error" && msg && (
        <p className="mt-0.5 text-[10px] text-red-600 leading-tight">{msg}</p>
      )}
    </div>
  );
}
