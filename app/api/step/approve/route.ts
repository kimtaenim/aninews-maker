import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { canTransition, stepOutputsComplete } from "@/lib/stepMachine";
import { STEP_ORDER, type StepKind } from "@/lib/types";

export const runtime = "nodejs";

// 한국어 TTS(eleven_multilingual_v2) 평균 속도 ≈ 4.5자/초. 씬 텍스트가 길면
// 현재 duration 안에 음성이 안 들어가므로 그 씬만 duration 을 자동으로 늘린다.
const CHARS_PER_SEC = 4.5;

interface DurationAdjustment {
  index: number;
  from: number;
  to: number;
}

// 텍스트 대비 짧은 씬들의 권장 duration(초) 계산. ttsScript 가 있으면 그게 음성
// 소스이므로 그걸, 없으면 narration 을 기준으로 한다. 분할/이미지 변경 없음.
function computeDurationAdjustments(scenes: {
  index: number;
  narration: string;
  ttsScript?: string;
  durationSec: number;
}[]): DurationAdjustment[] {
  const out: DurationAdjustment[] = [];
  for (const s of scenes) {
    const spoken = (s.ttsScript?.trim() || s.narration || "").trim();
    if (!spoken) continue;
    const needed = Math.ceil(spoken.length / CHARS_PER_SEC);
    if (needed > s.durationSec) {
      out.push({ index: s.index, from: s.durationSec, to: needed });
    }
  }
  return out;
}

// 단계 승인 — generated → approved. body: { projectId, step, confirmAdjustments? }
// script 승인 시: 텍스트 대비 짧은 씬이 있으면 approved=false + pendingAdjustments 로
// 반환(클라이언트 모달 확인). confirmAdjustments=true 면 duration 적용 후 승인.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; step?: StepKind; confirmAdjustments?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  const step = body.step;
  if (!projectId || !step || !STEP_ORDER.includes(step)) {
    return NextResponse.json({ ok: false, error: "projectId/step 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // 스크립트 승인 게이트: 길이 조정이 필요하면 먼저 확인받는다.
  if (step === "script") {
    const adjustments = computeDurationAdjustments(project.scenes);
    if (adjustments.length > 0 && !body.confirmAdjustments) {
      return NextResponse.json({ ok: true, approved: false, pendingAdjustments: adjustments });
    }
    if (adjustments.length > 0 && body.confirmAdjustments) {
      const to = new Map(adjustments.map((a) => [a.index, a.to]));
      project.scenes = project.scenes.map((s) =>
        to.has(s.index) ? { ...s, durationSec: to.get(s.index)! } : s
      );
    }
  }

  const cur = project.steps[step];
  // 자가보정: 산출물은 다 나왔는데 경합/부분 저장으로 status 가 generating 에 갇힌
  // 경우, generated 로 올려 승인을 막지 않는다. (씬0 이미지는 keyframe 단계 소관)
  if (cur.status === "generating" && stepOutputsComplete(project, step)) {
    cur.status = "generated";
  }
  if (!canTransition(cur.status, "approved")) {
    return NextResponse.json(
      { ok: false, error: `${step}: ${cur.status} → approved 불가` },
      { status: 409 }
    );
  }

  cur.status = "approved";
  cur.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);
  // scenes 동봉: script 조정이 적용됐으면 클라이언트가 갱신된 duration 으로 동기화.
  return NextResponse.json({ ok: true, approved: true, scenes: project.scenes });
}
