"use client";

import { useEffect, useRef, useState } from "react";
import Spinner from "@/components/Spinner";

// 마이크 녹음 → 즉시 로컬 재생(blob URL)으로 onLocal → 백그라운드 업로드 후 onSaved(원격 URL).
// 기기 기본 마이크 자동 사용(노트북=내장, 폰=폰 마이크). HTTPS(또는 localhost)에서만 동작.
// 첫 녹음이 무음으로 실패하던 문제 → getUserMedia 후 짧게 마이크를 깨운(워밍업) 뒤 녹음 시작.
const WARMUP_MS = 350; // 마이크가 실제로 소리를 내보내기 시작할 때까지 대기

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
  onLocal,
  onSaved,
  onError,
}: {
  projectId: string;
  sceneIndex: number;
  hasAudio: boolean;
  disabled?: boolean;
  onLocal?: (localUrl: string) => void; // 녹음 직후 즉시 재생용(로컬 blob URL)
  onSaved: (url: string) => void; // 업로드 완료 후 영구 URL
  onError?: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "preparing" | "recording" | "uploading">("idle");
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const localUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // 언마운트 시 마이크 해제 + 로컬 URL 회수.
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    };
  }, []);

  function fail(msg: string) {
    setErr(msg);
    onError?.(msg);
  }

  function releaseMic() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
  }

  async function start() {
    if (disabled || state !== "idle") return;
    setErr(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      fail("이 브라우저는 녹음을 지원하지 않아요 (HTTPS·다른 브라우저 확인).");
      return;
    }
    setState("preparing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // 마이크 워밍업 — 첫 녹음이 무음으로 시작하는 것 방지.
      await new Promise((r) => setTimeout(r, WARMUP_MS));
      if (!streamRef.current) return; // 그 사이 취소됨
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      rec.onerror = () => fail("녹음 중 오류가 났어요 (다시 시도).");
      rec.onstop = () => void finish(rec.mimeType || mime || "audio/webm");
      recRef.current = rec;
      rec.start(1000); // 1초마다 청크 — 데이터 누락 방지
      setState("recording");
    } catch (e) {
      fail(
        e instanceof Error && /denied|permission|notallowed/i.test(e.name + e.message)
          ? "마이크 권한이 거부됐어요. 주소창 🔒 → 마이크 허용 후 다시 시도."
          : e instanceof Error && /notfound|devices/i.test(e.name + e.message)
            ? "마이크를 찾지 못했어요 (기기 마이크 확인)."
            : e instanceof Error
              ? `마이크 접근 실패: ${e.message}`
              : "마이크 접근 실패"
      );
      releaseMic();
      setState("idle");
    }
  }

  function stop() {
    if (state !== "recording") return;
    try {
      recRef.current?.stop();
    } catch {
      releaseMic();
      setState("idle");
    }
  }

  async function finish(mime: string) {
    const base = (mime.split(";")[0].trim() || "audio/webm").toLowerCase();
    const blob = new Blob(chunksRef.current, { type: base });
    releaseMic(); // 마이크는 바로 해제(녹음 데이터는 blob 에 있음)
    if (blob.size === 0) {
      fail("녹음된 소리가 없어요 (마이크 입력 확인 후 다시).");
      setState("idle");
      return;
    }
    // 1) 즉시 로컬 재생 — 업로드를 기다리지 않고 바로 들을 수 있다.
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const localUrl = URL.createObjectURL(blob);
    localUrlRef.current = localUrl;
    onLocal?.(localUrl);
    // 2) 백그라운드 업로드 → 영구 URL 로 교체.
    setState("uploading");
    try {
      const ext = base.includes("mp4") ? "m4a" : base.includes("ogg") ? "ogg" : "webm";
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("sceneIndex", String(sceneIndex));
      fd.append("audio", blob, `rec.${ext}`);
      const r = await fetch("/api/audio/record", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `저장 실패 (HTTP ${r.status})`);
      onSaved(data.url as string);
    } catch (e) {
      fail(e instanceof Error ? e.message : "녹음 저장 실패(로컬 재생은 가능, 다시 저장 필요).");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="grid justify-items-end gap-0.5">
      {state === "uploading" ? (
        <span className="text-[11px] text-zinc-400 inline-flex items-center gap-1">
          <Spinner className="size-3.5" /> 저장 중…
        </span>
      ) : state === "preparing" ? (
        <span className="text-[11px] text-zinc-400 inline-flex items-center gap-1">
          <Spinner className="size-3.5" /> 준비 중…
        </span>
      ) : state === "recording" ? (
        <button
          type="button"
          onClick={stop}
          className="text-[11px] rounded-md border border-red-400 text-red-600 px-2 py-0.5 hover:bg-red-50 dark:hover:bg-red-950 inline-flex items-center gap-1"
        >
          <span className="size-2 rounded-full bg-red-600 animate-pulse" /> ■ 정지
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
        >
          🎙 {hasAudio ? "재녹음" : "녹음"}
        </button>
      )}
      {err && <span className="max-w-[150px] text-right text-[10px] leading-tight text-red-600">{err}</span>}
    </div>
  );
}
