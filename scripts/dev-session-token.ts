// 로컬 dev 검증용 세션 토큰 발급 — 로그인 화면 없이 브라우저에 쿠키를 넣어 페이지를 확인할 때.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/dev-session-token.ts
//   → 출력 토큰을 document.cookie 의 aninews_session 에 넣는다(로컬 전용).
import { createSessionToken } from "../lib/session";
import { ADMIN_EMAIL } from "../lib/auth";

async function main() {
  console.log(await createSessionToken(process.argv[2] || ADMIN_EMAIL));
}
main();
