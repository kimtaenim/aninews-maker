import NewProjectForm from "./NewProjectForm";
import { listStyleProfiles } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

// 새 영상 — 소스 입력 (URL / 텍스트). RSS 는 다음 단계에서.
export default function NewProjectPage() {
  const profiles = listStyleProfiles().map((p) => ({ id: p.id, label: p.label }));
  const models = (videoModels.models as { id: string; label: string }[]).map((m) => ({
    id: m.id,
    label: m.label,
  }));
  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <h1 className="text-lg font-semibold tracking-tight">새 영상 — 소스 입력</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        뉴스 URL 또는 텍스트로 시작합니다. 스타일을 고르면 전 단계에 적용됩니다.
      </p>
      <NewProjectForm
        profiles={profiles}
        models={models}
        defaultModel={videoModels.default}
      />
    </main>
  );
}
