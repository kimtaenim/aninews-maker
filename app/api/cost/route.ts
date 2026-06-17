import { NextRequest, NextResponse } from "next/server";
import { totalCostUsd, formatKrw } from "@/lib/cost";

export const runtime = "nodejs";

// 누적 비용 합계. ?projectId=… 주면 그 프로젝트만(리롤 포함 전부 합산).
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  try {
    const totalUsd = await totalCostUsd(projectId);
    return NextResponse.json({ totalUsd, totalKrw: formatKrw(totalUsd) });
  } catch {
    return NextResponse.json({ totalUsd: 0, totalKrw: formatKrw(0) });
  }
}
