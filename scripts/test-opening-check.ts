// 롱폼 오프닝 검사(로드맵 누출/banned) 단위 테스트 — LLM 무관.
//   실행: npx tsx scripts/test-opening-check.ts
import { openingViolations } from "../lib/openingCheck";

let fail = 0;
function expectViolation(label: string, script: string[]) {
  const v = openingViolations(script);
  const ok = v.length > 0;
  console.log(ok ? "  ✓" : "  ✗", "BAD:", label, "→", v.join(", ") || "(통과됨!)");
  if (!ok) fail++;
}
function expectClean(label: string, script: string[]) {
  const v = openingViolations(script);
  const ok = v.length === 0;
  console.log(ok ? "  ✓" : "  ✗", "OK :", label, v.length ? "→ " + v.join(", ") : "");
  if (!ok) fail++;
}

console.log("[로드맵/금지 — 위반이어야 함]");
expectViolation("나열형 오프닝", [
  "오늘은 주식 용어 7개를 알기 쉽게 정리해드릴게요.",
  "PER부터 물적분할까지 차례로 알아봅니다.",
]);
expectViolation("서수 나열", ["첫 번째로 PER을 보고,", "두 번째로 PBR을 봅니다."]);
expectViolation("시점 표현", ["요즘 미국 금리, 어떻게 될까요?"]);
expectViolation("목차 노출", ["오늘의 목차를 먼저 볼게요."]);

console.log("\n[열린 고리 — 통과해야 함]");
expectClean("치킨집 심판(실측 시범)", [
  "삼성전자와 동네 치킨집.",
  "숫자만 보고 누가 장사를 더 잘하는지 가려낼 수 있을까요?",
  "증권 앱에 매일 뜨는 그 낯선 약자들이 사실은 전부 이 한 판을 가르는 심판들이에요.",
  "일곱 명의 심판이 각자 다른 걸 보는데, 마지막 심판이 보는 건 좀 뜻밖입니다.",
  "하나씩 만나보시죠.",
]);
expectClean("중국 수수께끼형", [
  "세계 공장 중국이 흔들린다는 얘기, 많이 들으셨죠?",
  "그런데 정작 중국 부자들은 조용히 웃고 있어요.",
  "이 어긋남의 정체가 이 영상 끝에 있습니다.",
]);

if (fail > 0) {
  console.error(`\n❌ ${fail}개 실패`);
  process.exit(1);
}
console.log("\n✅ 전부 통과");
