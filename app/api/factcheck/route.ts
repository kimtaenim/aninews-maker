import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { runFactCheck, runScriptChat } from "@/lib/stepChat";
import { estimateDuration } from "@/lib/scenes";
import { formatKrw } from "@/lib/cost";
import type { Scene, StepChatTurn } from "@/lib/types";
import type { SourceMaterial } from "@/lib/source";

export const runtime = "nodejs";
export const maxDuration = 300; // 팩트체크는 웹 검색을 여러 번 돌려 60초를 넘길 수 있다

// 스크립트 팩트체크(2단계) — 전 씬 나레이션을 모아 Claude(opus)에 검증 의뢰.
// body: { projectId, userMessage? }
//   - userMessage 없음 → "검증" 모드: 팩트체크 리포트를 factCheckChat 에 쌓고 반환(씬 안 건드림).
//   - userMessage 있음 → "수정" 모드: 요청대로 씬 나레이션을 고쳐 저장(runScriptChat 재사용),
//     대화도 factCheckChat 에 쌓는다. 스크립트 다듬기 대화(steps.script.chat)와 분리된 로그.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; userMessage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  const userMessage = (body.userMessage ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (project.scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "스크립트가 아직 없어요 (먼저 생성)" }, { status: 422 });
  }

  const material = project.steps.source.params?.material as SourceMaterial | undefined;

  // ── 검증 모드: 리포트만 생성 ────────────────────────────────────────────────
  if (!userMessage) {
    try {
      const { reply, costUsd } = await runFactCheck({
        projectId,
        narrations: project.scenes.map((s) => s.narration),
        material,
      });
      // Claude 호출 동안 다른 저장이 있었을 수 있으니 최신 재읽기 후 대화 로그만 머지.
      const fresh = (await getProject(projectId)) ?? project;
      const now = Date.now();
      const chat: StepChatTurn[] = [
        ...(fresh.factCheckChat ?? []),
        { role: "user", text: "🔍 팩트체크 실행", ts: now },
        { role: "assistant", text: reply, ts: now },
      ];
      fresh.factCheckChat = chat;
      fresh.updatedAt = now;
      await saveProject(fresh);
      return NextResponse.json({ ok: true, reply, chat, cost: formatKrw(costUsd) });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "팩트체크 실패" },
        { status: 500 }
      );
    }
  }

  // ── 수정 모드: 대화 요청대로 씬 나레이션 갱신(runScriptChat 재사용) ────────────
  try {
    const { reply, narrations, costUsd } = await runScriptChat({
      projectId,
      narrations: project.scenes.map((s) => s.narration),
      userMessage,
    });
    // 최신 재읽기 후, 같은 index 산출물(프롬프트·이미지·영상·음성 등)은 carry, 나레이션이
    // 바뀐 씬의 음성대본 미러(ttsScript)는 비운다(자막→음성 단방향). stepchat script 와 동일.
    const fresh = (await getProject(projectId)) ?? project;
    const prev = fresh.scenes;
    const scenes: Scene[] = narrations
      .map((n, index): Scene => {
        const carry = prev[index];
        const narration = n.trim();
        return {
          ...(carry ?? {}),
          index,
          narration,
          imagePrompt: carry?.imagePrompt ?? "",
          motion: carry?.motion ?? "",
          durationSec: carry?.durationSec ?? estimateDuration(narration),
          status: "generated",
          ttsScript:
            carry?.ttsScript &&
            carry.ttsScript !== carry.narration &&
            (carry.narration ?? "").trim() === narration
              ? carry.ttsScript
              : undefined,
        };
      })
      .filter((s) => s.narration);
    if (scenes.length === 0) {
      return NextResponse.json({ ok: false, error: "결과 스크립트가 비었어요 — 다시 시도" }, { status: 502 });
    }
    const now = Date.now();
    fresh.scenes = scenes;
    fresh.factCheckChat = [
      ...(fresh.factCheckChat ?? []),
      { role: "user", text: userMessage, ts: now },
      { role: "assistant", text: reply, ts: now },
    ];
    fresh.steps.script.updatedAt = now;
    fresh.updatedAt = now;
    await saveProject(fresh);
    return NextResponse.json({ ok: true, reply, scenes, chat: fresh.factCheckChat, cost: formatKrw(costUsd) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "팩트체크 수정 실패" },
      { status: 500 }
    );
  }
}
