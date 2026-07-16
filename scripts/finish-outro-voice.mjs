// fix-outro-voice.mjs 후속 — 오버라이드는 이미 제거됐고(오디오도 비워짐), 이제 프로덕션에서
// 그 마무리 씬 음성만 기본 목소리로 재생성하고 완성본을 재합성한다.
// (로컬 dev 는 Vercel Blob 자격증명이 없어 오디오 업로드가 안 되므로 프로덕션으로 돌린다.)
//
// 대상: 뉴스 프로젝트에서 나레이션이 구독 마무리 문구인데 audioUrl 이 없는 씬(= 정리된 마무리 씬).
//
//   미리보기:  node scripts/finish-outro-voice.mjs
//   적용:      APPLY=1 node scripts/finish-outro-voice.mjs   (기본 BASE=프로덕션)
import { Redis } from "@upstash/redis";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const BASE = process.env.BULK_BASE || "https://aninews-maker.vercel.app";
const APPLY = process.env.APPLY === "1";
// fix-outro-voice 가 오버라이드를 지운 뒤 오디오가 비워진 씬을 가진 프로젝트(정확히 지정 —
// 다른 진행중 프로젝트의 미생성 음성을 건드리지 않도록). 각 프로젝트에서 audioUrl 없는 씬만 재생성.
const TARGET_IDS = [
  "3334c7a0-", // 트럼프/브라질 관세 — 씬6
  "d68eb5f2-", // 미 기술 기업/중국 — 씬6
  "16477764-", // 중국 경제 성장률 — 씬6
];
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

async function main() {
  const ids = await redis.zrange("project:index", 0, -1, { rev: true });
  const targets = [];
  for (const id of ids) {
    if (!TARGET_IDS.some((pref) => id.startsWith(pref))) continue;
    const p = await redis.get(`project:${id}`);
    if (!p || !Array.isArray(p.scenes)) continue;
    const idxs = p.scenes
      .map((s, i) => (s && !s.audioUrl && !s.mood && !s.skipped ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length) targets.push({ id, title: p.title, idxs, composed: !!p.finalVideoUrl });
  }
  log(`대상 ${targets.length}개 (지정 프로젝트의 무오디오 씬).`);
  for (const t of targets) {
    log(`  · ${t.title?.slice(0, 30) ?? t.id} — 씬 ${t.idxs.map((i) => i + 1).join(",")}${t.composed ? " (완성본)" : ""}`);
  }
  if (!APPLY) {
    log(`미리보기 모드 — 아무것도 안 바꿈. 적용하려면 APPLY=1 (BASE=${BASE}).`);
    return;
  }

  const email = `outrofin${Date.now()}@bulk.local`;
  const su = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "bulkbulk" }),
  });
  captureCookies(su);
  if (!cookie) throw new Error("세션 쿠키를 못 받았어요 (signup 실패?)");
  log("임시 세션 확보:", email);

  const summary = { audio: 0, composed: 0, held: 0, fails: 0 };
  let n = 0;
  for (const t of targets) {
    n++;
    const tag = `(${n}/${targets.length}) ${t.title?.slice(0, 24) ?? t.id}`;
    let fails = 0;
    for (const i of t.idxs) {
      const a = await post("/api/audio/scene", { projectId: t.id, sceneIndex: i });
      if (a.ok) summary.audio++;
      else {
        fails++;
        log(`   · ${tag} 씬${i + 1} 음성 실패: ${a.error}`);
      }
    }
    summary.fails += fails;
    if (fails === 0 && t.composed) {
      const c = await post("/api/compose", { projectId: t.id, lang: "ko" });
      if (c.ok) {
        summary.composed++;
        log(`✓ ${tag} 마무리 음성 기본 목소리로 재생성 → 재합성 큐 적재`);
      } else {
        summary.held++;
        log(`△ ${tag} 음성은 됐는데 합성요청 실패: ${c.error}`);
      }
    } else if (fails === 0) {
      log(`✓ ${tag} 마무리 음성 재생성 (완성본 아님 — 합성 생략)`);
    } else {
      summary.held++;
      log(`△ ${tag} 음성 실패 → 합성 보류`);
    }
  }

  await redis.del(`user:${email}`).catch(() => {});
  await redis.srem("users", email).catch(() => {});

  log("──────── 완료 ────────");
  log(`음성 재생성: ${summary.audio} / 재합성 큐: ${summary.composed} / 보류: ${summary.held} / 실패: ${summary.fails}`);
}

main().catch((e) => {
  console.error("치명 오류:", e);
  process.exit(1);
});
