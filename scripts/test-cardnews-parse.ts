// 카드뉴스 읽기 응답 파싱 단위 테스트 — LLM 무관 순수함수 검증.
//   실행: npx tsx scripts/test-cardnews-parse.ts
//
// 샘플(AI인 뉴스레터 1018AI소식)에서 확인한 것:
//   - 카드 한 장 = 뉴스 한 꼭지. 장끼리 이어지지 않는다.
//   - 출처는 본문 맨 끝 괄호. 본문 중간 괄호는 출처가 아니다.
import { parseCardnewsRead } from "../lib/cardnews";

let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(ok ? "  ✓" : "  ✗", label, ok ? "" : `→ ${detail ?? ""}`);
  if (!ok) fail++;
}

console.log("[정상 응답 — 꼭지 2개]");
{
  const raw = JSON.stringify({
    items: [
      {
        index: 1,
        title: "중국에 로봇 교통 경찰 등장",
        body: "중국 DEEP Robotics가 DR02 휴머노이드 로봇을 실제 교차로에 배치.",
        attribution: "South China Morning Post",
      },
      {
        index: 2,
        title: "아파트 단지를 순찰하는 4족 로봇",
        body: "애틀랜타 아파트에 배치된 언던티드 로봇견의 야간 순찰 영상이 200만 조회수에 육박. 해당 단지 절도 사건이 사라졌다고(업체 측 주장).",
        attribution: "TechCrunch",
      },
    ],
  });
  const items = parseCardnewsRead(raw);
  check("꼭지 2개", items.length === 2, String(items.length));
  check("1번 출처", items[0].attribution === "South China Morning Post", items[0].attribution);
  check("2번 출처", items[1].attribution === "TechCrunch", items[1].attribution);
  check(
    "본문 중간 괄호는 본문에 남는다",
    items[1].body.includes("(업체 측 주장)"),
    items[1].body
  );
}

console.log("\n[출처를 괄호째 돌려준 경우 — 양끝 괄호만 벗긴다]");
{
  const items = parseCardnewsRead(
    JSON.stringify({ items: [{ index: 1, title: "제목", body: "본문", attribution: "(TechCrunch)" }] })
  );
  check("괄호 제거", items[0].attribution === "TechCrunch", items[0].attribution);
}
{
  const items = parseCardnewsRead(
    JSON.stringify({ items: [{ index: 1, title: "제목", body: "본문", attribution: "（연합뉴스）" }] })
  );
  check("전각 괄호 제거", items[0].attribution === "연합뉴스", items[0].attribution);
}

console.log("\n[출처가 없는 꼭지]");
{
  const items = parseCardnewsRead(
    JSON.stringify({ items: [{ index: 1, title: "제목", body: "본문", attribution: "" }] })
  );
  check("빈 출처 유지", items[0].attribution === "", JSON.stringify(items[0].attribution));
}
{
  const items = parseCardnewsRead(JSON.stringify({ items: [{ index: 1, title: "제목", body: "본문" }] }));
  check("출처 필드 누락 → 빈 문자열", items[0].attribution === "", items[0].attribution);
}

console.log("\n[index 누락 → 순서대로 채움]");
{
  const items = parseCardnewsRead(
    JSON.stringify({ items: [{ title: "가", body: "A" }, { title: "나", body: "B" }] })
  );
  check("1,2 로 채움", items[0].index === 1 && items[1].index === 2, `${items[0].index},${items[1].index}`);
}

console.log("\n[빈 꼭지는 버린다]");
{
  const items = parseCardnewsRead(
    JSON.stringify({
      items: [
        { index: 1, title: "제목", body: "본문", attribution: "매체" },
        { index: 2, title: "", body: "", attribution: "" },
      ],
    })
  );
  check("빈 꼭지 제외", items.length === 1, String(items.length));
}

console.log("\n[JSON 앞뒤에 말이 붙은 응답]");
{
  const items = parseCardnewsRead(
    '다음과 같습니다:\n{"items":[{"index":1,"title":"제목","body":"본문","attribution":"매체"}]}\n이상입니다.'
  );
  check("JSON 만 뽑아 파싱", items.length === 1 && items[0].title === "제목");
}

console.log("\n[해석 불가 응답은 던진다]");
for (const [label, raw] of [
  ["JSON 아님", "읽을 수 없었습니다"],
  ["items 비어 있음", '{"items":[]}'],
  ["items 없음", '{"cards":[{"index":1,"text":"본문"}]}'],
] as const) {
  let threw = false;
  try {
    parseCardnewsRead(raw);
  } catch {
    threw = true;
  }
  check(label, threw, "안 던짐");
}

console.log(fail === 0 ? "\n전부 통과" : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
