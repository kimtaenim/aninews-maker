import Link from "next/link";
import { listProjectIds, getProjectsBulk } from "@/lib/projectStore";
import type { Project } from "@/lib/types";
import ProjectCard from "@/components/ProjectCard";
import LongformDeleteButton from "./LongformDeleteButton";
import { elongatedStage, formatSeconds, isElongated, multiplier } from "@/lib/elongated";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 컴필레이션 = 세그먼트 id들을 참조하는 가로 프로젝트(여러 편을 이어붙인 것).
function isCompilation(p: Project): boolean {
  return p.format === "long" && Array.isArray(p.sourceProjectIds) && p.sourceProjectIds.length > 0;
}

// 롱폼 탭 — 두 갈래를 상단 탭으로 가른다.
//   · 컴필레이션: 완성 숏폼 여러 편을 묶은 롱폼(기존)
//   · 확장판: 검증된 숏폼 한 편을 길게 늘린 롱폼
export default async function LongformListPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const tab: "compilation" | "elongated" = kind === "elongated" ? "elongated" : "compilation";

  let compilations: Project[] = [];
  let elongateds: Project[] = [];
  // 폴더 자식: [진행자(있으면), ...세그먼트] 순.
  const childrenByLongform = new Map<string, Project[]>();
  let loadError = false;
  try {
    const ids = await listProjectIds(0, 300);
    const projects = await getProjectsBulk(ids);
    compilations = projects.filter(isCompilation).sort((a, b) => b.updatedAt - a.updatedAt);
    elongateds = projects.filter(isElongated).sort((a, b) => b.updatedAt - a.updatedAt);
    // 각 롱폼의 진행자·세그먼트를 id 로 로드(순서 유지, 페이지 무관).
    const childIds = [
      ...new Set(
        compilations.flatMap((l) => [
          ...(l.hostProjectId ? [l.hostProjectId] : []),
          ...(l.sourceProjectIds ?? []),
        ])
      ),
    ];
    const kids = childIds.length ? await getProjectsBulk(childIds) : [];
    const kidById = new Map(kids.map((s) => [s.id, s]));
    for (const l of compilations) {
      const ordered = [
        ...(l.hostProjectId ? [l.hostProjectId] : []),
        ...(l.sourceProjectIds ?? []),
      ]
        .map((id) => kidById.get(id))
        .filter((s): s is Project => !!s);
      childrenByLongform.set(l.id, ordered);
    }
  } catch {
    loadError = true;
  }

  const tabClass = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-medium text-center transition-colors ${
      active
        ? "bg-white dark:bg-zinc-950 text-accent shadow-sm"
        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
    }`;

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <h1 className="text-lg font-semibold tracking-tight">🎞 롱폼</h1>

      {/* 갈래 — 여러 편을 묶을 것인지, 한 편을 늘릴 것인지 */}
      <div className="mt-3 flex gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 p-1">
        <Link href="/longform" className={tabClass(tab === "compilation")}>
          컴필레이션
        </Link>
        <Link href="/longform?kind=elongated" className={tabClass(tab === "elongated")}>
          확장판
        </Link>
      </div>

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">목록을 못 불러왔어요 (Redis 설정 확인).</p>
      ) : tab === "compilation" ? (
        <>
          <div className="mt-4 flex items-start justify-between gap-3">
            <p className="text-xs text-zinc-500">
              완성 숏폼 여러 편을 묶은 가로 16:9 롱폼. 각 폴더 안에 롱폼과 그 세그먼트(가로판)가
              들어있어요.
            </p>
            <Link
              href="/longform/new"
              className="shrink-0 text-xs font-medium rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5"
            >
              + 숏폼 묶기
            </Link>
          </div>

          {compilations.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-500">
              아직 묶은 롱폼이 없어요.{" "}
              <Link href="/longform/new" className="text-accent underline">
                숏폼을 묶어보세요.
              </Link>
            </p>
          ) : (
            <ul className="mt-6 grid gap-3">
              {compilations.map((l) => {
                const children = childrenByLongform.get(l.id) ?? [];
                const segCount = (l.sourceProjectIds ?? []).length;
                return (
                  <li key={l.id}>
                    <details open className="rounded-2xl border border-accent/40 bg-accent/5 p-2">
                      <summary className="cursor-pointer select-none flex items-center gap-2 px-1 py-1 text-sm font-medium">
                        <span aria-hidden>📁</span>
                        <span className="line-clamp-1 flex-1">{l.title}</span>
                        <span className="shrink-0 text-[11px] text-zinc-500">
                          세그먼트 {segCount}
                          {l.hostProjectId ? " · 진행자" : ""}
                          {l.finalVideoUrl ? " · 완성" : ""}
                        </span>
                        <LongformDeleteButton projectId={l.id} title={l.title} />
                      </summary>
                      <ul className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {[l, ...children].map((c) => (
                          <ProjectCard key={c.id} p={c} />
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="mt-4 flex items-start justify-between gap-3">
            <p className="text-xs text-zinc-500">
              잘 나간 숏폼 한 편을 길게 늘린 가로 16:9 롱폼. 원본 대본은 읽기만 하고 손대지 않아요.
            </p>
            <Link
              href="/longform/new/elongated"
              className="shrink-0 text-xs font-medium rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5"
            >
              + 확장판 만들기
            </Link>
          </div>

          {elongateds.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-500">
              아직 확장판이 없어요.{" "}
              <Link href="/longform/new/elongated" className="text-accent underline">
                숏폼 한 편을 늘려보세요.
              </Link>
            </p>
          ) : (
            <ul className="mt-6 grid gap-2">
              {elongateds.map((l) => {
                const t = l.elongated!;
                const stage = elongatedStage(l);
                const x = multiplier(t.sourceSeconds, t.targetSec);
                return (
                  <li
                    key={l.id}
                    className="rounded-2xl border border-accent/40 bg-accent/5 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span aria-hidden>📄</span>
                      <Link
                        href={`/project/${l.id}`}
                        className="line-clamp-1 flex-1 text-sm font-medium hover:text-accent"
                      >
                        {l.title}
                      </Link>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                          stage.key === "done"
                            ? "bg-accent text-white"
                            : "bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        {stage.label}
                      </span>
                      <LongformDeleteButton projectId={l.id} title={l.title} kind="elongated" />
                    </div>
                    <p className="mt-1 pl-6 text-[11px] text-zinc-500 line-clamp-1">
                      원본 {t.sourceTitle} · {formatSeconds(t.sourceSeconds)} →{" "}
                      {formatSeconds(t.targetSec)}
                      {x ? ` (약 ${x}배)` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
