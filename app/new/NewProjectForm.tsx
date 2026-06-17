"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Option {
  id: string;
  label: string;
}

export default function NewProjectForm({
  profiles,
  models,
  defaultModel,
}: {
  profiles: Option[];
  models: Option[];
  defaultModel: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [styleProfileId, setStyleProfileId] = useState(profiles[0]?.id ?? "");
  const [videoModelId, setVideoModelId] = useState(defaultModel);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const endpoint = mode === "url" ? "/api/source/from-url" : "/api/source/from-text";
    const payload =
      mode === "url"
        ? { url, styleProfileId, videoModelId, ttsEnabled }
        : { text, styleProfileId, videoModelId, ttsEnabled };
    if (mode === "url" ? !url.trim() : !text.trim()) {
      setError(mode === "url" ? "URL을 입력해주세요" : "텍스트를 입력해주세요");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      router.push(`/project/${data.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
      setLoading(false);
    }
  }

  const tab = (m: "url" | "text", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={
        "px-4 py-2 text-sm font-medium rounded-xl transition-colors " +
        (mode === m
          ? "bg-accent text-white"
          : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="mt-6 grid gap-5">
      <div className="flex gap-2">
        {tab("url", "URL")}
        {tab("text", "텍스트")}
      </div>

      {mode === "url" ? (
        <input
          type="url"
          inputMode="url"
          placeholder="https://news.example.com/article/123"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-accent"
        />
      ) : (
        <textarea
          placeholder="뉴스 본문을 붙여넣으세요"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-accent resize-y"
        />
      )}

      <label className="grid gap-1.5">
        <span className="text-xs font-semibold text-zinc-500">스타일</span>
        <select
          value={styleProfileId}
          onChange={(e) => setStyleProfileId(e.target.value)}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-xs font-semibold text-zinc-500">영상 모델</span>
        <select
          value={videoModelId}
          onChange={(e) => setVideoModelId(e.target.value)}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ttsEnabled}
          onChange={(e) => setTtsEnabled(e.target.checked)}
          className="size-4 accent-[var(--color-accent)]"
        />
        보이스오버(TTS) 사용
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={loading}
        className="rounded-2xl bg-accent hover:bg-accent-strong disabled:opacity-50 text-white font-semibold px-5 py-3.5 transition-colors"
      >
        {loading ? "소스 분석 중…" : "다음 → 스튜디오"}
      </button>
    </div>
  );
}
