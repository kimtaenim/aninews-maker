import NewProjectForm from "./NewProjectForm";
import { listCategories } from "@/lib/rss";

// 새 영상 — 소스 입력만. 스타일·모델·음성·자막은 스튜디오 각 단계에서.
export default function NewProjectPage() {
  const categories = listCategories();
  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <h1 className="text-lg font-semibold tracking-tight">새 영상 — 소스 입력</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        RSS · 뉴스 URL · 텍스트 중 하나로 시작하세요.
      </p>
      <NewProjectForm categories={categories} />
    </main>
  );
}
