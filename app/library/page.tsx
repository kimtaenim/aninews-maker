import Link from "next/link";
import DeleteButton from "./DeleteButton";
import { listRecentProjects, getProject } from "@/lib/projectStore";
import { STEP_ORDER, type Project } from "@/lib/types";

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

export default async function LibraryPage() {
  let projects: Project[] = [];
  let loadError = false;
  try {
    const ids = await listRecentProjects(60);
    const loaded = await Promise.all(
      ids.map((id) => getProject(id).catch(() => null))
    );
    projects = loaded.filter((p): p is Project => p !== null);
  } catch {
    loadError = true;
  }

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

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">
          목록을 못 불러왔어요 (Redis 설정 확인).
        </p>
      ) : projects.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          아직 만든 영상이 없어요. “새 영상”으로 시작해보세요.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {projects.map((p) => (
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
                  <p className="mt-1 text-[10px] text-accent font-medium">
                    {progressLabel(p)}
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
