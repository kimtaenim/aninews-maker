import Link from "next/link";
import DeleteButton from "./DeleteButton";
import { listRecentProjects, getProject } from "@/lib/projectStore";
import { STEP_ORDER, type Project } from "@/lib/types";
import { getLang } from "@/lib/languages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 항상 최신 목록(Redis)

// 가장 멀리 진행된(승인된) 단계 라벨
const STEP_LABELS: Record<string, string> = {
  source: "소스",
  script: "스크립트",
  keyframe: "키프레임",
  images: "이미지",
  videos: "영상",
  voiceover: "음성",
  compose: "합성",
  subtitle: "자막",
};

function progressLabel(p: Project): string {
  if (p.finalVideoUrl) return "완성";
  let furthest = "";
  for (const s of STEP_ORDER) {
    if (p.steps[s]?.status === "approved") furthest = s;
  }
  return furthest ? `${STEP_LABELS[furthest]} 승인` : "진행 중";
}

// 제목 + 씬 나레이션(=스크립트)을 합친 검색 대상. 키워드(공백 분리)가 모두
// 들어있는 프로젝트만 매칭(단순 부분일치, 대소문자 무시).
function matchesQuery(p: Project, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = (
    p.title +
    " " +
    p.scenes.map((s) => s.narration).join(" ")
  ).toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

  let projects: Project[] = [];
  let loadError = false;
  try {
    // 검색 시엔 더 많이 읽어 과거 프로젝트도 포함.
    const ids = await listRecentProjects(q ? 200 : 60);
    const loaded = await Promise.all(
      ids.map((id) => getProject(id).catch(() => null))
    );
    projects = loaded.filter((p): p is Project => p !== null);
  } catch {
    loadError = true;
  }

  const shown = projects.filter((p) => matchesQuery(p, terms));

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">라이브러리</h1>
        <Link
          href="/new"
          className="text-xs font-medium rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5"
        >
          + 새 영상
        </Link>
      </div>

      {/* 검색 — 제목·나레이션(스크립트) 부분일치. 서버 렌더(쿼리 ?q=). */}
      <form method="get" action="/library" className="mt-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="제목·나레이션으로 검색 (예: 환율, AI 규제)"
          className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium px-4"
        >
          검색
        </button>
        {q && (
          <Link
            href="/library"
            className="shrink-0 inline-flex items-center rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            전체
          </Link>
        )}
      </form>
      {q && (
        <p className="mt-2 text-xs text-zinc-500">
          &lsquo;{q}&rsquo; 검색 결과 {shown.length}개
        </p>
      )}

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">
          목록을 못 불러왔어요 (Redis 설정 확인).
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          {q
            ? `'${q}'에 맞는 영상이 없어요.`
            : "아직 만든 영상이 없어요. “새 영상”으로 시작해보세요."}
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {shown.map((p) => (
            <li key={p.id} className="relative">
              <DeleteButton projectId={p.id} title={p.title} />
              <Link
                href={`/project/${p.id}`}
                className="block rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:border-accent transition-colors"
              >
                <div className="aspect-[9/16] bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
                  {p.keyframeUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.keyframeUrl}
                      alt={p.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[11px] text-zinc-400">미생성</span>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium line-clamp-2 leading-snug">
                    {p.title}
                  </p>
                  <p className="mt-1 text-[10px] font-medium">
                    {p.lang && (
                      <span className="mr-1 rounded bg-accent/10 px-1 py-0.5 text-accent">
                        {getLang(p.lang)?.label ?? p.lang}
                      </span>
                    )}
                    <span className="text-accent">{progressLabel(p)}</span>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
