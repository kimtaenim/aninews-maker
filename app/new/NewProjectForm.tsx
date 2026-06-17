"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import type { RssItem, RssCategory } from "@/lib/rss";

interface Option {
  id: string;
  label: string;
}

type Mode = "rss" | "url" | "text";

export default function NewProjectForm({
  profiles,
  models,
  defaultModel,
  categories,
}: {
  profiles: Option[];
  models: Option[];
  defaultModel: string;
  categories: RssCategory[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("rss");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  // RSS 상태
  const [category, setCategory] = useState(categories[0]?.key ?? "");
  const [articles, setArticles] = useState<RssItem[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [selectedLink, setSelectedLink] = useState("");
  const [articleQuery, setArticleQuery] = useState("");

  const q = articleQuery.trim().toLowerCase();
  const shownArticles = q
    ? articles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.feedName.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q)
      )
    : articles;

  const [styleProfileId, setStyleProfileId] = useState(profiles[0]?.id ?? "");
  const [videoModelId, setVideoModelId] = useState(defaultModel);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadArticles() {
    setError(null);
    setArticles([]);
    setSelectedLink("");
    setArticleQuery("");
    setLoadingArticles(true);
    try {
      const r = await fetch(`/api/source/rss?category=${encodeURIComponent(category)}`);
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setArticles(data.articles as RssItem[]);
      if ((data.articles as RssItem[]).length === 0) {
        setError("이 카테고리에서 최근 기사를 못 찾았어요. 다른 카테고리를 시도해보세요.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "RSS 수집 실패");
    } finally {
      setLoadingArticles(false);
    }
  }

  async function submit() {
    setError(null);
    // 소스 결정
    let endpoint = "/api/source/from-url";
    let payload: Record<string, unknown>;
    if (mode === "rss") {
      if (!selectedLink) {
        setError("기사를 하나 선택해주세요");
        return;
      }
      payload = { url: selectedLink, styleProfileId, videoModelId, ttsEnabled };
    } else if (mode === "url") {
      if (!url.trim()) {
        setError("URL을 입력해주세요");
        return;
      }
      payload = { url, styleProfileId, videoModelId, ttsEnabled };
    } else {
      if (!text.trim()) {
        setError("텍스트를 입력해주세요");
        return;
      }
      endpoint = "/api/source/from-text";
      payload = { text, styleProfileId, videoModelId, ttsEnabled };
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

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setError(null);
      }}
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

  const inputCls =
    "w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-accent";
  const selectCls =
    "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-accent";

  return (
    <div className="mt-6 grid gap-5">
      <div className="flex gap-2">
        {tab("rss", "RSS")}
        {tab("url", "URL")}
        {tab("text", "텍스트")}
      </div>

      {mode === "rss" && (
        <div className="grid gap-3">
          <div className="flex gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={selectCls + " flex-1"}
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadArticles}
              disabled={loadingArticles}
              className="shrink-0 rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-50 text-white text-sm font-medium px-4"
            >
              {loadingArticles ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner /> 불러오는 중…
                </span>
              ) : (
                "기사 불러오기"
              )}
            </button>
          </div>

          {articles.length > 0 && (
            <input
              type="text"
              placeholder={`기사 ${articles.length}건 검색 (제목·매체)`}
              value={articleQuery}
              onChange={(e) => setArticleQuery(e.target.value)}
              className={inputCls}
            />
          )}

          {articles.length > 0 && shownArticles.length === 0 && (
            <p className="text-xs text-zinc-500">검색 결과가 없어요.</p>
          )}

          {shownArticles.length > 0 && (
            <ul className="grid gap-1.5 max-h-96 overflow-y-auto pr-1">
              {shownArticles.map((a) => (
                <li key={a.id}>
                  <label
                    className={
                      "block rounded-xl border p-3 cursor-pointer transition-colors " +
                      (selectedLink === a.link
                        ? "border-accent bg-accent/5"
                        : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900")
                    }
                  >
                    <div className="flex gap-2">
                      <input
                        type="radio"
                        name="rss-article"
                        checked={selectedLink === a.link}
                        onChange={() => setSelectedLink(a.link)}
                        className="mt-1 accent-[var(--color-accent)]"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug">{a.title}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">{a.feedName}</p>
                        {a.summary && (
                          <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                            {a.summary}
                          </p>
                        )}
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "url" && (
        <input
          type="url"
          inputMode="url"
          placeholder="https://news.example.com/article/123"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={inputCls}
        />
      )}

      {mode === "text" && (
        <textarea
          placeholder="뉴스 본문을 붙여넣으세요"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className={inputCls + " resize-y"}
        />
      )}

      <label className="grid gap-1.5">
        <span className="text-xs font-semibold text-zinc-500">스타일</span>
        <select
          value={styleProfileId}
          onChange={(e) => setStyleProfileId(e.target.value)}
          className={selectCls}
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
          className={selectCls}
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
        {loading ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <Spinner /> 소스 분석 중…
          </span>
        ) : (
          "다음 → 스튜디오"
        )}
      </button>
    </div>
  );
}
