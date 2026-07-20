import Link from "next/link";
import { listProjectIds, getProjectsBulk } from "@/lib/projectStore";
import type { Project } from "@/lib/types";
import ProjectCard from "@/components/ProjectCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 롱폼 = 세그먼트 id들을 참조하는 가로 프로젝트.
function isLongform(p: Project): boolean {
  return p.format === "long" && Array.isArray(p.sourceProjectIds) && p.sourceProjectIds.length > 0;
}

// 롱폼 전용 탭 — 롱폼들을 폴더로(롱폼 + 세그먼트). 일반 라이브러리와 분리 관리.
export default async function LongformListPage() {
  let longforms: Project[] = [];
  // 폴더 자식: [진행자(있으면), ...세그먼트] 순.
  const childrenByLongform = new Map<string, Project[]>();
  let loadError = false;
  try {
    const ids = await listProjectIds(0, 300);
    const projects = await getProjectsBulk(ids);
    longforms = projects.filter(isLongform).sort((a, b) => b.updatedAt - a.updatedAt);
    // 각 롱폼의 진행자·세그먼트를 id 로 로드(순서 유지, 페이지 무관).
    const childIds = [
      ...new Set(
        longforms.flatMap((l) => [
          ...(l.hostProjectId ? [l.hostProjectId] : []),
          ...(l.sourceProjectIds ?? []),
        ])
      ),
    ];
    const kids = childIds.length ? await getProjectsBulk(childIds) : [];
    const kidById = new Map(kids.map((s) => [s.id, s]));
    for (const l of longforms) {
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

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">🎞 롱폼</h1>
        <Link
          href="/longform/new"
          className="text-xs font-medium rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5"
        >
          + 롱폼 묶기
        </Link>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        완성 숏폼을 묶은 가로 16:9 롱폼. 각 폴더 안에 롱폼과 그 세그먼트(가로판)가 들어있어요.
      </p>

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">목록을 못 불러왔어요 (Redis 설정 확인).</p>
      ) : longforms.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          아직 롱폼이 없어요.{" "}
          <Link href="/longform/new" className="text-accent underline">
            숏폼을 묶어보세요.
          </Link>
        </p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {longforms.map((l) => {
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
    </main>
  );
}
