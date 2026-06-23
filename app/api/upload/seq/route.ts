import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { getDailySeq, setDailySeq, yymmdd } from "@/lib/uploadNaming";

export const runtime = "nodejs";

// 오늘 업로드 일련번호 조회. 다음 업로드 번호는 seq+1.
export async function GET() {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });
  const date = yymmdd();
  return NextResponse.json({ ok: true, date, seq: await getDailySeq(date) });
}

// 오늘 일련번호 갱신(초기화·지정). body: { value } — 다음 업로드는 value+1 부터(0이면 다음 01).
export async function POST(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });
  let body: { value?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const n = Number(body.value);
  if (!Number.isFinite(n) || n < 0 || n > 998) {
    return NextResponse.json({ ok: false, error: "번호는 0~998" }, { status: 422 });
  }
  const date = yymmdd();
  await setDailySeq(date, n);
  return NextResponse.json({ ok: true, date, seq: Math.floor(n) });
}
