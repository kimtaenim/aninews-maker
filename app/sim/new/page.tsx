import Link from "next/link";
import { getProjectsBulk, listAllProjectIds } from "@/lib/projectStore";
import SimNewForm, { type CutsceneCandidate, type SourceCandidate } from "./SimNewForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 항상 최신 목록(Redis)

// 시뮬 제조기 — 새 게임 만들기. 서버에서 후보를 추려 클라이언트 위저드에 넘긴다.
//  - 상대 후보: 캐스팅(castMembers)이 있는 클리셰 프로젝트
//  - 컷씬 후보: 합성까지 끝난(완성 영상 있는) 클리셰 프로젝트
export default async function SimNewPage() {
  let sources: SourceCandidate[] = [];
  let videos: CutsceneCandidate[] = [];
  let loadError = false;
  try {
    const projects = await getProjectsBulk(await listAllProjectIds());
    const cliche = projects.filter((p) => p.mode === "cliche");
    sources = cliche
      .filter((p) => p.castMembers?.length)
      .map((p) => ({
        id: p.id,
        title: p.title,
        members: (p.castMembers ?? []).map((m) => ({
          name: m.name,
          archetype: m.archetype,
          portraitUrl: m.portraitUrl,
        })),
      }));
    videos = cliche
      .filter((p) => p.cleanVideoUrl || p.finalVideoUrl)
      .map((p) => ({ id: p.id, title: p.title }));
  } catch {
    loadError = true;
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">🎮 새 게임 만들기</h1>
        <Link href="/sim" className="text-sm text-zinc-500 hover:underline">
          ← 게임 목록
        </Link>
      </div>

      {loadError ? (
        <p className="mt-6 text-sm text-red-500">
          프로젝트 목록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.
        </p>
      ) : sources.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-sm text-zinc-500">
          <p>
            상대로 데려올 인물이 없어요. 먼저{" "}
            <Link href="/cliche/new" className="text-accent underline">
              연애 클리셰 영상
            </Link>
            을 만들어 캐스팅(얼굴·목소리)을 확정해 주세요.
          </p>
        </div>
      ) : (
        <SimNewForm sources={sources} videos={videos} />
      )}
    </main>
  );
}
