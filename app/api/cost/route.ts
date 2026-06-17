import { NextResponse } from "next/server";
import { totalCostUsd } from "@/lib/cost";

// 비용 합계 (CostFooter 용).
export async function GET() {
  try {
    const totalUsd = await totalCostUsd();
    return NextResponse.json({ totalUsd });
  } catch {
    return NextResponse.json({ totalUsd: 0 });
  }
}
