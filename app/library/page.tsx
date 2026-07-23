import Link from "next/link";
import DailySeqControl from "./DailySeqControl";
import {
  countProjects,
  listProjectIds,
  listAllProjectIds,
  getProjectsBulk,
} from "@/lib/projectStore";
import type { Project } from "@/lib/types";
import ProjectCard from "@/components/ProjectCard";
import driveConfig from "@/config/drive.json";
import { searchTerms, matchesQuery, isLongform } from "@/lib/projectSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 항상 최신 목록(Redis)

// 검색·분류 규칙은 lib/projectSearch.ts 공용(롱폼 묶기 검색과 같은 규칙을 쓰기 위해).

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; n?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const terms = searchTerms(q);
  // 페이지네이션: ?page=(1부터) & ?n=(페이지 크기, 기본 60 — "더 보기"가 +60씩 키움).
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const size = Math.min(300, Math.max(60, parseInt(sp.n ?? "60", 10) || 60));

  let projects: Project[] = [];
  let loadError = false;
  let total = 0;
  try {
    if (q) {
      // 검색은 옛날 것까지 전부 대상 — 전체 id 를 받아 mget 배치로 로드 후 필터.
      const ids = await listAllProjectIds();
      total = ids.length;
      projects = await getProjectsBulk(ids);
    } else {
      total = await countProjects();
      projects = await getProjectsBulk(await listProjectIds((page - 1) * size, size));
    }
  } catch {
    loadError = true;
  }
  const totalPages = Math.max(1, Math.ceil(total / size));
  // 페이지 링크 href — 기본 크기(60)면 n 생략해 URL 을 짧게.
  const pageHref = (p: number, n = size) =>
    `/library?${[p > 1 ? `page=${p}` : "", n !== 60 ? `n=${n}` : ""].filter(Boolean).join("&")}`.replace(/\?$/, "");

  // 드라이브 업로드 완료(재합성 안 됨)는 뒤로, 아직 안 올린 것·재업로드 필요한 것은 앞으로.
  const isUploaded = (p: Project) => !!p.driveLink && p.driveUploadedUrl === p.finalVideoUrl;
  // 롱폼·세그먼트는 일반 라이브러리에서 제외(롱폼 탭에서 폴더로 관리).
  const shown = projects
    .filter((p) => matchesQuery(p, terms))
    .filter((p) => !isLongform(p) && !p.longformId)
    .sort((a, b) => Number(isUploaded(a)) - Number(isUploaded(b)));

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">라이브러리</h1>
        <div className="flex items-center gap-2">
          <DailySeqControl />
          {driveConfig.folderUrl && (
            <a
              href={driveConfig.folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              📁 드라이브 폴더
            </a>
          )}
          <Link
            href="/new"
            className="text-xs font-medium rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5"
          >
            + 새 영상
          </Link>
        </div>
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
          &lsquo;{q}&rsquo; 검색 결과 {shown.length}개 (전체 {total}개 대상 — 옛날 것 포함)
        </p>
      )}

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">목록을 못 불러왔어요 (Redis 설정 확인).</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          {q
            ? `'${q}'에 맞는 영상이 없어요.`
            : "아직 만든 영상이 없어요. “새 영상”으로 시작해보세요."}
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </ul>
      )}

      {/* 페이지네이션 + 더 보기 — 검색 중엔 숨김(검색은 이미 전체 대상). */}
      {!q && !loadError && total > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              ← 이전
            </Link>
          )}
          <span className="px-2 text-xs text-zinc-500">
            {page} / {totalPages} 페이지 · 전체 {total}개
          </span>
          {page < totalPages && (
            <Link
              href={pageHref(page + 1)}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              다음 →
            </Link>
          )}
          {page === 1 && total > size && size < 300 && (
            <Link
              href={pageHref(1, size + 60)}
              className="rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10"
            >
              더 보기 +60
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
