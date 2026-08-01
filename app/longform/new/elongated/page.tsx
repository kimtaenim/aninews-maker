import Link from "next/link";
import { listProjectIds, getProjectsBulk } from "@/lib/projectStore";
import { isBundleCandidate } from "@/lib/projectSearch";
import {
  sourceSeconds,
  PRESETS,
  CUSTOM_MIN_SEC,
  CUSTOM_MAX_SEC,
  MAX_RECOMMENDED_MULTIPLIER,
  costRates,
} from "@/lib/elongated";
import ElongatedNewForm from "./ElongatedNewForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 확장판 만들기 — 잘 나간 숏폼 한 편을 골라 목표 길이를 정한다.
// 고를 수 있는 것은 완성된 세로 숏폼(가로판·롱폼 제외) — 묶기 화면과 같은 후보 규칙.
export default async function ElongatedNewPage() {
  let shorts: {
    id: string;
    title: string;
    keyframeUrl?: string;
    sceneCount: number;
    speakSec: number;
    createdAt: number;
  }[] = [];
  let loadError = false;
  try {
    const ids = await listProjectIds(0, 200);
    const projects = await getProjectsBulk(ids);
    shorts = projects.filter(isBundleCandidate).map((p) => ({
      id: p.id,
      title: p.title,
      keyframeUrl: p.keyframeUrl,
      sceneCount: (p.scenes ?? []).filter((s) => !s.skipped).length,
      speakSec: sourceSeconds(p.scenes ?? []),
      createdAt: p.createdAt,
    }));
  } catch {
    loadError = true;
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">확장판 만들기</h1>
        <Link
          href="/longform?kind=elongated"
          className="text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          ← 롱폼
        </Link>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        잘 나간 숏폼 <b>한 편</b>을 골라 길게 늘려요. 원본 대본은 <b>읽기만</b> 하고 손대지 않습니다.
        아래 검색은 <b>제목·나레이션</b>을 옛날 것까지 뒤집니다.
      </p>

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">목록을 못 불러왔어요 (Redis 설정 확인).</p>
      ) : (
        <ElongatedNewForm
          shorts={shorts}
          presets={PRESETS}
          minSec={CUSTOM_MIN_SEC}
          maxSec={CUSTOM_MAX_SEC}
          rates={costRates()}
          maxMultiplier={MAX_RECOMMENDED_MULTIPLIER}
        />
      )}
    </main>
  );
}
