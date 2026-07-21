import { notFound } from "next/navigation";
import { getProject, getProjectsBulk } from "@/lib/projectStore";
import { listStyleProfiles } from "@/lib/styleProfiles";
import { listVideoModels } from "@/lib/videoProvider";
import { ttsProviderInfo } from "@/lib/tts";
import { getTitleLog } from "@/lib/titleLog";
import { getReviewLog } from "@/lib/scriptReviewLog";
import { reviewFingerprint } from "@/lib/scriptReview";
import Studio from "./Studio";
import LongformStudio from "./LongformStudio";

// 단계별 스튜디오. 스타일 프로필(2D/3D 모드·모션·postFx)을 같이 넘겨 키프레임
// 단계에서 표시·미세조정에 쓴다.
export default async function ProjectStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  // 롱폼(세그먼트 이어붙이기) — 씬이 없고 sourceProjectIds 를 참조한다. 전용 화면으로.
  if (
    project.format === "long" &&
    Array.isArray(project.sourceProjectIds) &&
    project.sourceProjectIds.length > 0
  ) {
    const segs = await getProjectsBulk(project.sourceProjectIds);
    const byId = new Map(segs.map((s) => [s.id, s]));
    const segments = project.sourceProjectIds
      .map((sid) => byId.get(sid))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({
        id: s.id,
        title: s.title,
        keyframeUrl: s.keyframeUrl,
        finalVideoUrl: s.finalVideoUrl,
      }));
    const host = project.hostProjectId ? await getProject(project.hostProjectId) : null;
    const hostProject = host
      ? {
          id: host.id,
          title: host.title,
          keyframeUrl: host.keyframeUrl,
          sceneCount: (host.scenes ?? []).length,
          finalVideoUrl: host.finalVideoUrl,
        }
      : null;
    const lfTitleLog = await getTitleLog(id);
    const lfInitialTitles = lfTitleLog
      ? {
          candidates: lfTitleLog.candidates,
          recommendedIndex: lfTitleLog.recommendedIndex,
          seoKeywords: lfTitleLog.seoKeywords,
        }
      : null;
    return (
      <LongformStudio
        project={{
          id: project.id,
          title: project.title,
          finalVideoUrl: project.finalVideoUrl,
          eyecatchUrl: project.eyecatchUrl,
          sections: project.sections ?? null,
        }}
        segments={segments}
        hostProject={hostProject}
        initialOpening={project.opening ?? null}
        initialTitles={lfInitialTitles}
      />
    );
  }

  const styleProfiles = listStyleProfiles().map((p) => ({ id: p.id, label: p.label }));
  const videoModels = listVideoModels().map((m) => ({ id: m.id, label: m.label }));

  // 저장된 제목 후보(있으면) — 리로드해도 추천 패널이 유지되게 초기값으로 전달.
  const titleLog = await getTitleLog(id);
  const initialTitles = titleLog
    ? {
        candidates: titleLog.candidates,
        recommendedIndex: titleLog.recommendedIndex,
        seoKeywords: titleLog.seoKeywords,
      }
    : null;

  // 저장된 대본 다듬기 결과 — 대본이 그대로일 때(지문 일치)만 복원. 자리 비웠다 와도 진단 유지.
  const reviewLog = await getReviewLog(id);
  const curReviewFp = reviewFingerprint(
    (project.scenes ?? []).filter((s) => !s.skipped).map((s) => s.narration ?? "")
  );
  const initialReview =
    reviewLog && reviewLog.fingerprint === curReviewFp ? { result: reviewLog.result } : null;

  return (
    <Studio
      project={project}
      styleProfiles={styleProfiles}
      videoModels={videoModels}
      tts={ttsProviderInfo()}
      initialTitles={initialTitles}
      initialReview={initialReview}
    />
  );
}
