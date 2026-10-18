import { NextRequest, NextResponse } from "next/server";
import { classifyFile, MAX_FILE_SIZE, MAX_TOTAL_SIZE } from "@/lib/attachments";
import { readCardnews, CARDNEWS_MAX_IMAGES } from "@/lib/cardnews";
import { extractArtwork } from "@/lib/cardnewsCrop";
import { uploadAsset } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 300; // 카드 여러 장 vision 읽기 — 수십 초~1분+

// [카드뉴스 ①] 카드 PNG/JPG 묶음 → 꼭지별 글자 읽기 + 끝 괄호 출처 + 삽화 잘라내기.
// 프로젝트는 만들지 않는다 — 화면에서 확인한 뒤 ②검색 → ③생성 순서로 진행한다.
//
// 삽화는 글자와 서로 영향을 주지 않는다. 잘라낸 그림은 키프레임 "참조" 후보로만
// 올려 두고, 어느 것을 쓸지는 화면에서 고른다. 키프레임 출력은 기존대로 프로젝트
// 포맷(숏폼이면 세로 9:16)으로 새로 그려진다.
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

    // 삽화 잘라 Blob 에 올린다 — 키프레임 참조 후보. 못 찾거나 실패한 장은 건너뛴다
    // (그림 없이도 글자만으로 진행할 수 있어야 한다).
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artworks = (
      await Promise.all(
        images.map(async (img, i) => {
          try {
            const got = await extractArtwork(img.bytes);
            if (!got) return null;
            const { url } = await uploadAsset(
              `cardnews/${stamp}-${i + 1}.png`,
              got.png,
              "image/png"
            );
            return { index: i + 1, url, width: got.box.w, height: got.box.h };
          } catch {
            return null;
          }
        })
      )
    ).filter((a): a is NonNullable<typeof a> => a !== null);

    return NextResponse.json({ ok: true, ...read, artworks });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "카드 읽기 실패" },
      { status: 500 }
    );
  }
}
