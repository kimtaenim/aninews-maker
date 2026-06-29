import { NextRequest, NextResponse } from "next/server";
import { getProject, createProject, saveProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { translateNarrations } from "@/lib/translate";
import { resolveLang, KOREAN } from "@/lib/languages";
import { estimateDuration } from "@/lib/scenes";
import type { SourceMaterial } from "@/lib/source";
import type { Scene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// 다국어 개편 — 소스 프로젝트를 고른 언어로 번역한 "새 프로젝트"를 만든다(라이브러리
// 별도 항목). 번역된 나레이션 + 한글 이미지 프롬프트 + 영문 모션 + 스타일/모드를
// 복제하고, 키프레임·이미지·영상·음성은 비운다(새 프로젝트에서 직접 생성).
// 2단계(스크립트)는 generated(검수 대기)로 둔다.
// body: { projectId, lang }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const lang = resolveLang(body.lang ?? "");
  if (!lang) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 언어" }, { status: 422 });
  }

  const source = await getProject(projectId);
  if (!source) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (source.scenes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "스크립트가 없어요 (먼저 스크립트를 만들어주세요)" },
      { status: 422 }
    );
  }
  // 소스 언어(빈 lang = 한국어 원본). 같은 언어로는 만들 수 없다.
  const srcLang = resolveLang(source.lang) ?? KOREAN;
  if (lang.code === srcLang.code) {
    return NextResponse.json(
      { ok: false, error: `이미 ${lang.label}판이에요` },
      { status: 422 }
    );
  }

  try {
    // 1) 나레이션 번역(소스 언어 → 대상 언어)
    const { translations } = await translateNarrations(
      source.id,
      source.scenes.map((s) => s.narration),
      lang.english,
      srcLang.english
    );

    // 2) 소스 material 로 새 프로젝트 골격 생성
    const material =
      (source.steps.source.params?.material as SourceMaterial | undefined) ?? {
        title: source.title,
        body: "",
        sourceName: "",
        sourceUrl: "",
        publishedAt: null,
      };
    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId: source.styleProfileId,
      videoModelId: source.videoModelId,
      ttsEnabled: source.ttsEnabled,
      userPrompt: source.userPrompt,
    });

    // 3) 복제 데이터 덮어쓰기 — 번역 나레이션 + 한글 프롬프트 + 영문 모션 + 스타일.
    const now = Date.now();
    project.title = `${source.title} (${lang.label})`;
    project.styleBible = source.styleBible;
    project.subtitle = source.subtitle ? { ...source.subtitle, lang: "ko" } : source.subtitle;
    project.ttsProvider = source.ttsProvider;
    project.watermark = source.watermark;
    project.lang = lang.code;
    project.sourceProjectId = source.id;
    project.scenes = source.scenes.map((s, i): Scene => {
      const narration = (translations[i] ?? s.narration).trim();
      return {
        index: s.index,
        narration,
        imagePrompt: s.imagePrompt, // 한글 프롬프트 그대로 가져옴
        motion: s.motion, // 영문 모션 그대로 가져옴(언어 무관)
        durationSec: estimateDuration(narration), // 번역문 길이로 재계산
        imageSource: "generate", // 미디어는 새로 — 참조/업로드 모드는 초기화
        paletteHint: s.paletteHint,
        status: "generated",
      };
    });
    project.steps.source.status = "approved";
    project.steps.script = {
      kind: "script",
      status: "generated",
      params: {},
      chat: [],
      updatedAt: now,
    };
    project.updatedAt = now;
    await saveProject(project);

    return NextResponse.json({ ok: true, projectId: project.id, lang: lang.code });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "다국어판 생성 실패" },
      { status: 500 }
    );
  }
}
