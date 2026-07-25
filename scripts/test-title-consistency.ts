// ============================================================================
// 제목 생성기-검수기 자기일관성 테스트.
// ----------------------------------------------------------------------------
// 생성기를 돌린 직후 그 추천 제목을 검수기에 통과시킨다. 탈락이 나오면 제목을 고치지
// 않고 "생성기-검수기 불일치 버그"로 보고한다(어느 항목에서 갈렸는지 + 어느 쪽 해석이
// config/title-principles.json 원문에 맞는지 판정 근거).
// 소재 3개(용어형·대결형·인물형)로 3연속 통과를 확인한다.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/test-title-consistency.ts
// ============================================================================
import { generateTitles } from "../lib/titleGen";
import { reviewTitle } from "../lib/titleReview";
import principles from "../config/title-principles.json";

// 소재 3종 — 실제 채널 대본 형태의 축약본(용어형·대결형·인물형).
const CASES: { kind: string; script: string }[] = [
  {
    kind: "용어형",
    script: [
      "① 증권 앱에 매일 뜨는 ROE, 높으면 무조건 좋은 걸까요?",
      "② ROE는 내 돈을 굴려 1년에 얼마를 벌었는지 보는 숫자예요.",
      "③ 자기자본이 100억인데 순이익이 15억이면 ROE는 15%예요.",
      "④ 그런데 빚을 왕창 끌어다 쓰면 자기자본이 줄어 ROE가 저절로 올라가요.",
      "⑤ 실제로 부채비율이 높은 회사가 ROE만 화려한 경우가 있어요.",
      "⑥ 그래서 ROE만 보면 위험한 회사를 좋은 회사로 착각할 수 있어요.",
      "⑦ ROE는 부채비율과 같이 봐야 진짜 실력이 보여요. 숫자 하나만 믿으면 함정에 빠져요.",
      "⑧ 아침저녁으로 올라오는 경제교양! 구독과 좋아요 눌러주세요.",
    ].join("\n"),
  },
  {
    kind: "대결형",
    script: [
      "① 미국이 만든 로봇개를 중국이 반값에 내놨어요. 승자는 누구일까요?",
      "② 보스턴다이내믹스의 로봇개는 대당 1억 원이 넘어요.",
      "③ 중국 유니트리는 비슷한 성능을 몇 백만 원대로 내놨어요.",
      "④ 가격이 20분의 1인데 팔리는 대수는 훨씬 많아요.",
      "⑤ 그런데 두 회사 모두 핵심 부품인 감속기는 밖에서 사 옵니다.",
      "⑥ 감속기를 만드는 곳은 일본과 한국의 몇몇 회사예요.",
      "⑦ 로봇개 싸움의 승자는 싸운 두 회사가 아니라 부품을 판 회사였어요. 한국 기업도 그 명단에 있어요.",
      "⑧ 아침저녁으로 올라오는 경제교양! 구독과 좋아요 눌러주세요.",
    ].join("\n"),
  },
  {
    kind: "인물형",
    script: [
      "① 워런 버핏의 후계자가 AI 시대에 건설사를 샀어요. 왜 그랬을까요?",
      "② 그렉 아벨은 버크셔의 다음 회장으로 지목된 사람이에요.",
      "③ 그가 10조 원 넘게 넣은 곳은 반도체가 아니라 건자재 회사였어요.",
      "④ 데이터센터를 지으려면 콘크리트와 전선이 어마어마하게 들어가요.",
      "⑤ AI가 커질수록 전기와 건물이 먼저 필요해진다는 계산이에요.",
      "⑥ 반도체 회사는 경쟁자가 많지만 지역 건자재는 대체가 어려워요.",
      "⑦ 아벨이 산 것은 AI가 아니라 AI가 반드시 지나가야 하는 길목이었어요.",
      "⑧ 아침저녁으로 올라오는 경제교양! 구독과 좋아요 눌러주세요.",
    ].join("\n"),
  },
];

const PRINCIPLE_BY_ID = new Map(principles.principles.map((p) => [p.id, p]));

async function runOne(c: { kind: string; script: string }, i: number) {
  console.log(`\n═══ ${i + 1}. ${c.kind} ═══`);
  const gen = await generateTitles({ projectId: `consistency-test-${i}`, scriptText: c.script });
  const rec = gen.candidates[gen.recommended_index];
  console.log(`생성기 추천: ${rec.title}`);
  if (rec.banned?.length) console.log(`  ⚠ 코드 banned: ${rec.banned.join(", ")}`);

  const rv = await reviewTitle({
    projectId: `consistency-test-${i}`,
    title: rec.title,
    scriptText: c.script,
  });
  console.log(`검수기 판정: ${rv.verdict} — ${rv.summary}`);

  if (rv.verdict === "통과") return { ok: true as const };

  // ── 불일치 버그 보고 — 제목을 고치지 않는다.
  const failedItems = rv.items.filter((it) => it.verdict === "탈락");
  console.log("\n  ❌ 생성기-검수기 불일치 버그");
  for (const it of failedItems) {
    const p = PRINCIPLE_BY_ID.get(it.id);
    console.log(`  · 갈린 항목: 원칙 ${it.id} (${p?.name ?? it.name})`);
    console.log(`    원문 규칙: ${p?.rule ?? "(원칙 목록에 없는 항목 — 검수기가 목록 밖 기준을 만들었다)"}`);
    console.log(`    검수기 근거: "${it.quote}" — ${it.why}`);
    console.log(`    생성기 자기평가: p${it.id}=${rec.principle_check?.[`p${it.id}`] ?? "미표기"}`);
    // 어느 쪽 해석이 원문에 맞는지 판정 근거를 사람이 볼 수 있게 같이 찍는다.
    if (!p) {
      console.log(`    → 판정: 검수기가 틀렸다(원칙 목록에 없는 근거로 감점 — 닫힌 채점표 위반)`);
    } else {
      console.log(`    → 판정: 위 '원문 규칙'과 '검수기 근거'를 대조해 판단할 것`);
    }
  }
  if (rv.codeBanned.length) console.log(`  · 코드 banned 검사: ${rv.codeBanned.join(", ")}`);
  if (rv.bannedHits.length) console.log(`  · 모델 banned 판정: ${rv.bannedHits.join(", ")}`);
  return { ok: false as const, kind: c.kind, title: rec.title, failedItems };
}

async function main() {
  console.log(`원칙 파일 버전: ${principles.version} · 원칙 ${principles.principles.length}개 · 충돌 규칙 ${principles.conflict_rules.length}개`);
  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    results.push(await runOne(CASES[i], i));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? `\n✅ 3연속 통과 — 생성기·검수기 해석 일치`
      : `\n❌ ${failed.length}/${results.length} 불일치 — 위 보고 참고(제목은 고치지 않았음)`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
