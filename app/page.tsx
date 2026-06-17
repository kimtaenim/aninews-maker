import Link from "next/link";
import { STEP_ORDER } from "@/lib/types";

const STEP_LABELS: Record<string, string> = {
  source: "소스",
  script: "스크립트",
  keyframe: "키프레임",
  images: "이미지",
  videos: "영상",
  voiceover: "보이스오버",
  compose: "합성",
  subtitle: "자막",
};

export default function Home() {
  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <h1 className="text-xl font-semibold tracking-tight">AI인 뉴스영상</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        뉴스 한 건을 받아 스크립트 → 이미지 → 영상 → 합성까지, 단계마다 검수하며
        숏폼 영상 한 편을 만듭니다.
      </p>

      {/* 홈에서 모든 기능에 바로 닿게 — 주 진입점 */}
      <div className="mt-6 grid gap-3">
        <Link
          href="/new"
          className="rounded-2xl bg-accent hover:bg-accent-strong text-white font-semibold px-5 py-4 text-center transition-colors"
        >
          + 새 영상 만들기
        </Link>
        <Link
          href="/library"
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 px-5 py-4 text-center font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
        >
          라이브러리 (만든 영상)
        </Link>
      </div>

      <div className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          파이프라인
        </h2>
        <ol className="mt-3 flex flex-wrap gap-2">
          {STEP_ORDER.map((s, i) => (
            <li
              key={s}
              className="text-xs rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1 text-zinc-600 dark:text-zinc-400"
            >
              {i + 1}. {STEP_LABELS[s]}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
