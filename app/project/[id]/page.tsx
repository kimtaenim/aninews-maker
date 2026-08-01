import { notFound } from "next/navigation";
import { formatKrw, totalCostUsd } from "@/lib/cost";
import { getProject, getProjectsBulk } from "@/lib/projectStore";
import { listStyleProfiles } from "@/lib/styleProfiles";
import { listVideoModels } from "@/lib/videoProvider";
import { ttsProviderInfo } from "@/lib/tts";
import { getTitleLog } from "@/lib/titleLog";
import { getReviewLog } from "@/lib/scriptReviewLog";
import { getCritiqueLog } from "@/lib/scriptCritiqueLog";
import { reviewFingerprint } from "@/lib/scriptReview";
import Studio from "./Studio";
import LongformStudio from "./LongformStudio";
import ElongatedStudio from "./ElongatedStudio";
import {
  CUSTOM_MAX_SEC,
  CUSTOM_MIN_SEC,
  PRESETS,
  MAX_RECOMMENDED_MULTIPLIER,
  chapterCharBudget,
  chapterCount,
  estimateElongatedCost,
  isElongated,
} from "@/lib/elongated";

// 단계별 스튜디오. 스타일 프로필(2D/3D 모드·모션·postFx)을 같이 넘겨 키프레임
// 단계에서 표시·미세조정에 쓴다.
export default async function ProjectStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const { id } = await params;
  const { stage } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  // 확장판 — 쇼츠 한 편을 늘린 롱폼. 세그먼트가 없고 elongated 트랙을 갖는다. 전용 화면으로.
  // ?stage=render 면 그림·영상·합성을 하려는 것이므로 기존 스튜디오를 그대로 띄운다
  // (확장판 전용 렌더 경로를 만들지 않는다 — 씬만 펼쳐 주고 그 뒤는 기존 파이프라인).
  if (isElongated(project) && stage !== "render") {
    const track = project.elongated!;
    const source = await getProject(track.sourceProjectId);
    const sourceScenes = (source?.scenes ?? [])
      .filter((s) => !s.skipped)
      .map((s, i) => ({ index: i, narration: s.narration ?? "" }));
    return (
      <ElongatedStudio
        project={{ id: project.id, title: project.title }}
        track={track}
        sourceScenes={sourceScenes}
        sourceExists={!!source}
        presets={PRESETS}
        minSec={CUSTOM_MIN_SEC}
        maxSec={CUSTOM_MAX_SEC}
        spentKrw={formatKrw(await totalCostUsd(project.id))}
        chapterBudget={chapterCharBudget(
          track.targetSec,
          track.plan?.chapters.length ?? chapterCount(track.targetSec, sourceScenes.length)
        )}
        sceneCount={(project.scenes ?? []).length}
        maxMultiplier={MAX_RECOMMENDED_MULTIPLIER}
        estimate={estimateElongatedCost(track.targetSec)}
        estimatesByPreset={Object.fromEntries(
          PRESETS.map((p) => [p.targetSec, estimateElongatedCost(p.targetSec)])
        )}
      />
    );
  }

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
    // ★ 진행자 씬(오프닝·연결·엔딩)의 그림·영상·음성은 숏폼과 똑같은 화면으로 만든다
    // (사용자 지정 2026-08-01). 그래서 진행자 프로젝트 전문을 Studio 에 그대로 태운다.
    const host = project.hostProjectId ? await getProject(project.hostProjectId) : null;
    const hostProject = host
      ? {
          id: host.id,
          title: host.title,
          keyframeUrl: host.keyframeUrl,
          sceneCount: (host.scenes ?? []).length,
          finalVideoUrl: host.finalVideoUrl,
          // 재생 순서 화면이 진행자 구간을 씬 단위로 그린다 — 어느 씬이 그림·영상까지
          // 됐는지 여기서 보여야 세그먼트와 같은 눈으로 진행 상황이 읽힌다.
          scenes: (host.scenes ?? []).map((s) => ({
            index: s.index,
            hostSlot: s.hostSlot,
            connectorAfter: s.connectorAfter,
            narration: s.narration,
            imageUrl: s.imageUrl,
            videoUrl: s.videoUrl,
            durationSec: s.durationSec,
          })),
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
        hostFull={host ?? null}
        studioProps={{
          styleProfiles: listStyleProfiles().map((p) => ({ id: p.id, label: p.label })),
          videoModels: listVideoModels().map((m) => ({ id: m.id, label: m.label })),
          tts: ttsProviderInfo(),
        }}
        initialTitle={project.longformTitle ?? null}
        initialScript={project.longformScript ?? null}
        initialThumbnail={project.thumbnail ?? null}
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

  // 저장된 비판 검수 — 반영 목록은 씬 번호로 붙으므로, 대본이 바뀌었으면 복원하지 않는다
  // (번호가 밀려 엉뚱한 씬에 반영되는 사고 방지). stale 이면 그냥 안 띄우고 재검수 유도.
  const critiqueLog = await getCritiqueLog(id);
  const initialCritique =
    critiqueLog && critiqueLog.fingerprint === curReviewFp ? critiqueLog : null;

  return (
    <Studio
      project={project}
      styleProfiles={styleProfiles}
      videoModels={videoModels}
      tts={ttsProviderInfo()}
      initialTitles={initialTitles}
      initialReview={initialReview}
      initialCritique={initialCritique}
    />
  );
}
