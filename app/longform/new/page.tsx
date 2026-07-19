import Link from "next/link";
import { listProjectIds, getProjectsBulk } from "@/lib/projectStore";
import LongformNewForm from "./LongformNewForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 롱폼 묶기 화면 — 완성된 숏폼들을 골라 순서대로 가로 롱폼으로 묶는다.
// 선택 대상은 "완성본(finalVideoUrl)이 있는 세로 숏폼"(가로판/롱폼 자신은 제외).
export default async function LongformNewPage() {
  let shorts: { id: string; title: string; keyframeUrl?: string }[] = [];
  let loadError = false;
  try {
    const ids = await listProjectIds(0, 200);
    const projects = await getProjectsBulk(ids);
    shorts = projects
      .filter((p) => p.format !== "long" && !!p.finalVideoUrl)
      .map((p) => ({ id: p.id, title: p.title, keyframeUrl: p.keyframeUrl }));
  } catch {
    loadError = true;
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">롱폼 묶기</h1>
        <Link
          href="/longform"
          className="text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          ← 롱폼
        </Link>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        완성된 숏폼 2~12편을 골라 가로 16:9 롱폼으로 묶어요. <b>고른 순서</b>가 이어붙이는 순서입니다.
        각 숏폼은 16:9로 재생성(대본·음성 재활용)되고, 세그먼트 사이엔 구독 아이캐치가 들어갑니다.
      </p>

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">목록을 못 불러왔어요 (Redis 설정 확인).</p>
      ) : (
        <LongformNewForm shorts={shorts} />
      )}
    </main>
  );
}
