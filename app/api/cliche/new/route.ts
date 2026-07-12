import { NextRequest, NextResponse } from "next/server";
import { createProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { getStyleProfile } from "@/lib/styleProfiles";
import type { SourceMaterial } from "@/lib/source";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 30;

// ani-cliché — 연애 클리셰 미니 영상 프로젝트 생성. 뉴스 소스 대신 "트로프"로 시작.
// body: { tropes: string[], styleProfileId?, userPrompt? }
// mode="cliche" 로 만들고, 2단계(script)는 generateClicheScript 로 분기(대사+화자 씬).
export async function POST(req: NextRequest) {
  let body: { tropes?: unknown; characters?: unknown; styleProfileId?: string; userPrompt?: string };
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

  // 인물 설정 — [{name, archetype}] 또는 [string]. 각 인물의 이름·성격을 뽑는다.
  const rawChars = (Array.isArray(body.characters) ? body.characters : []).map((c) => {
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
      videoModelId: videoModels.default,
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
    });
    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
