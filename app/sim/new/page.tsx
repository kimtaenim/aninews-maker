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
    // 게임화 문턱 = "인물이 있는가" 뿐. 영상 완성도, 포트레이트도 필요 없다.
    // castMembers(캐스팅 위저드 산출물)가 원천이고, 없으면 cast(이름 목록)에서 시드한다
    // — 캐스팅 위저드 이전에 만든 프로젝트도 게임으로 만들 수 있게.
    sources = cliche
      .map((p) => {
        const members = p.castMembers?.length
          ? p.castMembers.map((m) => ({
              name: m.name,
              archetype: m.archetype,
              portraitUrl: m.portraitUrl,
            }))
          : (p.cast ?? []).map((name) => ({
              name,
              archetype: undefined,
              portraitUrl: undefined,
            }));
        return {
          id: p.id,
          title: p.title,
          members,
          hasVideo: !!(p.cleanVideoUrl || p.finalVideoUrl),
        };
      })
      .filter((s) => s.members.length > 0);
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
      ) : (
        // 클리셰 프로젝트가 없어도 '직접 만들기'로 게임을 만들 수 있으니 항상 폼을 띄운다.
        <SimNewForm sources={sources} videos={videos} />
      )}
    </main>
  );
}
