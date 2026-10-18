import { NextRequest, NextResponse } from "next/server";
import { classifyFile, MAX_FILE_SIZE, MAX_TOTAL_SIZE } from "@/lib/attachments";
import { readCardnews, CARDNEWS_MAX_IMAGES } from "@/lib/cardnews";

export const runtime = "nodejs";
export const maxDuration = 300; // 카드 여러 장 vision 읽기 — 수십 초~1분+

// [카드뉴스 ①] 카드 PNG/JPG 묶음 → 순서대로 글자 읽기 + 괄호 출처 추출.
// 프로젝트는 만들지 않는다 — 화면에서 확인한 뒤 ②검색 → ③생성 순서로 진행한다.
//
// FormData: file (이미지 복수, 첨부 순서 = 카드 순서)
export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid FormData" }, { status: 400 });
  }

  const files = formData.getAll("file").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { ok: false, error: "카드 이미지 1장 이상 필요" },
      { status: 400 }
    );
  }
  if (files.length > CARDNEWS_MAX_IMAGES) {
    return NextResponse.json(
      { ok: false, error: `카드 이미지는 ${CARDNEWS_MAX_IMAGES}장까지예요` },
      { status: 400 }
    );
  }

  let totalSize = 0;
  for (const f of files) {
    if (classifyFile(f) !== "image") {
      return NextResponse.json(
        { ok: false, error: `${f.name} 은(는) 이미지가 아니에요 (PNG·JPG 만)` },
        { status: 400 }
      );
    }
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: `${f.name} 이(가) 10MB 초과` },
        { status: 400 }
      );
    }
    totalSize += f.size;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json({ ok: false, error: "전체 첨부 30MB 초과" }, { status: 400 });
  }

  try {
    const images = await Promise.all(
      files.map(async (f) => ({
        bytes: Buffer.from(await f.arrayBuffer()),
        mediaType: f.type || "image/png",
      }))
    );
    const read = await readCardnews({ images });
    return NextResponse.json({ ok: true, ...read });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "카드 읽기 실패" },
      { status: 500 }
    );
  }
}
