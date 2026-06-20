// 타입캐스트 키/보이스 빠른 점검 — 앱과 무관하게 .env.local 만 읽어 1회 합성해 본다.
//   실행: node scripts/typecast-test.mjs
//   결과: scripts/typecast-test.mp3 (생기고 재생되면 키·보이스 정상)
// API 키는 절대 로그에 찍지 않는다.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// .env.local 직접 파싱(CRLF·따옴표·주석 처리). dotenv 의존성 없이.
function loadEnv() {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

const env = loadEnv();
const key = env.TYPECAST_API_KEY;
const voiceId = env.TYPECAST_VOICE_ID_KO || env.TYPECAST_VOICE_ID;
const model = env.TYPECAST_MODEL || "ssfm-v30";

if (!key) {
  console.error("✗ TYPECAST_API_KEY 가 .env.local 에 없어요");
  process.exit(1);
}
if (!voiceId) {
  console.error("✗ TYPECAST_VOICE_ID_KO(또는 TYPECAST_VOICE_ID) 가 없어요");
  process.exit(1);
}

console.log(`→ 합성 요청: model=${model}, voice_id=${voiceId}, lang=kor`);

const r = await fetch("https://api.typecast.ai/v1/text-to-speech", {
  method: "POST",
  headers: { "X-API-KEY": key, "content-type": "application/json", accept: "audio/mpeg" },
  body: JSON.stringify({
    voice_id: voiceId,
    text: "안녕하세요. 타입캐스트 연결 테스트입니다.",
    model,
    language: "kor",
    output: { audio_format: "mp3" },
  }),
});

if (!r.ok) {
  const detail = await r.text().catch(() => "");
  console.error(`✗ 실패: HTTP ${r.status} ${detail.slice(0, 300)}`);
  if (r.status === 401) console.error("  → API 키가 틀렸거나 비활성일 수 있어요");
  if (r.status === 402) console.error("  → 크레딧/결제가 필요할 수 있어요 (개발자 콘솔 확인)");
  if (r.status === 404) console.error("  → voice_id 가 잘못됐을 수 있어요 (GET /v2/voices 확인)");
  process.exit(1);
}

const buf = Buffer.from(await r.arrayBuffer());
const out = join(root, "scripts", "typecast-test.mp3");
writeFileSync(out, buf);
console.log(`✓ 성공! ${buf.length.toLocaleString()} bytes → ${out}`);
console.log("  이 파일을 재생해서 목소리가 들리면 키·보이스 정상입니다.");
