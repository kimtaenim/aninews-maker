// 일회성 마이그레이션 — 완성본 중 voiceSpeed!==1.2 인 것만 1.2배로 재발행(A 방식).
// 각 프로젝트: voiceSpeed=1.2 저장 → 전 씬 음성 1.2배 재생성 → 재합성 큐 적재.
// 기존 검증된 API(localhost:3000)를 임시 세션으로 호출한다. 드라이브 업로드는 제외.
//   실행: node scripts/bulk-speed-1.2.mjs
import { Redis } from "@upstash/redis";
import { readFileSync } from "node:fs";

// .env.local 로드
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const BASE = process.env.BULK_BASE || "http://localhost:3000";
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

let cookie = "";
function captureCookies(res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
}

async function post(path, body, tries = 3) {
  let lastErr;
  for (let a = 1; a <= tries; a++) {
    try {
      const r = await fetch(BASE + path, {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) return { ok: true, data: d };
      if (r.status < 500) return { ok: false, status: r.status, error: d.error || `HTTP ${r.status}` };
      lastErr = d.error || `HTTP ${r.status}`; // 5xx → 재시도
    } catch (e) {
      lastErr = e.message;
    }
    if (a < tries) await sleep(2000);
  }
  return { ok: false, error: lastErr };
}

async function main() {
  // 1) 임시 세션 — 미들웨어 통과용(라우트는 소유자 검사 안 함).
  const email = `bulk${Date.now()}@bulk.local`;
  const su = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "bulkbulk" }),
  });
  captureCookies(su);
  if (!cookie) throw new Error("세션 쿠키를 못 받았어요 (signup 실패?)");
  log("임시 세션 확보:", email);

  // 2) 대상 선정 — 완성본 && voiceSpeed!==1.2
  const ids = await redis.zrange("project:index", 0, -1, { rev: true });
  const targets = [];
  for (const id of ids) {
    const p = await redis.get(`project:${id}`);
    if (p && p.finalVideoUrl && p.voiceSpeed !== 1.2) {
      targets.push({ id, title: p.title, scenes: (p.scenes || []).length });
    }
  }
  const totalScenes = targets.reduce((s, t) => s + t.scenes, 0);
  log(`대상 ${targets.length}개 / 총 ${totalScenes}씬. 시작합니다.`);

  const summary = { composed: 0, held: 0, failedSpeed: 0, sceneFails: 0, sceneSkips: 0 };
  let n = 0;
  for (const t of targets) {
    n++;
    const tag = `(${n}/${targets.length}) ${t.title?.slice(0, 24) ?? t.id}`;
    const sp = await post("/api/project/voice-speed", { projectId: t.id, speed: 1.2 });
    if (!sp.ok) {
      summary.failedSpeed++;
      log(`✗ ${tag} 속도설정 실패: ${sp.error} — 건너뜀`);
      continue;
    }
    let fails = 0, skips = 0;
    for (let i = 0; i < t.scenes; i++) {
      const a = await post("/api/audio/scene", { projectId: t.id, sceneIndex: i });
      if (a.ok) {
        /* ok */
      } else if (a.status === 422) {
        skips++; // 빈 나레이션 등 — 정상 스킵
      } else {
        fails++;
        log(`   · ${tag} 씬${i + 1} 음성 실패: ${a.error}`);
      }
    }
    summary.sceneFails += fails;
    summary.sceneSkips += skips;
    if (fails === 0) {
      const c = await post("/api/compose", { projectId: t.id, lang: "ko" });
      if (c.ok) {
        summary.composed++;
        log(`✓ ${tag} 음성 재생성(${t.scenes - skips}컷) → 재합성 큐 적재`);
      } else {
        summary.held++;
        log(`△ ${tag} 음성은 됐는데 합성요청 실패: ${c.error}`);
      }
    } else {
      summary.held++;
      log(`△ ${tag} 씬 ${fails}개 실패 → 합성 보류(음성은 일부 갱신됨)`);
    }
  }

  // 임시 세션 사용자 정리
  await redis.del(`user:${email}`).catch(() => {});
  await redis.srem("users", email).catch(() => {});

  log("──────── 완료 ────────");
  log(`재합성 큐 적재: ${summary.composed} / 보류: ${summary.held} / 속도설정 실패: ${summary.failedSpeed}`);
  log(`씬 음성 실패 합계: ${summary.sceneFails} / 스킵(빈 나레이션): ${summary.sceneSkips}`);
  log("합성은 worker가 순차 처리 → 끝나는 대로 라이브러리 finalVideoUrl 갱신됩니다.");
}

main().catch((e) => {
  console.error("치명 오류:", e);
  process.exit(1);
});
