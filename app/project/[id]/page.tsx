import { notFound } from "next/navigation";
import { getProject, getProjectsBulk } from "@/lib/projectStore";
import { listStyleProfiles } from "@/lib/styleProfiles";
import { listVideoModels } from "@/lib/videoProvider";
import { ttsProviderInfo } from "@/lib/tts";
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
    return (
      <LongformStudio
        project={{
          id: project.id,
          title: project.title,
          finalVideoUrl: project.finalVideoUrl,
          eyecatchUrl: project.eyecatchUrl,
        }}
        segments={segments}
        hostProject={hostProject}
        initialOpening={project.opening ?? null}
      />
    );
  }

  const styleProfiles = listStyleProfiles().map((p) => ({ id: p.id, label: p.label }));
  const videoModels = listVideoModels().map((m) => ({ id: m.id, label: m.label }));

  return (
    <Studio
      project={project}
      styleProfiles={styleProfiles}
      videoModels={videoModels}
      tts={ttsProviderInfo()}
    />
  );
}
