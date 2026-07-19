import Link from "next/link";
import DeleteButton from "./DeleteButton";
import DriveUploadButton from "./DriveUploadButton";
import DailySeqControl from "./DailySeqControl";
import {
  countProjects,
  listProjectIds,
  listAllProjectIds,
  getProjectsBulk,
} from "@/lib/projectStore";
import { STEP_ORDER, type Project } from "@/lib/types";
import { getLang } from "@/lib/languages";
import { ADMIN_EMAIL } from "@/lib/auth";
import driveConfig from "@/config/drive.json";

// 롱폼 여부 — 세그먼트 id들을 참조하는 가로 프로젝트.
function isLongform(p: Project): boolean {
  return p.format === "long" && Array.isArray(p.sourceProjectIds) && p.sourceProjectIds.length > 0;
}

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

// 프로젝트 카드 한 장(<li>). 평면 목록과 롱폼 폴더 안에서 공용. 가로(롱폼/세그먼트)면 16:9.
function ProjectCard({ p }: { p: Project }) {
  const aspect = p.format === "long" ? "aspect-[16/9]" : "aspect-[9/16]";
  return (
    <li className="relative">
      <DeleteButton projectId={p.id} title={p.title} />
      <Link
        href={`/project/${p.id}`}
        className="block rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:border-accent transition-colors"
      >
        <div className={`${aspect} bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center overflow-hidden`}>
          {p.keyframeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.keyframeUrl} alt={p.title} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] text-zinc-400">미생성</span>
          )}
        </div>
        <div className="p-2">
          <p className="text-xs font-medium line-clamp-2 leading-snug">{p.title}</p>
          <p className="mt-1 text-[10px] font-medium">
            {p.lang && (
              <span className="mr-1 rounded bg-accent/10 px-1 py-0.5 text-accent">
                {getLang(p.lang)?.label ?? p.lang}
              </span>
            )}
            {p.format === "long" && (
              <span className="mr-1 rounded bg-accent/10 px-1 py-0.5 text-accent">가로</span>
            )}
            <span className="text-accent">{progressLabel(p)}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-400 truncate">
            🧑 {p.ownerEmail ?? ADMIN_EMAIL}
          </p>
        </div>
      </Link>
      {p.finalVideoUrl && (
        <DriveUploadButton
          projectId={p.id}
          driveLink={p.driveLink}
          fileName={p.driveFileName}
          uploaded={!!p.driveLink && p.driveUploadedUrl === p.finalVideoUrl}
        />
      )}
    </li>
  );
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; n?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
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

  // 드라이브 업로드 완료(재합성 안 됨)는 뒤로, 아직 안 올린 것·재업로드 필요한 것은
  // 앞으로. 그룹 안에서는 기존 순서(최신순) 유지(Array.sort 는 안정 정렬).
  const isUploaded = (p: Project) =>
    !!p.driveLink && p.driveUploadedUrl === p.finalVideoUrl;
  const shown = projects
    .filter((p) => matchesQuery(p, terms))
    .sort((a, b) => Number(isUploaded(a)) - Number(isUploaded(b)));

  // 롱폼 폴더 — longformId 가 있는 세그먼트를 롱폼별로 모으고 평면 목록에선 뺀다.
  // longformId 를 가진 "새" 항목만 폴더로 묶임(기존 항목은 필드가 없어 그대로 평면).
  const segByLongform = new Map<string, Project[]>();
  for (const p of shown) {
    if (p.longformId) {
      const arr = segByLongform.get(p.longformId) ?? [];
      arr.push(p);
      segByLongform.set(p.longformId, arr);
    }
  }
  const topLevel = shown.filter((p) => !p.longformId);

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
            href="/longform/new"
            className="text-xs font-medium rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10"
          >
            🎞 롱폼 묶기
          </Link>
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
          {topLevel.map((p) => {
            const segs = isLongform(p) ? segByLongform.get(p.id) ?? [] : [];
            // 롱폼 + 그 세그먼트가 있으면 접이식 폴더로(롱폼 이름). 없으면 평면 카드.
            if (segs.length > 0) {
              return (
                <li key={p.id} className="col-span-2 sm:col-span-3">
                  <details className="rounded-2xl border border-accent/40 bg-accent/5 p-2">
                    <summary className="cursor-pointer select-none flex items-center gap-2 px-1 py-1 text-sm font-medium">
                      <span aria-hidden>📁</span>
                      <span className="line-clamp-1 flex-1">{p.title}</span>
                      <span className="shrink-0 text-[11px] text-zinc-500">
                        세그먼트 {segs.length} · 롱폼
                      </span>
                    </summary>
                    <ul className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[p, ...segs].map((c) => (
                        <ProjectCard key={c.id} p={c} />
                      ))}
                    </ul>
                  </details>
                </li>
              );
            }
            return <ProjectCard key={p.id} p={p} />;
          })}
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
