"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/Spinner";

// 병렬로 채울 표정 id — 서버 lib/simFaces.ts 의 FACE_EXPRESSIONS(중립 제외)와 동기.
// (simFaces 는 openai/blob 를 import 하는 서버 전용 모듈이라 클라에서 직접 import하지 않는다.)
const EXPR_IDS = ["smile", "frown", "blush", "sulk"] as const;

export interface PlayTarget {
  name: string;
  archetype: string;
  portraitUrl: string;
  faces?: Record<string, string>; // 표정 얼굴 세트 (neutral/smile/frown/blush/sulk → URL)
  cutsceneCount: number;
}

// 상태 변화로 이번 턴 표정을 정한다(숫자는 계속 숨긴다 — 표정으로만 드러냄).
// 몇 턴 안에 싫음이 확 오르면 찌푸림, 좋음이 오르면 미소/발그레.
function nextExpr(args: {
  like: number;
  dislike: number;
  dLike: number;
  dDislike: number;
  sulking: boolean;
  hold: number; // 남은 유지 턴
}): { expr: string; hold: number } {
  const { like, dislike, dLike, dDislike, sulking, hold } = args;
  if (sulking) return { expr: "sulk", hold: 0 };
  if (dDislike >= 4) return { expr: "frown", hold: 2 };
  if (dLike >= 3) return { expr: like >= 50 && dislike < 20 ? "blush" : "smile", hold: 2 };
  if (hold > 0) return { expr: "__keep", hold: hold - 1 }; // 직전 표정 유지
  return { expr: like >= 55 && dislike < 20 ? "blush" : "neutral", hold: 0 };
}

// 이어할 수 있는 기존 세션(관계) — 상대별로 진행 중인 플레이가 있으면 서버가 넘긴다.
export interface ResumeData {
  name: string; // 상대 이름
  playId: string;
  like: number;
  dislike: number;
  sulking: boolean;
  turns: { role: "user" | "assistant"; text: string; sulking?: boolean }[];
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  sulking?: boolean; // 이 대사가 삐진 상태의 대사인지(말풍선 톤)
}

// 상대의 표정 — 좋음·싫음·삐짐을 종합한 소프트 신호(정확한 숫자는 감춘다).
function moodFace(like: number, dislike: number, sulking: boolean): string {
  if (sulking) return "😤";
  if (dislike >= 25) return "😕";
  if (like >= 60 && dislike < 10) return "😊";
  if (like >= 35) return "🙂";
  return "😐";
}

interface Cutscene {
  at: number;
  videoUrl: string;
  title?: string;
}

