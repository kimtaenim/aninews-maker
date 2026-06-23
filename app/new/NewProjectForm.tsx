"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import type { RssItem, RssCategory } from "@/lib/rss";
import type { ArticleBriefing } from "@/lib/briefing";
import type { WikiSearchResult } from "@/lib/wikipedia";
import { ACCEPT_ATTR, MAX_FILE_SIZE, MAX_TOTAL_SIZE } from "@/lib/attachments";
import trendLangsData from "@/config/languages.json";

type Mode = "rss" | "url" | "wiki" | "trend" | "text" | "file";

// 트렌드 언어 목록(config/languages.json) — 버튼용.
const TREND_LANGS = (trendLangsData as {
  languages: { code: string; geo: string; label: string }[];
}).languages;

interface TrendItem {
  keyword: string;
  traffic?: string;
}

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
  const [wikiResults, setWikiResults] = useState<WikiSearchResult[] | null>(null);
  const [wikiSearching, setWikiSearching] = useState(false);

  // 트렌드(구글 트렌드 실시간 급상승) — 기본 한국어. 키워드 클릭 → 위키 검색으로.
  const [trendLang, setTrendLang] = useState("ko");
  const [trends, setTrends] = useState<TrendItem[] | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

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

  // 트렌드 로드 — 언어별 구글 트렌드 급상승 10개. 기본 한국어, 탭 진입/언어 변경 시 호출.
  async function loadTrends(lang: string) {
    setTrendLang(lang);
    setTrends(null);
    setTrendsLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/source/trends?lang=${encodeURIComponent(lang)}`);
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setTrends(data.items as TrendItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "트렌드를 못 불러왔어요");
    } finally {
      setTrendsLoading(false);
    }
  }

  // 트렌드 탭에 처음 들어오면 기본 언어(한국어)를 자동으로 불러온다.
  useEffect(() => {
    if (mode === "trend" && trends === null && !trendsLoading) void loadTrends(trendLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 위키 검색 — 검색어로 한·영 위키 후보를 받아 보여준다. URL을 바로 넣었으면 검색 없이 생성.
  // queryOverride: 트렌드 키워드 클릭 시 그 키워드로 바로 검색(상태 갱신을 기다리지 않음).
  async function searchWiki(queryOverride?: string) {
    const q = (queryOverride ?? wiki).trim();
    if (!q) {
      setError("검색어나 위키 주소를 입력해주세요");
      return;
    }
    if (/wikipedia\.org\/wiki\//i.test(q)) {
      void submitWikiUrl(q);
      return;
    }
    setError(null);
    setWikiSearching(true);
    try {
      const r = await fetch("/api/source/wiki-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const results = data.results as WikiSearchResult[];
      setWikiResults(results);
      if (results.length === 0) {
        setError("관련 위키 문서를 못 찾았어요. 다른 검색어를 시도해보세요.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "위키 검색 실패");
    } finally {
      setWikiSearching(false);
    }
  }

  // 고른 위키 문서로 프로젝트 생성.
  async function submitWikiUrl(urlOrTitle: string) {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/source/from-wiki", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: urlOrTitle }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      router.push(`/project/${data.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
      setLoading(false);
    }
  }

  async function submit() {
    if (mode === "file") return submitFiles();
    if (mode === "wiki") return searchWiki();
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
        {tab("trend", "트렌드")}
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

      {mode === "trend" && (
        <div className="grid gap-3">
          {/* 언어 선택 — 기본 한국어. 누르면 그 언어 트렌드 10개를 불러온다. */}
          <div className="flex flex-wrap gap-1.5">
            {TREND_LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => void loadTrends(l.code)}
                disabled={trendsLoading}
                className={
                  "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 " +
                  (trendLang === l.code
                    ? "bg-accent text-white"
                    : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300")
                }
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-zinc-400">
            구글 트렌드 실시간 급상승 10개(최신순). 하나 누르면 그 키워드로 위키 문서를
            찾아드려요.
          </p>

          {trendsLoading && (
            <p className="inline-flex items-center gap-1.5 text-xs text-accent">
              <Spinner /> 트렌드 불러오는 중…
            </p>
          )}
          {trends && trends.length > 0 && (
            <ol className="grid gap-1.5">
              {trends.map((t, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      setWiki(t.keyword);
                      setWikiResults(null);
                      setMode("wiki");
                      void searchWiki(t.keyword);
                    }}
                    className="w-full text-left rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 hover:border-accent hover:bg-accent/5 transition-colors"
                  >
                    <span className="mr-2 text-xs text-zinc-400">{i + 1}</span>
                    <span className="text-sm font-medium">{t.keyword}</span>
                    {t.traffic && (
                      <span className="ml-2 text-[10px] text-zinc-400">{t.traffic}</span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {trends && trends.length === 0 && !trendsLoading && (
            <p className="text-xs text-zinc-500">
              지금은 트렌드를 못 불러왔어요. 잠시 후 다시 시도해주세요.
            </p>
          )}
        </div>
      )}

      {mode === "wiki" && (
        <div className="grid gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="검색어 (예: 냉면, 인공지능) 또는 위키 주소"
              value={wiki}
              onChange={(e) => {
                setWiki(e.target.value);
                setWikiResults(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchWiki();
                }
              }}
              className={inputCls + " flex-1"}
            />
            <button
              type="button"
              onClick={() => void searchWiki()}
              disabled={wikiSearching}
              className="shrink-0 rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-50 text-white text-sm font-medium px-4"
            >
              {wikiSearching ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner /> 검색 중…
                </span>
              ) : (
                "검색"
              )}
            </button>
          </div>
          <p className="text-[11px] text-zinc-400">
            한·영 위키에서 관련 문서를 찾아 보여드려요. 하나 고르면 그 문서로 영상을
            만듭니다. (위키 주소를 바로 넣어도 됩니다.)
          </p>

          {wikiResults && wikiResults.length > 0 && (
            <ul className="grid gap-1.5 max-h-96 overflow-y-auto pr-1">
              {wikiResults.map((r) => (
                <li key={r.url}>
                  <button
                    type="button"
                    onClick={() => void submitWikiUrl(r.url)}
                    disabled={loading}
                    className="w-full text-left rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 hover:border-accent hover:bg-accent/5 disabled:opacity-50 transition-colors"
                  >
                    <p className="text-sm font-medium leading-snug">
                      <span className="mr-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent align-middle">
                        {r.langLabel}
                      </span>
                      {r.title}
                    </p>
                    {r.snippet && (
                      <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{r.snippet}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loading && (
            <p className="inline-flex items-center gap-1.5 text-xs text-accent">
              <Spinner /> 선택한 문서로 만드는 중…
            </p>
          )}
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

      {/* 위키·트렌드 모드는 자체 검색/클릭으로 진행하므로 이 버튼은 숨김. */}
      {mode !== "wiki" && mode !== "trend" && (
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
      )}
    </div>
  );
}
