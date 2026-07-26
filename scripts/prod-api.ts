// 프로덕션 API 를 로컬에서 호출한다 — .env.local 의 SESSION_SECRET 으로 세션 쿠키를 만들어 붙인다.
// (Vercel 과 SESSION_SECRET 이 같아야 통한다. 다르면 401 이 온다.)
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/prod-api.ts GET "/api/video/scene?projectId=..&sceneIndex=0"
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/prod-api.ts POST /api/video/scene '{"projectId":"..","sceneIndex":0}'
import { createSessionToken } from "../lib/session";
import { ADMIN_EMAIL } from "../lib/auth";

const BASE = process.env.PROD_BASE || "https://aninews-maker.vercel.app";

export async function prodApi(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: unknown; text: string }> {
  const token = await createSessionToken(ADMIN_EMAIL);
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      cookie: `aninews_session=${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML 등 */
  }
  return { status: r.status, json, text };
}

async function main() {
  const method = (process.argv[2] ?? "GET").toUpperCase();
  const path = process.argv[3] ?? "/";
  const bodyRaw = process.argv[4];
  const res = await prodApi(method, path, bodyRaw ? JSON.parse(bodyRaw) : undefined);
  console.log(`HTTP ${res.status}`);
  console.log(res.json ? JSON.stringify(res.json, null, 2).slice(0, 4000) : res.text.slice(0, 1000));
}

if (process.argv[1]?.endsWith("prod-api.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
