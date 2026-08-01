import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { syncHostScenes } from "@/lib/longformHost";

export const runtime = "nodejs";
export const maxDuration = 60;

// [롱폼] 대본 → 진행자 씬. 이제 대본을 만들거나 저장하면 자동으로 돌기 때문에
// 이 경로는 수동 재동기화용으로만 남는다(화면에 단계로 노출하지 않는다).
//   POST { projectId } → { ok, hostProjectId, counts }
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const r = await syncHostScenes(projectId, await getSessionEmail());
  if (!r) {
    return NextResponse.json(
      { ok: false, error: "대본이 없어요 — 오프닝·연결·엔딩을 먼저 만들어주세요" },
      { status: 422 }
    );
  }
  return NextResponse.json({ ok: true, ...r });
}
