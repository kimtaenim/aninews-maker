// 일회성 마이그레이션 — 기존 뉴스 프로젝트의 "구독 마무리 씬"에 강제로 물린 Typecast
// 목소리(tc_603513…)+1.4배 오버라이드를 제거해 본문과 같은 기본 목소리로 되돌린다.
// (그 씬만 목소리가 튀고 기본 목소리로 리롤해도 안 바뀌던 문제 해소.)
//
// 각 대상 프로젝트: 마무리 씬의 voiceId·ttsSpeed·audioUrl·ttsTimestamps 를 지워 저장
//   → 그 씬 음성만 기본 목소리로 재생성 → (완성본이면) 재합성 큐 적재.
// 검증된 API(localhost:3000)를 임시 세션으로 호출한다.
//
//   미리보기(대상만 나열):  node scripts/fix-outro-voice.mjs
//   실제 적용:              APPLY=1 node scripts/fix-outro-voice.mjs
import { Redis } from "@upstash/redis";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const BASE = process.env.BULK_BASE || "http://localhost:3000";
const APPLY = process.env.APPLY === "1";
const OUTRO_VOICE = "tc_603513d91860484c4dcb6a11"; // 마무리 씬에 물렸던 Typecast 목소리
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
      lastErr = d.error || `HTTP ${r.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    if (a < tries) await sleep(2000);
  }
  return { ok: false, error: lastErr };
}

// 마무리 씬 판별 — 자동 마무리 씬 시그니처(강제 물린 목소리 + 1.4배).
const isOutro = (s) => s && s.voiceId === OUTRO_VOICE && s.ttsSpeed === 1.4;

async function main() {
  // 1) 대상 선정 — 뉴스(클리셰 아님) && 마무리 시그니처 씬 보유.
  const ids = await redis.zrange("project:index", 0, -1, { rev: true });
  const targets = [];
  for (const id of ids) {
    const p = await redis.get(`project:${id}`);
    if (!p || p.mode === "cliche" || !Array.isArray(p.scenes)) continue;
    const idxs = p.scenes.map((s, i) => (isOutro(s) ? i : -1)).filter((i) => i >= 0);
    if (idxs.length) targets.push({ id, title: p.title, idxs, composed: !!p.finalVideoUrl });
  }
  log(`대상 ${targets.length}개 (마무리 씬 오버라이드 보유).`);
  for (const t of targets) {
    log(`  · ${t.title?.slice(0, 30) ?? t.id} — 씬 ${t.idxs.map((i) => i + 1).join(",")}${t.composed ? " (완성본)" : ""}`);
  }
  if (!APPLY) {
    log("미리보기 모드 — 아무것도 바꾸지 않았습니다. 적용하려면 APPLY=1 로 다시 실행하세요.");
    return;
  }

  // 2) 임시 세션(미들웨어 통과용).
  const email = `outrofix${Date.now()}@bulk.local`;
  const su = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "bulkbulk" }),
  });
  captureCookies(su);
  if (!cookie) throw new Error("세션 쿠키를 못 받았어요 (signup 실패?)");
  log("임시 세션 확보:", email);

  const summary = { fixed: 0, composed: 0, held: 0, fails: 0 };
  let n = 0;
  for (const t of targets) {
    n++;
    const tag = `(${n}/${targets.length}) ${t.title?.slice(0, 24) ?? t.id}`;
    // 2a) 오버라이드 제거 — 최신 재읽기 후 해당 씬 필드만 지워 저장(경합 최소화).
    const p = await redis.get(`project:${t.id}`);
    if (!p || !Array.isArray(p.scenes)) {
      summary.fails++;
      log(`✗ ${tag} 프로젝트 재읽기 실패 — 건너뜀`);
      continue;
    }
    const idxs = p.scenes.map((s, i) => (isOutro(s) ? i : -1)).filter((i) => i >= 0);
    for (const i of idxs) {
      const s = p.scenes[i];
      delete s.voiceId;
      delete s.ttsSpeed;
      delete s.audioUrl; // 옛 목소리 음성 무효화 → 기본 목소리로 재생성 유도
      delete s.ttsTimestamps;
    }
    p.updatedAt = Date.now();
    await redis.set(`project:${t.id}`, p);
    summary.fixed++;

    // 2b) 마무리 씬 음성만 기본 목소리로 재생성.
    let fails = 0;
    for (const i of idxs) {
      const a = await post("/api/audio/scene", { projectId: t.id, sceneIndex: i });
      if (!a.ok && a.status !== 422) {
        fails++;
        log(`   · ${tag} 씬${i + 1} 음성 실패: ${a.error}`);
      }
    }
    summary.fails += fails;

    // 2c) 완성본이면 재합성 큐 적재(음성 실패 없을 때만).
    if (t.composed && fails === 0) {
      const c = await post("/api/compose", { projectId: t.id, lang: "ko" });
      if (c.ok) {
        summary.composed++;
        log(`✓ ${tag} 마무리 음성 기본 목소리로 재생성 → 재합성 큐 적재`);
      } else {
        summary.held++;
        log(`△ ${tag} 음성은 됐는데 합성요청 실패: ${c.error}`);
      }
    } else if (fails === 0) {
      log(`✓ ${tag} 마무리 음성 기본 목소리로 재생성 (완성본 아님 — 합성 생략)`);
    } else {
      summary.held++;
      log(`△ ${tag} 음성 실패 → 합성 보류`);
    }
  }

  await redis.del(`user:${email}`).catch(() => {});
  await redis.srem("users", email).catch(() => {});

  log("──────── 완료 ────────");
  log(`오버라이드 제거: ${summary.fixed} / 재합성 큐: ${summary.composed} / 보류: ${summary.held} / 씬 음성 실패: ${summary.fails}`);
}

main().catch((e) => {
  console.error("치명 오류:", e);
  process.exit(1);
});
