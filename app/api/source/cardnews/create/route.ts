import { NextRequest, NextResponse } from "next/server";
import { createProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { type SourceMaterial, SOURCE_MAX_INPUT_CHARS } from "@/lib/source";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 60;

// [카드뉴스 ③] 화면에서 확인·수정한 내용 + 출처 검색 결과 → 소스 재료 → 프로젝트 생성.
// 대본은 만들지 않는다 — 스튜디오의 기존 대본 단계가 기존 원칙으로 만든다.
//
// JSON: { title, body, attribution?, research?, sourceUrl?, userPrompt?,
//         styleProfileId?, videoModelId?, ttsEnabled? }
export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const str = (k: string): string =>
    typeof payload[k] === "string" ? (payload[k] as string).trim() : "";

  const cardBody = str("body");
  if (!cardBody) {
    return NextResponse.json(
      { ok: false, error: "카드뉴스 내용이 비어 있어요" },
      { status: 400 }
    );
  }

  const styleProfileId = str("styleProfileId") || DEFAULT_STYLE_PROFILE_ID;
  const videoModelId = str("videoModelId") || videoModels.default;
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

  const attribution = str("attribution");
  const research = str("research");

  // 카드뉴스 내용 + 출처에서 확인한 사실을 한 덩어리 원재료로 합친다.
  const parts = [cardBody];
  if (research) {
    parts.push(
      [
        attribution ? `출처에서 확인한 내용 (카드뉴스 표기: ${attribution})` : "출처에서 확인한 내용",
        research,
      ].join("\n")
    );
  }
  let body = parts.join("\n\n").trim();
  let note: string | undefined;
  if (body.length > SOURCE_MAX_INPUT_CHARS) {
    body = body.slice(0, SOURCE_MAX_INPUT_CHARS);
    note = `본문 ${SOURCE_MAX_INPUT_CHARS}자 초과 — 앞부분만 사용`;
  }

  const material: SourceMaterial = {
    title: str("title").slice(0, 60) || "(제목 없음)",
    body,
    sourceName: attribution ? `카드뉴스 · ${attribution}` : "카드뉴스",
    sourceUrl: str("sourceUrl"),
    publishedAt: null,
  };

  try {
    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId,
      videoModelId,
      ttsEnabled,
      userPrompt: str("userPrompt") || undefined,
    });
    return NextResponse.json({ ok: true, projectId: project.id, note });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
