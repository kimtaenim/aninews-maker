import { NextRequest, NextResponse } from "next/server";
import { OfficeParser } from "officeparser";
import {
  classifyFile,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  type FileKind,
} from "@/lib/attachments";
import { ocrImage } from "@/lib/imageOcr";
import { createProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { type SourceMaterial, SOURCE_MAX_INPUT_CHARS } from "@/lib/source";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 120;

// 1. source (파일 첨부) — PDF·이미지·docx/xlsx/pptx 첨부 → 텍스트 추출 → 한 편의
// 원재료(SourceMaterial)로 합본 → 프로젝트 생성 → { projectId }.
//
// aninews 는 "첨부 1묶음 → 영상 1편" 이라 cardnews 의 멀티 분할은 빼고, 추출 텍스트를
// [파일명] 헤더로 합본해 단일 SourceMaterial 로 만든다.
//   - 이미지: Haiku vision OCR (lib/imageOcr)
//   - 그 외(PDF·Office): officeparser v7 (OfficeParser.parseOffice → ast.toText())
//
// FormData: file (복수) + userPrompt? + styleProfileId? + videoModelId? + ttsEnabled?
export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid FormData" }, { status: 400 });
  }

  const files = formData.getAll("file").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "파일 1개 이상 필요" }, { status: 400 });
  }

  // size guard — 클라이언트도 검증하지만 서버에서 한 번 더.
  let totalSize = 0;
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: `${f.name} 이(가) 10MB 초과` },
        { status: 400 }
      );
    }
    totalSize += f.size;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { ok: false, error: "전체 첨부 30MB 초과" },
      { status: 400 }
    );
  }

  const styleProfileId =
    (typeof formData.get("styleProfileId") === "string" &&
      (formData.get("styleProfileId") as string)) ||
    DEFAULT_STYLE_PROFILE_ID;
  const videoModelId =
    (typeof formData.get("videoModelId") === "string" &&
      (formData.get("videoModelId") as string)) ||
    videoModels.default;
  try {
    getStyleProfile(styleProfileId);
  } catch {
    return NextResponse.json(
      { ok: false, error: `style profile not found: ${styleProfileId}` },
      { status: 400 }
    );
  }

  const userPromptRaw = formData.get("userPrompt");
  const userPrompt =
    typeof userPromptRaw === "string" && userPromptRaw.trim()
      ? userPromptRaw.trim()
      : undefined;
  const ttsRaw = formData.get("ttsEnabled");
  const ttsEnabled = typeof ttsRaw === "string" ? ttsRaw !== "false" : true;

  // 1) 파일별 텍스트 추출.
  const errors: string[] = [];
  const perFile: Array<{ name: string; kind: FileKind; text: string }> = [];

  for (const f of files) {
    const kind = classifyFile(f);
    if (!kind) {
      errors.push(`${f.name}: 지원 안 하는 형식`);
      continue;
    }
    try {
      const buffer = Buffer.from(await f.arrayBuffer());
      let body = "";
      if (kind === "image") {
        const { text } = await ocrImage(buffer, f.type || "image/png");
        body = text.trim();
      } else {
        const ast = await OfficeParser.parseOffice(buffer);
        body = ast.toText().trim();
      }
      if (!body) errors.push(`${f.name}: 추출 텍스트 비어있음`);
      perFile.push({ name: f.name, kind, text: body });
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : "추출 실패"}`);
      perFile.push({ name: f.name, kind, text: "" });
    }
  }

  // 2) 추출 텍스트 합본 ([파일명] 헤더 + 구분선).
  const combinedParts: string[] = [];
  for (const { name, text } of perFile) {
    if (!text) continue;
    combinedParts.push(`[${name}]\n${text}`);
  }
  let combined = combinedParts.join("\n\n---\n\n").trim();

  if (!combined) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "첨부에서 추출된 텍스트가 없어요 (이미지·암호화 PDF 등). 텍스트 모드로 직접 붙여넣기를 권장해요.",
        errors,
      },
      { status: 422 }
    );
  }

  if (combined.length > SOURCE_MAX_INPUT_CHARS) {
    combined = combined.slice(0, SOURCE_MAX_INPUT_CHARS);
    errors.push(`합본 텍스트 ${SOURCE_MAX_INPUT_CHARS}자 초과 — 앞부분만 사용`);
  }

  // 첨부 종류가 1종이면 그 라벨, 여러 종이면 "첨부 (mixed)".
  const kinds = new Set(perFile.filter((p) => p.text).map((p) => p.kind));
  const sourceName =
    kinds.size === 1 ? `첨부 ${[...kinds][0].toUpperCase()}` : "첨부 파일";
  const firstNamed = perFile.find((p) => p.text)?.name ?? files[0].name;
  const title = firstNamed.replace(/\.[^.]+$/, "").slice(0, 60) || "(제목 없음)";

  const material: SourceMaterial = {
    title,
    body: combined,
    sourceName,
    sourceUrl: "",
    publishedAt: null,
  };

  try {
    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId,
      videoModelId,
      ttsEnabled,
      userPrompt,
    });
    return NextResponse.json({
      ok: true,
      projectId: project.id,
      files: perFile.filter((p) => p.text).length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
