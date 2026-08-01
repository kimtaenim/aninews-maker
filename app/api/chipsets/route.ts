import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import {
  listChipsets,
  addChipset,
  updateChipset,
  reorderChipsets,
  deleteChipset,
  touchChipsets,
  CHIPSET_STAGES,
  type ChipsetStage,
} from "@/lib/chipsets";

export const runtime = "nodejs";

// 칩셋 — 단계별(3·4·5) 사용자 프롬프트 조각. 계정 단위로 저장돼 다음 프로젝트에서도 쓴다.
//   GET                       → { ok, chipsets }
//   POST  { stage,label,text} → 등록(같은 단계·같은 이름이면 덮어씀)
//   POST  { used: string[] }  → 쓴 시각만 갱신(정렬용)
//   PATCH { id, label, text } → 수정
//   DELETE ?id=               → 삭제
export async function GET() {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "로그인 필요" }, { status: 401 });
  return NextResponse.json({ ok: true, chipsets: await listChipsets(email) });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "로그인 필요" }, { status: 401 });

  let body: { stage?: string; label?: string; text?: string; used?: unknown; reorder?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // 사용 기록만 갱신하는 호출(등록과 같은 라우트를 쓰되 필드로 구분).
  if (Array.isArray(body.used)) {
    await touchChipsets(email, body.used.map((v) => String(v)));
    return NextResponse.json({ ok: true });
  }

  // 드래그로 순서 바꾸기 — { reorder: string[] } + stage.
  if (Array.isArray(body.reorder)) {
    if (!CHIPSET_STAGES.includes(body.stage as ChipsetStage)) {
      return NextResponse.json({ ok: false, error: "단계가 잘못됐어요" }, { status: 400 });
    }
    await reorderChipsets(
      email,
      body.stage as ChipsetStage,
      body.reorder.map((v) => String(v))
    );
    return NextResponse.json({ ok: true, chipsets: await listChipsets(email) });
  }

  if (!CHIPSET_STAGES.includes(body.stage as ChipsetStage)) {
    return NextResponse.json({ ok: false, error: "단계가 잘못됐어요" }, { status: 400 });
  }
  const r = await addChipset(email, {
    stage: body.stage as ChipsetStage,
    label: String(body.label ?? ""),
    text: String(body.text ?? ""),
  });
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  return NextResponse.json({ ok: true, chipset: r.chipset, chipsets: await listChipsets(email) });
}

export async function PATCH(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "로그인 필요" }, { status: 401 });

  let body: { id?: string; label?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });

  const r = await updateChipset(email, id, {
    label: body.label === undefined ? undefined : String(body.label),
    text: body.text === undefined ? undefined : String(body.text),
  });
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  return NextResponse.json({ ok: true, chipsets: await listChipsets(email) });
}

export async function DELETE(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "로그인 필요" }, { status: 401 });
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  await deleteChipset(email, id);
  return NextResponse.json({ ok: true, chipsets: await listChipsets(email) });
}