export default function PlayClient({
  gameId,
  targets,
  resumes = [],
  isAdmin = false,
}: {
  gameId: string;
  targets: PlayTarget[];
  resumes?: ResumeData[];
  isAdmin?: boolean;
}) {
  const resumeFor = (name: string) => resumes.find((r) => r.name === name);
  const [phase, setPhase] = useState<"pick" | "starting" | "playing">(
    targets.length === 1 ? "starting" : "pick"
  );
  const [target, setTarget] = useState<PlayTarget | null>(
    targets.length === 1 ? targets[0] : null
  );
  const [playId, setPlayId] = useState("");
  const [like, setLike] = useState(20);
  const [dislike, setDislike] = useState(0);
  const [sulking, setSulking] = useState(false);
  const [expr, setExpr] = useState("neutral"); // 현재 표정 얼굴 id
  const exprHold = useRef(0);
  // 얼굴 자동 생성(백필) — 얼굴 없는 인물은 처음 플레이할 때 백그라운드로 만든다.
  const [genFaces, setGenFaces] = useState<Record<string, string> | null>(null);
  const [faceGen, setFaceGen] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [faceErr, setFaceErr] = useState(""); // 실제 실패/부분실패 원인(디버그 노출)
  const faceGenTried = useRef<Set<string>>(new Set());
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string>("");
  const [cutscene, setCutscene] = useState<Cutscene | null>(null);
  const [ending, setEnding] = useState<{ won: boolean; reason: string } | null>(null);
  const [error, setError] = useState("");
  // 개발자용 비용 추적 — 이번 판 누적 USD + 대화 턴 수.
  const [costUsd, setCostUsd] = useState(0);
  const [turnCount, setTurnCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 상대 하나면 자동 진입 — 이어할 세션이 있으면 이어받고, 없으면 새로 시작.
  useEffect(() => {
    if (targets.length !== 1) return;
    const r = resumeFor(targets[0].name);
    if (r) hydrateResume(targets[0], r);
    else void start(targets[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 얼굴이 없는 인물이면 백그라운드로 표정 얼굴을 자동 생성해 게임에 저장한다.
  // 5장을 한 요청에 몰면 48~60s로 먹통이라, 중립을 먼저 빨리 띄우고(≈18s) 표정 4장은
  // 병렬 요청으로 쪼개 '완성되는 대로 하나씩' 화면에 꽂는다(스트리밍).
  async function ensureFaces(t: PlayTarget) {
    if (pickFaceUrl(t, "neutral")) return; // 이미 얼굴/포트레이트 있음
    if (faceGenTried.current.has(t.name)) return;
    faceGenTried.current.add(t.name);
    setFaceGen("busy");
    setFaceErr("");

    const post = (expr?: string) =>
      fetch("/api/sim/faces/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, targetName: t.name, ...(expr ? { expr } : {}) }),
      }).then(async (res) => {
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || `실패 (HTTP ${res.status})`);
        return data.faces as Record<string, string>;
      });

    // 1) 중립 먼저 — 이게 뜨면 큰 얼굴이 바로 보인다(먹통 해소).
    //    캐릭터 캐시가 있으면 서버가 표정까지 함께 실어 보낸다(재사용 — 생성 없음).
    let first: Record<string, string>;
    try {
      first = await post();
    } catch (e) {
      setFaceErr(e instanceof Error ? e.message : String(e));
      setFaceGen("fail");
      return;
    }
    setGenFaces((prev) => ({ ...(prev ?? {}), ...first }));
    setFaceGen("done"); // 얼굴 나옴 — 표정은 백그라운드로 계속 채운다

    // 2) 아직 없는 표정만 병렬 요청 — 각자 끝나는 대로 genFaces 에 머지(스트리밍).
    const missing = EXPR_IDS.filter((e) => !first[e]);
    if (missing.length === 0) return; // 전부 캐시에서 재사용 — 추가 생성 없음
    const errs: string[] = [];
    await Promise.all(
      missing.map((expr) =>
        post(expr)
          .then((faces) => setGenFaces((prev) => ({ ...(prev ?? {}), ...faces })))
          .catch((e) => errs.push(`${expr}: ${e instanceof Error ? e.message : String(e)}`))
      )
    );
    if (errs.length) setFaceErr("표정 일부 실패: " + errs.join(" | "));
  }

  // 기존 세션(관계)을 화면에 복원해 이어서 플레이.
  function hydrateResume(t: PlayTarget, r: ResumeData) {
    setTarget(t);
    setPlayId(r.playId);
    setLike(r.like);
    setDislike(r.dislike);
    setSulking(r.sulking);
    exprHold.current = 0;
    setExpr(r.sulking ? "sulk" : r.like >= 55 && r.dislike < 20 ? "blush" : "neutral");
    setGenFaces(null);
    setCostUsd(0);
    setTurnCount(r.turns.filter((x) => x.role === "user").length);
    setMsgs(r.turns.map((x) => ({ role: x.role, text: x.text, sulking: x.sulking })));
    setEnding(null);
    setError("");
    setPhase("playing");
    void ensureFaces(t);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, sending]);

  async function start(t: PlayTarget) {
    setTarget(t);
    setPhase("starting");
    setError("");
    try {
      const res = await fetch("/api/sim/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, targetName: t.name }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `시작 실패 (${res.status})`);
      setPlayId(data.playId);
      setLike(data.like ?? 20);
      setDislike(data.dislike ?? 0);
      setSulking(false);
      exprHold.current = 0;
      setExpr("neutral");
      setGenFaces(null);
      setCostUsd(data.costUsd ?? 0);
      setTurnCount(0);
      setMsgs([{ role: "assistant", text: data.opening }]);
      setPhase("playing");
      void ensureFaces(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "세션 시작 실패");
      setPhase("pick");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || ending) return;
    setInput("");
    setBanner("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/sim/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playId, message: text }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `전송 실패 (${res.status})`);
      const nl = data.like ?? like;
      const nd = data.dislike ?? dislike;
      // 표정 갱신(변화량 기준). __keep 이면 직전 표정 유지.
      const e = nextExpr({
        like: nl,
        dislike: nd,
        dLike: nl - like,
        dDislike: nd - dislike,
        sulking: !!data.sulking,
        hold: exprHold.current,
      });
      exprHold.current = e.hold;
      if (e.expr !== "__keep") setExpr(e.expr);
      setLike(nl);
      setDislike(nd);
      setSulking(!!data.sulking);
      setCostUsd((c) => c + (data.costUsd ?? 0));
      setTurnCount((n) => n + 1);
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: data.reply, sulking: data.sulking },
      ]);
      // 배너 우선순위: 화해 > 삐짐 > 마일스톤 > 상황 (숫자는 감추고 상태만 알린다)
      if (data.justSoothed) setBanner("💗 마음이 풀렸다 — 화해!");
      else if (data.justSulked) setBanner("💢 토라졌다… 왜 그러는지 눈치껏 사과해야 해");
      else if (data.crossedMilestone) setBanner("💞 사이가 한 뼘 가까워졌다!");
      else if (data.situationLabel) setBanner(`💬 ${data.situationLabel}`);
      if (data.crossedMilestone && data.cutscene?.videoUrl) setCutscene(data.cutscene);
      if (data.status === "won" || data.status === "lost") {
        setEnding({ won: data.status === "won", reason: data.endedReason || "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "전송 실패");
    } finally {
      setSending(false);
    }
  }

  // ── 상대 고르기 ──
  if (phase === "pick") {
    return (
      <div className="mt-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">누구와 대화할까요?</p>
        <div className="mt-3 grid gap-2">
          {targets.map((t) => {
            const r = resumeFor(t.name);
            const turns = r ? r.turns.filter((x) => x.role === "user").length : 0;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => (r ? hydrateResume(t, r) : start(t))}
                className="flex items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <Avatar t={t} size={40} />
                <span className="flex-1 text-sm">
                  <span className="font-medium">{t.name}</span>
                  {t.archetype && (
                    <span className="ml-2 text-xs text-zinc-500">{t.archetype}</span>
                  )}
                </span>
                {r && (
                  <span className="shrink-0 rounded-full bg-rose-100 dark:bg-rose-950/50 px-2.5 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                    이어하기 · {turns}턴
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* 큰 표정 얼굴 (미연시 스타일) — 상태 따라 표정이 바뀐다. 숫자는 감추고 얼굴·바로만. */}
      <div className="flex flex-col items-center">
        {target &&
          (() => {
            const faceTarget = genFaces
              ? { ...target, faces: { ...(target.faces ?? {}), ...genFaces } }
              : target;
            const url = pickFaceUrl(faceTarget, expr);
            return url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={target.name}
                className="aspect-square w-full max-w-[300px] rounded-3xl object-cover object-top shadow-sm ring-1 ring-zinc-200/70 dark:ring-zinc-800 transition-all duration-300"
              />
            ) : (
              <div className="relative flex aspect-square w-full max-w-[300px] flex-col items-center justify-center gap-2 rounded-3xl bg-zinc-100 dark:bg-zinc-900 text-zinc-300 dark:text-zinc-700">
                <span className="text-6xl font-semibold">{target.name.slice(0, 1)}</span>
                {faceGen === "busy" && (
                  <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Spinner /> 얼굴 만드는 중…
                  </span>
                )}
                {faceGen === "fail" && (
                  <span className="max-w-[260px] px-2 text-center text-[11px] text-red-400">
                    {faceErr || "얼굴 생성 실패"}
                  </span>
                )}
              </div>
            );
          })()}
        {faceErr && faceGen !== "fail" && (
          <p className="mt-1 max-w-[300px] text-center text-[11px] text-amber-500">{faceErr}</p>
        )}
        <div className="mt-2 flex w-full max-w-[300px] items-center gap-1.5 text-sm">
          <span className="font-medium">{target?.name}</span>
          <span className="text-base">{moodFace(like, dislike, sulking)}</span>
          {sulking && (
            <span className="rounded-full bg-red-100 dark:bg-red-950/50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
              삐짐
            </span>
          )}
          {!ending && (
            <button
              type="button"
              onClick={() => {
                if (target && confirm("이 관계를 지우고 처음부터 다시 시작할까요?")) start(target);
              }}
              className="ml-auto shrink-0 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              ↻ 처음부터
            </button>
          )}
        </div>
      </div>

      {/* 좋음·싫음 두 바 */}
      <div className="mx-auto mt-3 w-full max-w-[300px] space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[10px] text-rose-500">좋음</span>
          <div className="h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500 transition-all duration-500"
              style={{ width: `${like}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[10px] text-slate-500">싫음</span>
          <div className="h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-600 transition-all duration-500"
              style={{ width: `${dislike}%` }}
            />
          </div>
        </div>
      </div>

      {banner && (
        <div className="mt-3 rounded-xl bg-violet-100 dark:bg-violet-950/40 px-3 py-2 text-center text-xs font-medium text-violet-700 dark:text-violet-300">
          {banner}
        </div>
      )}

      {cutscene && (
        <div className="mt-3 rounded-2xl border border-pink-200 dark:border-pink-900 p-3">
          <div className="text-xs font-medium text-pink-600 dark:text-pink-400">
            🎬 컷씬
            {cutscene.title ? ` — ${cutscene.title}` : ""}
          </div>
          <video
            src={cutscene.videoUrl}
            controls
            autoPlay
            className="mt-2 w-full rounded-xl"
          />
          <button
            type="button"
            onClick={() => setCutscene(null)}
            className="mt-2 text-xs text-zinc-500 hover:underline"
          >
            닫기
          </button>
        </div>
      )}

      {/* 대화 */}
      <div
        ref={scrollRef}
        className="mt-3 h-[38vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2"
      >
        {phase === "starting" && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Spinner /> {target?.name} 이(가) 다가오는 중…
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-accent text-white"
                  : m.sulking
                    ? "bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-900/40"
                    : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-400">
              <Spinner />
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {ending ? (
        <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 text-center">
          <div className="text-3xl">{ending.won ? "💖" : "💔"}</div>
          <div className="mt-2 text-base font-semibold">
            {ending.won ? "이어졌다!" : "여기까지…"}
          </div>
          <p className="mt-1 text-sm text-zinc-500">{ending.reason}</p>
          {/* 최종 좋음·싫음 요약 — 숫자 없이 바로만 */}
          <div className="mx-auto mt-3 max-w-[220px] space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-left text-[10px] text-rose-500">좋음</span>
              <div className="h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500"
                  style={{ width: `${like}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-left text-[10px] text-slate-500">싫음</span>
              <div className="h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-600"
                  style={{ width: `${dislike}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => target && start(target)}
              className="rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium px-4 py-2"
            >
              다시 도전
            </button>
            <Link
              href="/sim"
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              목록으로
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            disabled={phase !== "playing" || sending}
            placeholder="답장을 입력하세요…"
            className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2.5 text-sm"
          />
          <button
            type="button"
            onClick={send}
            disabled={phase !== "playing" || sending || !input.trim()}
            className="rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-semibold px-4 disabled:opacity-40"
          >
            보내기
          </button>
        </div>
      )}

      {/* 개발자용 비용 푸터 — 관리자에게만(테스터엔 숨김). 이번 판 누적 Claude 비용. */}
      {isAdmin && (
        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
          <span>🛠 개발자용</span>
          <span>
            이번 판 {turnCount}턴 · ₩{Math.round(costUsd * 1400).toLocaleString("ko-KR")}
            <span className="ml-1 text-zinc-300 dark:text-zinc-600">
              (${costUsd.toFixed(4)})
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// 표정 얼굴 URL 고르기: faces[표정] → faces.neutral → 기본 포트레이트 → 없음.
function pickFaceUrl(t: PlayTarget, expr: string): string {
  return (t.faces && (t.faces[expr] || t.faces.neutral)) || t.portraitUrl || "";
}

function Avatar({ t, size, expr = "neutral" }: { t: PlayTarget; size: number; expr?: string }) {
  const url = pickFaceUrl(t, expr);
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={t.name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover transition-all duration-300"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-sm"
    >
      {t.name.slice(0, 1)}
    </span>
  );
}
