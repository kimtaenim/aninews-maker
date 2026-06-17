// ============================================================================
// 소스 추출 (1단계) — cardnews from-url 의 HTML 추출 로직 이식 (단일 아이템)
// ----------------------------------------------------------------------------
// aninews 는 "뉴스 1건 → 영상 1편" 이라 cardnews 의 멀티 분할은 빼고, URL/텍스트
// 하나에서 영상 한 편의 원재료(SourceMaterial)를 뽑는다.
// ============================================================================

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface SourceMaterial {
  title: string;
  body: string;
  sourceName: string;
  sourceUrl: string; // 원문 링크 ("" for 텍스트 직접 입력)
  publishedAt: number | null;
}

// HTML entity decode — 흔한 5종 + 숫자 entity.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ");
}

function extractFromHtml(html: string, url: string): SourceMaterial {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = decodeEntities((titleMatch?.[1] ?? "").trim());

  const ogTitle = html.match(
    /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']*)["']/i
  );
  if (ogTitle?.[1]) title = decodeEntities(ogTitle[1].trim());

  const ogSite = html.match(
    /<meta[^>]+(?:property|name)=["']og:site_name["'][^>]+content=["']([^"']*)["']/i
  );
  let sourceName = ogSite?.[1] ? decodeEntities(ogSite[1].trim()) : "";
  if (!sourceName) {
    try {
      sourceName = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      sourceName = "직접 입력 URL";
    }
  }

  const descMatch = html.match(
    /<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']*)["']/i
  );
  const description = descMatch?.[1] ? decodeEntities(descMatch[1].trim()) : "";

  const pubMatch = html.match(
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished)["'][^>]+content=["']([^"']*)["']/i
  );
  let publishedAt: number | null = null;
  if (pubMatch?.[1]) {
    const t = Date.parse(pubMatch[1]);
    if (!isNaN(t)) publishedAt = t;
  }

  // 본문 — <article> > <main> > <body> 순서
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const rawBody = articleMatch?.[1] ?? mainMatch?.[1] ?? bodyMatch?.[1] ?? html;

  let text = rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<\/?(?:br|p|li|div|h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  text = decodeEntities(text);

  let body = text;
  if (body.length < 100 && description) {
    body = description + (body ? "\n\n" + body : "");
  }

  return { title, body, sourceName, sourceUrl: url, publishedAt };
}

export async function extractFromUrl(url: string): Promise<SourceMaterial> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("잘못된 URL 형식");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http/https 만 가능");
  }
  const r = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const ex = extractFromHtml(html, url);
  if (!ex.title && !ex.body) throw new Error("제목·본문 모두 비어있음");
  return { ...ex, title: ex.title || "(제목 없음)" };
}

// 텍스트 직접 입력 — 첫 줄을 제목 후보로.
export function materialFromText(text: string): SourceMaterial {
  const body = text.trim();
  const firstLine = body.split(/\r?\n/)[0]?.trim() ?? "";
  return {
    title: firstLine.slice(0, 60) || "(제목 없음)",
    body,
    sourceName: "직접 입력",
    sourceUrl: "",
    publishedAt: null,
  };
}

export const SOURCE_MAX_INPUT_CHARS = 60_000;
