"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import type { RssItem, RssCategory } from "@/lib/rss";
import type { ArticleBriefing } from "@/lib/briefing";
import { ACCEPT_ATTR, MAX_FILE_SIZE, MAX_TOTAL_SIZE } from "@/lib/attachments";

type Mode = "rss" | "url" | "wiki" | "text" | "file";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// 첫 화면은 소스 입력만. 스타일·모델·음성·자막은 모두 스튜디오 각 단계에서 지정/변경.
export default function NewProjectForm({ categories }: { categories: RssCategory[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("rss");
  const [url, setUrl] = useState("");
  const [wiki, setWiki] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  // RSS 상태
  const [category, setCategory] = useState(categories[0]?.key ?? "");
  const [articles, setArticles] = useState<RssItem[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [articleQuery, setArticleQuery] = useState("");
  const [feedNote, setFeedNote] = useState<string | null>(null);
  // 후보(브리핑 받을 기사) 다건 선택 → 브리핑 → 최종 선택.
  const [candidateLinks, setCandidateLinks] = useState<Set<string>>(new Set());
  const [briefings, setBriefings] = useState<ArticleBriefing[] | null>(null);
  const [briefSelected, setBriefSelected] = useState<Set<string>>(new Set());
  const [briefingLoading, setBriefingLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = articleQuery.trim().toLowerCase();
  const shownArticles = q
    ? articles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.feedName.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q)
      )
    : articles;

  async function loadArticles() {
    setError(null);
    setFeedNote(null);
    setArticles([]);
    setCandidateLinks(new Set());
    setBriefings(null);
    setBriefSelected(new Set());
    setArticleQuery("");
    setLoadingArticles(true);
    try {
      const r = await fetch(`/api/source/rss?category=${encodeURIComponent(category)}`);
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setArticles(data.articles as RssItem[]);
      const failed = (data.failedFeeds ?? []) as { feed: string; error: string }[];
      if (failed.length > 0) {
        const names = failed.slice(0, 4).map((f) => `${f.feed}(${f.error})`).join(", ");
        setFeedNote(
          `피드 ${failed.length}/${data.feedsTotal ?? "?"}개를 못 읽었어요: ${names}${failed.length > 4 ? " 외" : ""}`
        );
      }
      if ((data.articles as RssItem[]).length === 0) {
        setError("이 카테고리에서 최근 기사를 못 찾았어요. 다른 카테고리를 시도해보세요.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "RSS 수집 실패");
    } finally {
      setLoadingArticles(false);
    }
  }

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError(null);
    setFiles((prev) => {
      const next = [...prev];
      for (const f of Array.from(picked)) {
        if (f.size > MAX_FILE_SIZE) {
          setError(`${f.name} 이(가) 10MB를 초과해요.`);
          continue;
        }
        if (next.some((p) => p.name === f.name && p.size === f.size)) continue;
        next.push(f);
      }
      if (next.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_SIZE) {
        setError("전체 첨부가 30MB를 초과해요.");
        return prev;
      }
      return next;
    });
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submitFiles() {
    if (files.length === 0) {
      setError("파일을 1개 이상 첨부해주세요");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("file", f);
      const r = await fetch("/api/source/from-files", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      router.push(`/project/${data.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
      setLoading(false);
    }
  }

  function toggleCandidate(link: string) {
    setError(null);
    setCandidateLinks((prev) => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  }

  function toggleBriefSelected(link: string) {
    setBriefSelected((prev) => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  }

  // 고른 후보 기사들을 브리핑 API 로 보내 요약을 받는다.
  async function runBriefing() {
    const picked = articles.filter((a) => candidateLinks.has(a.link));
    if (picked.length === 0) {
      setError("브리핑할 기사를 1개 이상 선택해주세요");
      return;
    }
    setError(null);
    setBriefingLoading(true);
    try {
      const r = await fetch("/api/source/rss/briefing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          articles: picked.map((a) => ({
            link: a.link,
            title: a.title,
            summary: a.summary,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const bs = data.briefings as ArticleBriefing[];
      setBriefings(bs);
      setBriefSelected(new Set(bs.map((b) => b.link))); // 기본 전체 선택
    } catch (e) {
      setError(e instanceof Error ? e.message : "브리핑 실패");
    } finally {
      setBriefingLoading(false);
    }
  }

  async function submit() {
    if (mode === "file") return submitFiles();
    setError(null);
    let endpoint = "/api/source/from-url";
    let payload: Record<string, unknown>;
    if (mode === "rss") {
      // 브리핑을 받았으면 거기서 고른 것, 아니면 후보 선택을 그대로 합친다.
      const links = [...(briefings ? briefSelected : candidateLinks)];
      if (links.length === 0) {
        setError(
          briefings
            ? "브리핑에서 넣을 뉴스를 1개 이상 선택해주세요"
            : "기사를 1개 이상 선택해주세요"
        );
        return;
      }
      payload = { urls: links };
    } else if (mode === "url") {
      if (!url.trim()) {
        setError("URL을 입력해주세요");
        return;
      }
      payload = { url };
    } else if (mode === "wiki") {
      if (!wiki.trim()) {
        setError("위키백과 주소나 표제어를 입력해주세요");
        return;
      }
      endpoint = "/api/source/from-wiki";
      payload = { input: wiki };
    } else {
      if (!text.trim()) {
        setError("텍스트를 입력해주세요");
        return;
      }
      endpoint = "/api/source/from-text";
      payload = { text };
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
        {tab("wiki", "위키")}
        {tab("text", "텍스트")}
        {tab("file", "파일")}
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

          {feedNote && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500">⚠ {feedNote}</p>
          )}

          {/* 1) 후보 고르기 — 기사 여러 개를 체크해 브리핑을 받는다. */}
          {briefings === null && (
            <>
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
                <>
                  <p className="text-[11px] text-zinc-400">
                    관심 있는 기사를 여러 개 골라 브리핑을 받아보세요. 브리핑을 보고 최종으로
                    합칠 뉴스를 정합니다.
                  </p>
                  <ul className="grid gap-1.5 max-h-96 overflow-y-auto pr-1">
                    {shownArticles.map((a) => {
                      const checked = candidateLinks.has(a.link);
                      return (
                        <li key={a.id}>
                          <label
                            className={
                              "block rounded-xl border p-3 cursor-pointer transition-colors " +
                              (checked
                                ? "border-accent bg-accent/5"
                                : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900")
                            }
                          >
                            <div className="flex gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCandidate(a.link)}
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
                      );
                    })}
                  </ul>
                </>
              )}

              {candidateLinks.size > 0 && (
                <button
                  type="button"
                  onClick={runBriefing}
                  disabled={briefingLoading}
                  className="rounded-xl border border-accent text-accent hover:bg-accent/5 disabled:opacity-50 text-sm font-medium px-4 py-2.5"
                >
                  {briefingLoading ? (
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Spinner /> 브리핑 만드는 중…
                    </span>
                  ) : (
                    `📋 브리핑 받기 (${candidateLinks.size})`
                  )}
                </button>
              )}
            </>
          )}

          {/* 2) 브리핑 — 요약을 보고 최종으로 넣을 뉴스를 고른다. */}
          {briefings !== null && (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">
                  브리핑을 보고 넣을 뉴스를 고르세요. 고른 뉴스를 하나의 주제로 합칩니다.
                </p>
                <button
                  type="button"
                  onClick={() => setBriefings(null)}
                  className="shrink-0 text-xs text-zinc-500 hover:text-accent"
                >
                  ← 다시 고르기
                </button>
              </div>
              <ul className="grid gap-1.5 max-h-[28rem] overflow-y-auto pr-1">
                {briefings.map((b) => {
                  const checked = briefSelected.has(b.link);
                  return (
                    <li key={b.link}>
                      <label
                        className={
                          "block rounded-xl border p-3 cursor-pointer transition-colors " +
                          (checked
                            ? "border-accent bg-accent/5"
                            : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900")
                        }
                      >
                        <div className="flex gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBriefSelected(b.link)}
                            className="mt-1 accent-[var(--color-accent)]"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-snug">{b.title}</p>
                            {b.sourceName && (
                              <p className="mt-0.5 text-[11px] text-zinc-500">{b.sourceName}</p>
                            )}
                            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-line">
                              {b.briefing}
                            </p>
                            {!b.fetched && (
                              <p className="mt-1 text-[10px] text-amber-600">
                                본문을 못 불러와 원문 요약 기반이에요.
                              </p>
                            )}
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
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

      {mode === "wiki" && (
        <div className="grid gap-2">
          <input
            type="text"
            placeholder="위키백과 주소 붙여넣기 또는 표제어 (예: 인공지능)"
            value={wiki}
            onChange={(e) => setWiki(e.target.value)}
            className={inputCls}
          />
          <p className="text-[11px] text-zinc-400">
            위키백과 공식 API로 깨끗한 본문만 가져옵니다 (각주·편집 링크 없음). 표제어만
            넣으면 한글은 한국어판, 영문은 영어판에서 찾아요.
          </p>
        </div>
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

      {mode === "file" && (
        <div className="grid gap-3">
          <label
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-8 text-center cursor-pointer hover:border-accent transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            <input
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span className="text-sm font-medium">파일 선택 또는 드래그</span>
            <span className="text-[11px] text-zinc-500">
              PDF·이미지(OCR)·Word·Excel·PPT · 파일당 10MB · 전체 30MB
            </span>
          </label>

          {files.length > 0 && (
            <ul className="grid gap-1.5">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${f.size}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">{f.name}</span>
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    {formatSize(f.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="shrink-0 text-zinc-400 hover:text-red-500 text-sm"
                    aria-label="첨부 제거"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] text-zinc-400">
        스타일(2D/3D)·영상 모델·음성·자막은 다음 스튜디오 단계에서 정하고 언제든 바꿀 수
        있어요.
      </p>

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
