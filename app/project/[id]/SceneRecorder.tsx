"use client";

import { useRef, useState } from "react";
import Spinner from "@/components/Spinner";

// 마이크 녹음 → 서버 저장(/api/audio/record) → onSaved(url).
// 기기 기본 마이크를 자동 사용(노트북=내장 마이크, 폰=폰 마이크). HTTPS(또는 localhost)
// 에서만 동작. 재녹음은 버튼을 다시 눌러 새로 녹음(이전 음성 URL 을 덮어씀).
function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const c of cands) {
    try {
      if (MediaRecorder.isTypeSupported?.(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export default function SceneRecorder({
  projectId,
  sceneIndex,
  hasAudio,
  disabled,
  onSaved,
  onError,
}: {
  projectId: string;
  sceneIndex: number;
  hasAudio: boolean;
  disabled?: boolean;
  onSaved: (url: string) => void;
  onError?: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  function cleanup() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
  }

  async function start() {
    if (disabled || state !== "idle") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError?.("이 브라우저는 녹음을 지원하지 않아요 (다른 브라우저/HTTPS 확인).");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => void finish(rec.mimeType || mime || "audio/webm");
      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      onError?.(
        e instanceof Error && /denied|permission/i.test(e.message)
          ? "마이크 권한이 거부됐어요 (브라우저 권한 허용 필요)."
          : e instanceof Error
            ? e.message
            : "마이크 접근 실패"
      );
      cleanup();
    }
  }

  function stop() {
    if (state !== "recording") return;
    try {
      recRef.current?.stop();
    } catch {
      cleanup();
      setState("idle");
    }
  }

  async function finish(mime: string) {
    setState("uploading");
    try {
      const base = mime.split(";")[0].trim() || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: base });
      if (blob.size === 0) throw new Error("녹음된 소리가 없어요 (다시 시도)");
      const ext = base.includes("mp4") ? "m4a" : base.includes("ogg") ? "ogg" : "webm";
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("sceneIndex", String(sceneIndex));
      fd.append("audio", blob, `rec.${ext}`);
      const r = await fetch("/api/audio/record", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onSaved(data.url as string);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "녹음 저장 실패");
    } finally {
      cleanup();
      setState("idle");
    }
  }

  if (state === "uploading") {
    return (
      <span className="text-[11px] text-zinc-400 inline-flex items-center gap-1">
        <Spinner className="size-3.5" /> 저장 중…
      </span>
    );
  }
  if (state === "recording") {
    return (
      <button
        type="button"
        onClick={stop}
        className="text-[11px] rounded-md border border-red-400 text-red-600 px-2 py-0.5 hover:bg-red-50 dark:hover:bg-red-950 inline-flex items-center gap-1"
      >
        <span className="size-2 rounded-full bg-red-600 animate-pulse" /> ■ 정지
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
    >
      🎙 {hasAudio ? "재녹음" : "녹음"}
    </button>
  );
}
