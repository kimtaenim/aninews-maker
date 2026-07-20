// 제목 banned 규칙 단위 테스트 — LLM 무관 순수함수 검증.
//   실행: npx tsx scripts/test-title-banned.ts
import { violatesBanned } from "../lib/titleBanned";

let fail = 0;

function expectBanned(title: string, mustInclude?: string) {
  const v = violatesBanned(title);
  const ok = v.length > 0 && (!mustInclude || v.includes(mustInclude));
  console.log(ok ? "  ✓" : "  ✗", "BAD:", JSON.stringify(title), "→", v.join(", ") || "(통과됨!)");
  if (!ok) fail++;
}
function expectClean(title: string) {
  const v = violatesBanned(title);
  const ok = v.length === 0;
  console.log(ok ? "  ✓" : "  ✗", "OK :", JSON.stringify(title), v.length ? "→ " + v.join(", ") : "");
  if (!ok) fail++;
}

console.log("[banned 위반이어야 하는 것들]");
expectBanned("AI 시대에 건설사를 산다? 워렌 버핏 후계자...", "기술어 선두");
expectBanned("알기 쉬운 PBR! 저평가된 알짜 기업을 알아보는 법", "수업 예고");
expectBanned("7월의 미국 금리는? 우리 살림에 미칠 영향!", "시점 표현");
expectBanned("불마켓, 베어마켓, 헷갈리셨죠? 어원과 외우는 방법까지 쉽게 풀이!", "수업 예고");
expectBanned("중국 경제 폭락 위기, 지금 팔아야?", "손실·불안 어휘");
expectBanned("미국 금리 범위 3~4%는?", "물결표(~)");
expectBanned("요즘 뜨는 반도체, 지금 사도 될까?", "시점 표현");
expectBanned("로봇 개 전쟁의 승자는?", "기술어 선두");

console.log("\n[통과해야 하는 것들(채널 실측 성공작)]");
expectClean("높은 게 좋을까, 낮은 게 좋을까? PER이 의미하는 것은!!");
expectClean("성장률 4%대? 잘나가던 중국 경제가 삐걱대는 진짜 이유!");
expectClean("전쟁이 터진 곳은 이란인데, 반도체값은 왜 오를까?");
expectClean("워렌 버핏 후계자의 역발상! AI 시대에 건설사를 산다?");
expectClean("원조 미국 대 반값 중국! 로봇 개 전쟁, 한국의 한 수는?");
expectClean("높으면 무조건 좋다더니? ROE에도 함정은 있다!");

if (fail > 0) {
  console.error(`\n❌ ${fail}개 실패`);
  process.exit(1);
}
console.log("\n✅ 전부 통과");
