import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { critiqueScript, extractCritiqueFixes } from "@/lib/scriptCritique";
import { saveCritiqueLog, getCritiqueLog } from "@/lib/scriptCritiqueLog";

export const runtime = "nodejs";
export const maxDuration = 300; // 웹 검색 여러 번 + 긴 리포트 — 넉넉히

// 리포트 생성을 이 시각까지만 이어 돌린다. 실측(13씬): 리포트 170초 + 구조화 38초 = 208초로
// 상한 300초에 여유가 92초뿐이었다 — 검색 라운드가 한 번 더 돌면 504 로 통째로 날아간다.
// 그래서 (1) 구조화를 별도 요청으로 떼고 (2) 리포트도 마감 전까지만 이어 돌린다.
const REPORT_DEADLINE_MS = 250_000;

// [2단계 대본] 비판 검수 — 웹 검색으로 반대편 사실을 찾아 2부 리포트를 낸다(자동 반영 없음).
// 리포트는 스크립트 대화 로그에 어시스턴트 메시지로 남긴다(표시·이력). 씬은 안 건드린다.
//   POST { projectId }                     → 리포트 → { ok, report, searched, partial, needsExtract, chat }
//   POST { projectId, phase: "extract" }   → 저장된 리포트를 체크박스 항목으로 → { ok, fixes, verdict }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; phase?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  if (!project.scenes?.length) {
    return NextResponse.json({ ok: false, error: "대본이 아직 없어요 (먼저 생성)" }, { status: 422 });
  }

  // ── 2단: 저장된 리포트를 체크박스 항목으로 쪼갠다(도구 없음, 40초 안쪽).
  if (body.phase === "extract") {
    const log = await getCritiqueLog(projectId);
    if (!log?.report) {
      return NextResponse.json({ ok: false, error: "검수 리포트가 없어요 — 먼저 검수를 돌려주세요" }, { status: 409 });
    }
    const { fixes, verdict } = await extractCritiqueFixes({ projectId, report: log.report });
    await saveCritiqueLog(
      projectId,
      { report: log.report, fixes, verdict, searched: log.searched },
      project.scenes.map((s) => s.narration)
    );
    return NextResponse.json({ ok: true, fixes, verdict });
  }

  // 그림 완성 여부 — 씬 이미지가 하나라도 있으면 완성으로 보고 그림 호환 판정을 켠다.
  const imagesReady = project.scenes.some((s) => !!s.imageUrl);

  const narrations = project.scenes.map((s) => s.narration);

  try {
    const { report, searched, partial } = await critiqueScript({
      projectId,
      narrations,
      imagesReady,
      skipExtract: true, // 구조화는 별도 요청(phase:"extract")에서 — 한 요청에 다 넣으면 상한을 넘긴다
      deadlineMs: Date.now() + REPORT_DEADLINE_MS,
    });

    // 리포트는 먼저 저장한다 — 구조화 요청이 실패해도 리포트를 잃지 않게(비싼 검색을 다시 돌리지 않게).
    await saveCritiqueLog(projectId, { report, fixes: [], verdict: "", searched }, narrations);

    // 대화 로그에는 한 줄 요약만 남긴다. 리포트 전문을 여기 쏟으면 화면이 글 덩어리가 되고
    // (사용자가 고치라고 한 바로 그 문제), 전문은 critique 로그에 있어 모달에서 펼쳐 본다.
    // 저장 직전 fresh 재읽기 — 검수가 수 분 걸려 그동안 다른 편집이 들어왔을 수 있다.
    const fresh = (await getProject(projectId)) ?? project;
    const now = Date.now();
    const header = searched ? "🔎 비판 검수 완료" : "⚠️ 비판 검수 완료 (웹 검색이 돌지 않음 — 신뢰도 낮음)";
    const summary =
      `${header}${partial ? " (시간이 오래 걸려 검색을 중간에 끊었어요 — 빠진 항목이 있을 수 있어요)" : ""}` +
      " — 반영안은 위 “체크해서 반영하기” 목록에서 고르세요. 리포트 전문은 검수 결과 창에 있어요.";
    fresh.steps.script.chat.push(
      { role: "user", text: "[비판 검수 실행]", ts: now },
      { role: "assistant", text: summary, ts: now }
    );
    fresh.steps.script.updatedAt = now;
    fresh.updatedAt = now;
    await saveProject(fresh);

    return NextResponse.json({
      ok: true,
      report,
      fixes: [],
      verdict: "",
      searched,
      partial,
      needsExtract: true, // 클라이언트가 곧바로 phase:"extract" 를 한 번 더 호출한다
      chat: fresh.steps.script.chat,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "비판 검수 실패" },
      { status: 500 }
    );
  }
}
