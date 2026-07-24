import { NextRequest, NextResponse } from "next/server";
import { totalCostUsd, formatKrw } from "@/lib/cost";
import { getProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 누적 비용 합계. ?projectId=… 주면 그 프로젝트만(리롤 포함 전부 합산).
//   &includeSegments=1 → [롱폼] 세그먼트·진행자 프로젝트 비용까지 합산해서 반환한다.
//     롱폼 제작비는 롱폼 프로젝트 자신(제목·대본·썸네일)만 세면 실제와 크게 어긋난다 —
//     무거운 이미지·영상·음성 비용은 전부 세그먼트/진행자 쪽에 기록되기 때문.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const includeSegments = req.nextUrl.searchParams.get("includeSegments") === "1";
  try {
    if (projectId && includeSegments) {
      const p = await getProject(projectId);
      const segIds = p?.sourceProjectIds ?? [];
      const hostId = p?.hostProjectId;

      const ownUsd = await totalCostUsd(projectId);
      const segUsds = await Promise.all(segIds.map((id) => totalCostUsd(id)));
      const hostUsd = hostId ? await totalCostUsd(hostId) : 0;
      const segmentsUsd = segUsds.reduce((a, b) => a + b, 0);
      const totalUsd = ownUsd + segmentsUsd + hostUsd;

      return NextResponse.json({
        totalUsd,
        totalKrw: formatKrw(totalUsd),
        breakdown: {
          own: { usd: ownUsd, krw: formatKrw(ownUsd) }, // 제목·대본·썸네일 등 롱폼 자신
          segments: { usd: segmentsUsd, krw: formatKrw(segmentsUsd), count: segIds.length },
          host: { usd: hostUsd, krw: formatKrw(hostUsd) },
        },
      });
    }
    const totalUsd = await totalCostUsd(projectId);
    return NextResponse.json({ totalUsd, totalKrw: formatKrw(totalUsd) });
  } catch {
    return NextResponse.json({ totalUsd: 0, totalKrw: formatKrw(0) });
  }
}
