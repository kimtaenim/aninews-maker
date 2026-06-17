// 라이브러리 — 완성/진행 중 프로젝트 목록. 골격: 목록 렌더는 합의하며 채운다.
export default function LibraryPage() {
  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <h1 className="text-lg font-semibold tracking-tight">라이브러리</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        만든 영상과 진행 중인 프로젝트가 여기 모입니다. (구현 예정)
      </p>

      <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-sm text-zinc-500">
        TODO: listRecentProjects() → 프로젝트 카드 그리드
      </div>
    </main>
  );
}
