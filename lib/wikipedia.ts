// ============================================================================
// 위키백과 전용 소스 추출 — HTML 스크래핑 대신 공식 API(prop=extracts&explaintext)
// ----------------------------------------------------------------------------
// explaintext 는 각주[1]·[edit]·인포박스·마크업이 전혀 없는 순수 본문 텍스트라
// 일반 URL 스크래핑보다 훨씬 깨끗하다. 끝부분 부록 섹션(참고문헌·외부 링크 등)만
// 가볍게 잘라낸다.
// ============================================================================

import { SOURCE_MAX_INPUT_CHARS, type SourceMaterial } from "./source";

const WIKI_URL_RE =
  /^https?:\/\/([a-z-]+)\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i;

// 끝부분 부록 섹션 헤딩(== References == 형태) 이후를 잘라낸다 — 본문만 남긴다.
const APPENDIX_RE =
  /\n=+\s*(References|See also|External links|Notes|Footnotes|Further reading|Bibliography|Sources|각주|주석|참고\s*문헌|참고자료|관련\s*항목|외부\s*링크|같이\s*보기)\s*=+/i;

// 입력(위키 URL 또는 표제어) → { lang, title }. 표제어만 오면 한글 포함 시 ko, 아니면 en.
export function parseWikiInput(
  input: string
): { lang: string; title: string } | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const m = s.match(WIKI_URL_RE);
  if (m) {
    return {
      lang: m[1].toLowerCase(),
      title: decodeURIComponent(m[2]).replace(/_/g, " "),
    };
  }
  if (/^https?:\/\//i.test(s)) return null; // 위키가 아닌 URL 은 거부
  const lang = /[가-힣]/.test(s) ? "ko" : "en";
  return { lang, title: s };
}

function trimAppendix(text: string): string {
  const m = text.match(APPENDIX_RE);
  return m ? text.slice(0, m.index).trim() : text.trim();
}

// ── 위키 검색: 검색어로 한·영 위키에서 관련 문서 후보를 찾는다(교차 언어). ──────────
export interface WikiSearchResult {
  lang: string; // "ko" | "en"
  langLabel: string; // "한국어" | "영어"
  title: string;
  snippet: string; // 검색 미리보기(HTML 제거)
  url: string; // 정식 위키 문서 URL
}

const SEARCH_LANGS: Array<{ lang: string; label: string }> = [
  { lang: "ko", label: "한국어" },
  { lang: "en", label: "영어" },
];

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchWikipedia(query: string): Promise<WikiSearchResult[]> {
  const q = (query ?? "").trim();
  if (!q) return [];

  const settled = await Promise.allSettled(
    SEARCH_LANGS.map(async ({ lang, label }) => {
      const params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: q,
        srlimit: "6",
        srprop: "snippet",
        format: "json",
      });
      const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, {
        headers: {
          "User-Agent": "aninews-maker/1.0 (https://aninews-maker.vercel.app)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok) return [] as WikiSearchResult[];
      const data = (await r.json()) as {
        query?: { search?: Array<{ title: string; snippet?: string }> };
      };
      return (data.query?.search ?? []).map((s) => ({
        lang,
        langLabel: label,
        title: s.title,
        snippet: stripHtml(s.snippet ?? ""),
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
      }));
    })
  );

  // 언어별 결과를 인터리브(한·영 섞어 보이게). 최대 12개.
  const byLang = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  const merged: WikiSearchResult[] = [];
  const maxLen = Math.max(0, ...byLang.map((a) => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of byLang) if (arr[i]) merged.push(arr[i]);
  }
  return merged.slice(0, 12);
}

export async function extractFromWikipedia(input: string): Promise<SourceMaterial> {
  const parsed = parseWikiInput(input);
  if (!parsed) throw new Error("위키백과 주소나 표제어를 입력해주세요");
  const { lang, title } = parsed;

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "wiki",
    redirects: "1",
    titles: title,
  });
  const api = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;

  let r: Response;
  try {
    r = await fetch(api, {
      headers: {
        "User-Agent": "aninews-maker/1.0 (https://aninews-maker.vercel.app)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("위키백과에 연결하지 못했어요 (네트워크/타임아웃)");
  }
  if (!r.ok) throw new Error(`위키백과 요청 실패 (HTTP ${r.status})`);

  const data = (await r.json()) as {
    query?: { pages?: Record<string, { title?: string; extract?: string; missing?: string }> };
  };
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) {
    throw new Error(`위키백과에서 '${title}' 문서를 못 찾았어요 (표제어·언어 확인)`);
  }
  const body = trimAppendix((page.extract ?? "").trim());
  if (!body) throw new Error("위키백과 본문이 비어있어요");

  const pageTitle = page.title ?? title;
  const canonical = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(
    pageTitle.replace(/ /g, "_")
  )}`;

  return {
    title: pageTitle,
    body: body.slice(0, SOURCE_MAX_INPUT_CHARS),
    sourceName: "Wikipedia",
    sourceUrl: canonical,
    publishedAt: null,
  };
}
