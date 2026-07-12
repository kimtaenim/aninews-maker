import { NextRequest, NextResponse } from "next/server";
import { createProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { getStyleProfile } from "@/lib/styleProfiles";
import type { SourceMaterial } from "@/lib/source";
import type { CastMember } from "@/lib/types";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 30;

// ani-cliché — 연애 클리셰 미니 영상 프로젝트 생성. 뉴스 소스 대신 "트로프"로 시작.
// body: { tropes: string[], styleProfileId?, userPrompt? }
// mode="cliche" 로 만들고, 2단계(script)는 generateClicheScript 로 분기(대사+화자 씬).
export async function POST(req: NextRequest) {
  let body: {
    tropes?: unknown;
    characters?: unknown;
    castMembers?: unknown; // 캐스팅 위저드 산출물(얼굴·목소리 포함) — 있으면 characters 보다 우선
    styleProfileId?: string;
    userPrompt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const tropes = (Array.isArray(body.tropes) ? body.tropes : [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
  if (tropes.length === 0) {
    return NextResponse.json({ ok: false, error: "클리셰(트로프)를 하나 이상 골라주세요" }, { status: 400 });
  }

  // 캐스팅 위저드 산출물 — [{name, archetype, faceSource, faceUploadUrl, faceDesc, portraitUrl, voiceId}].
  // 있으면 이게 인물 정보의 원천(characters 는 무시). cast/castVoices 는 여기서 파생·동기화.
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const castMembers: CastMember[] = (Array.isArray(body.castMembers) ? body.castMembers : [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m, i) => ({
      name: s(m.name) || `인물${i + 1}`,
      ...(s(m.archetype) ? { archetype: s(m.archetype) } : {}),
      ...(m.faceSource === "upload" || m.faceSource === "generate"
        ? { faceSource: m.faceSource as "upload" | "generate" }
        : {}),
      ...(s(m.faceUploadUrl) ? { faceUploadUrl: s(m.faceUploadUrl) } : {}),
      ...(s(m.faceDesc) ? { faceDesc: s(m.faceDesc) } : {}),
      ...(s(m.portraitUrl) ? { portraitUrl: s(m.portraitUrl) } : {}),
      ...(s(m.voiceId) ? { voiceId: s(m.voiceId) } : {}),
    }));

  // 인물 설정 — [{name, archetype}] 또는 [string]. 각 인물의 이름·성격을 뽑는다.
  const rawChars = castMembers.length
    ? castMembers.map((m) => ({ name: m.name, archetype: m.archetype ?? "" }))
    : (Array.isArray(body.characters) ? body.characters : []).map((c) => {
        if (typeof c === "string") return { name: "", archetype: c.trim() };
        if (c && typeof c === "object") {
          const o = c as { name?: unknown; archetype?: unknown };
          return {
            name: typeof o.name === "string" ? o.name.trim() : "",
            archetype: typeof o.archetype === "string" ? o.archetype.trim() : "",
          };
        }
        return { name: "", archetype: "" };
      });
  // 인물 이름(cast) — 이름 없으면 "인물1"… 로 채운다. 화자·목소리 키로 쓴다.
  const cast = rawChars
    .filter((c) => c.name || c.archetype)
    .map((c, i) => c.name || `인물${i + 1}`);
  // 스크립트 주입용 "이름(성격)" 문자열.
  const characters = rawChars
    .filter((c) => c.name || c.archetype)
    .map((c) => (c.name && c.archetype ? `${c.name}(${c.archetype})` : c.name || c.archetype));
  // 인물별 목소리 — 캐스팅 위저드에서 골랐으면 castVoices 미러로 동기화.
  const castVoices = Object.fromEntries(
    castMembers.filter((m) => m.voiceId).map((m) => [m.name, m.voiceId as string])
  );

  // 그림체: 웹툰(기본) 또는 실사. 그 외 프로필은 클리셰에 부적합 → 웹툰으로.
  const styleProfileId = body.styleProfileId === "realistic" ? "realistic" : "webtoon-romance";
  try {
    getStyleProfile(styleProfileId);
  } catch {
    return NextResponse.json({ ok: false, error: `style profile not found: ${styleProfileId}` }, { status: 400 });
  }

  // 소스 재료 = 트로프. body 는 clean 하게(콤마 구분) 둬서 2단계에서 트로프로 되쪼갠다.
  const material: SourceMaterial = {
    title: `💘 ${tropes[0]}${tropes.length > 1 ? ` 외 ${tropes.length - 1}` : ""}`,
    body: tropes.join(", "),
    sourceName: "ani-cliché",
    sourceUrl: "",
    publishedAt: null,
  };

  try {
    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId,
      // 클리셰는 MV 카메라(크래시줌·오비트 등)라 모션 좋은 모델 기본값(Kling). 없으면 레지스트리 기본.
      videoModelId: videoModels.models.some((m) => m.id === "kling3") ? "kling3" : videoModels.default,
      ttsEnabled: true,
      // 인물 성격을 생성 지시 앞에 붙여 A·B 캐릭터로 반영(스크립트 + 이후 시뮬 페르소나).
      userPrompt:
        [
          characters.length ? `등장 인물: ${characters.join(", ")}` : "",
          (body.userPrompt ?? "").trim(),
        ]
          .filter(Boolean)
          .join(". ") || undefined,
      mode: "cliche",
      cast: cast.length ? cast : undefined,
      castMembers: castMembers.length ? castMembers : undefined,
      castVoices: Object.keys(castVoices).length ? castVoices : undefined,
    });
    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
