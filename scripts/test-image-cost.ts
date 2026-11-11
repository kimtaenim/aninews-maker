// 이미지 비용 계산 단위 테스트 — LLM 무관 순수함수.
//   실행: npx tsx scripts/test-image-cost.ts
//
// GPT-Image-2.6 은 장당 고정가가 없고 응답의 토큰 수로 매긴다.
// 100만 토큰당 — 텍스트 입력 $5, 이미지 입력 $8, 이미지 출력 $30.
// 토큰이 안 오면 장당 추정치로 떨어진다. "비용 0원" 으로 조용히 새는 것을 막는 게 목적.
import {
  openaiImageUsageCostUsd,
  openaiImageCostUsd,
  imageCallCostUsd,
  OPENAI_IMAGE_TOKEN_PRICING,
} from "../lib/cost";

let fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(ok ? "  ✓" : "  ✗", label, ok ? "" : `→ ${detail ?? ""}`);
  if (!ok) fail++;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

console.log("[단가]");
check("텍스트 입력 $5/M", OPENAI_IMAGE_TOKEN_PRICING.textInput === 5);
check("이미지 입력 $8/M", OPENAI_IMAGE_TOKEN_PRICING.imageInput === 8);
check("이미지 출력 $30/M", OPENAI_IMAGE_TOKEN_PRICING.imageOutput === 30);

console.log("\n[토큰으로 계산]");
{
  // 텍스트 1,000 + 이미지 입력 2,000 + 출력 4,000
  // = 1000*5/1e6 + 2000*8/1e6 + 4000*30/1e6 = 0.005 + 0.016 + 0.12 = 0.141
  const c = openaiImageUsageCostUsd({
    input_tokens: 3000,
    output_tokens: 4000,
    input_tokens_details: { text_tokens: 1000, image_tokens: 2000 },
  });
  check("입력 내역이 있을 때", c !== null && near(c, 0.141), String(c));
}
{
  // 내역이 없으면 입력 전체를 텍스트로 본다: 3000*5/1e6 + 4000*30/1e6 = 0.015 + 0.12
  const c = openaiImageUsageCostUsd({ input_tokens: 3000, output_tokens: 4000 });
  check("입력 내역이 없을 때 전부 텍스트로", c !== null && near(c, 0.135), String(c));
}
{
  const c = openaiImageUsageCostUsd({
    input_tokens: 3000,
    output_tokens: 4000,
    input_tokens_details: { text_tokens: 0, image_tokens: 0 },
  });
  check("내역이 0 뿐이면 입력 합계를 쓴다", c !== null && near(c, 0.135), String(c));
}

console.log("\n[토큰이 없으면 null — 호출부가 추정치로 넘어가게]");
check("usage 자체가 없음", openaiImageUsageCostUsd(undefined) === null);
check("빈 객체", openaiImageUsageCostUsd({}) === null);
check("토큰이 전부 0", openaiImageUsageCostUsd({ input_tokens: 0, output_tokens: 0 }) === null);

console.log("\n[장당 추정치 폴백]");
{
  const m = "gpt-image-2.6-sunburst";
  check("low $0.025", near(openaiImageCostUsd(m, "low", 1), 0.025));
  check("medium $0.044", near(openaiImageCostUsd(m, "medium", 1), 0.044));
  check(
    "high 는 표에 없어 medium 으로 (low 로 떨어뜨리면 싸게 잡힌다)",
    near(openaiImageCostUsd(m, "high", 1), 0.044),
    String(openaiImageCostUsd(m, "high", 1))
  );
  check("장수만큼 곱한다", near(openaiImageCostUsd(m, "low", 3), 0.075));
}
{
  // 옛 모델은 그대로 유지돼야 한다(무회귀).
  check("gpt-image-2 medium 0.04 유지", near(openaiImageCostUsd("gpt-image-2", "medium", 1), 0.04));
}

console.log("\n[imageCallCostUsd — usage 우선, 없으면 추정치]");
{
  const withUsage = imageCallCostUsd({
    usage: { input_tokens: 3000, output_tokens: 4000 },
    model: "gpt-image-2.6-sunburst",
    quality: "low",
  });
  check("usage 가 있으면 토큰으로", near(withUsage, 0.135), String(withUsage));
}
{
  const noUsage = imageCallCostUsd({ model: "gpt-image-2.6-sunburst", quality: "medium" });
  check("usage 가 없으면 추정치로", near(noUsage, 0.044), String(noUsage));
}
{
  // 이게 이번 작업의 핵심 — 모델만 바꿨을 때 0 으로 찍히던 문제.
  const c = imageCallCostUsd({ model: "gpt-image-2.6-sunburst", quality: "low" });
  check("0 이 아니다 (비용이 조용히 새지 않게)", c > 0, String(c));
}

console.log(fail === 0 ? "\n전부 통과" : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
