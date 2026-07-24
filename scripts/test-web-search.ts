// 웹 검색 서버 도구가 이 계정·SDK에서 실제로 도는지 최소 확인.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/test-web-search.ts
import Anthropic from "@anthropic-ai/sdk";

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 });
  const r = (await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [{ role: "user", content: "3M 회사의 최근 주요 소송이나 실적 악화 소식을 웹에서 한 건만 찾아 한 줄로 알려줘." }],
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }] as never,
  } as never)) as unknown as { content: Array<{ type: string; text?: string }>; stop_reason?: string };

  const types = r.content.map((b) => b.type);
  const searched = types.some((t) => t === "web_search_tool_result" || t === "server_tool_use");
  const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  console.log("block types:", types.join(", "));
  console.log("stop_reason:", r.stop_reason);
  console.log("searched:", searched);
  console.log("text:", text.slice(0, 300));
}
main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
