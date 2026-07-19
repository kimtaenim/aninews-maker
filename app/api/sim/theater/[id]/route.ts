import { NextRequest, NextResponse } from "next/server";
import { deleteSimTheater } from "@/lib/simTheaterStore";

export const runtime = "nodejs";

// 자동극장 삭제.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteSimTheater(id);
  return NextResponse.json({ ok: true });
}
