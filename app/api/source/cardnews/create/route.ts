import { NextRequest, NextResponse } from "next/server";
import { createProject, saveProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { mergeSources } from "@/lib/mergeSources";
import { type SourceMaterial, SOURCE_MAX_INPUT_CHARS } from "@/lib/source";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 120; // 꼭지 여러 개를 한 편으로 묶는 호출이 들어간다

// [카드뉴스 ③] 화면에서 확인·수정한 꼭지들 → 소스 재료 → 프로젝트 생성.
// 꼭지가 여럿이면 기존 mergeSources 가 한 편으로 묶는다(여기서 다시 만들지 않는다).
// 대본은 만들지 않는다 — 스튜디오의 기존 대본 단계가 기존 원칙으로 만든다.
//
// 고른 카드 삽화가 있으면 keyframeReferenceUrl 로 달아 둔다 — 키프레임 단계가 그걸
// 참조로 프로젝트 포맷에 맞춰 새로 그린다(그림이 키프레임 자체가 되는 게 아니다).
//
// JSON: { items: [{ title, body, attribution? }], keyframeReferenceUrl?,
//         userPrompt?, styleProfileId?, videoModelId?, ttsEnabled? }
export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        title: str(o.title),
        body: str(o.body),
        attribution: str(o.attribution),
      };
    })
    .filter((it) => it.body || it.title);

  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "넣을 꼭지가 없어요" },
      { status: 400 }
    );
  }

  const styleProfileId = str(payload.styleProfileId) || DEFAULT_STYLE_PROFILE_ID;
  const videoModelId = str(payload.videoModelId) || videoModels.default;
  try {
    getStyleProfile(styleProfileId);
  } catch {
    return NextResponse.json(
      { ok: false, error: `style profile not found: ${styleProfileId}` },
      { status: 400 }
    );
  }
  const ttsEnabled =
    typeof payload.ttsEnabled === "boolean" ? (payload.ttsEnabled as boolean) : true;
  const userPrompt = str(payload.userPrompt) || undefined;

  // 꼭지 하나 = 소스 하나. 출처 표기는 어느 매체 걸 가져왔는지 기록으로만 남긴다.
  const materials: SourceMaterial[] = items.map((it) => ({
    title: it.title || "(제목 없음)",
    body: it.body.slice(0, SOURCE_MAX_INPUT_CHARS),
    sourceName: it.attribution ? `카드뉴스 · ${it.attribution}` : "카드뉴스",
    sourceUrl: "",
    publishedAt: null,
  }));

  try {
    // 꼭지가 1개면 mergeSources 가 그대로 돌려준다(호출 비용 없음).
    const merged = await mergeSources({ materials, userPrompt });
    const material: SourceMaterial = {
      ...merged,
      title: merged.title.slice(0, 60) || "(제목 없음)",
      body: merged.body.slice(0, SOURCE_MAX_INPUT_CHARS),
    };

    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId,
      videoModelId,
      ttsEnabled,
      userPrompt,
    });

    // 고른 카드 삽화를 키프레임 참조로. createProject 가 받지 않는 필드라 생성 뒤에 단다.
    const ref = str(payload.keyframeReferenceUrl);
    if (ref && /^https:\/\//.test(ref)) {
      project.keyframeReferenceUrl = ref;
      // 카드 삽화는 가로로 넓다 — 구도를 지키라고 하면 세로 틀에 눌린다. 인물·화풍만
      // 가져오고 구도는 출력 비율에 맞춰 다시 잡게 한다.
      project.keyframeReferenceMode = "subject";
      project.updatedAt = Date.now();
      await saveProject(project);
    }

    return NextResponse.json({ ok: true, projectId: project.id, merged: items.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
