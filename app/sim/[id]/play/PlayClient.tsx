"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/Spinner";

export interface PlayTarget {
  name: string;
  archetype: string;
  portraitUrl: string;
  cutsceneCount: number;
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  delta?: number; // assistant 턴 친밀도 증감(표시용)
}

interface Cutscene {
  at: number;
  videoUrl: string;
  title?: string;
}

export default function PlayClient({
  gameId,
  targets,
}: {
  gameId: string;
  targets: PlayTarget[];
}) {
  const [phase, setPhase] = useState<"pick" | "starting" | "playing">(
    targets.length === 1 ? "starting" : "pick"
  );
  const [target, setTarget] = useState<PlayTarget | null>(
    targets.length === 1 ? targets[0] : null
  );
  const [playId, setPlayId] = useState("");
  const [affinity, setAffinity] = useState(20);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string>("");
  const [cutscene, setCutscene] = useState<Cutscene | null>(null);
  const [ending, setEnding] = useState<{ won: boolean; reason: string } | null>(null);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 상대 하나면 자동 시작.
  useEffect(() => {
    if (phase === "starting" && target) void start(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setAffinity(data.affinity);
      setMsgs([{ role: "assistant", text: data.opening }]);
      setPhase("playing");
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
      setAffinity(data.affinity);
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: data.reply, delta: data.affinityDelta },
      ]);
      if (data.situationLabel) setBanner(`💬 ${data.situationLabel}`);
      if (data.crossedMilestone) {
        setBanner(`💞 친밀도 ${data.crossedMilestone} 돌파!`);
        if (data.cutscene?.videoUrl) setCutscene(data.cutscene);
      }
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
          {targets.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => start(t)}
              className="flex items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <Avatar t={t} size={40} />
              <span className="text-sm">
                <span className="font-medium">{t.name}</span>
                {t.archetype && (
                  <span className="ml-2 text-xs text-zinc-500">{t.archetype}</span>
                )}
              </span>
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* 친밀도 게이지 */}
      <div className="flex items-center gap-3">
        {target && <Avatar t={target} size={36} />}
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{target?.name}</span>
            <span className="text-zinc-500">친밀도 {affinity}/100</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500 transition-all duration-500"
              style={{ width: `${affinity}%` }}
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
            🎬 컷씬 · 친밀도 {cutscene.at}
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
        className="mt-3 h-[52vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2"
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
                  : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {m.text}
              {m.role === "assistant" && typeof m.delta === "number" && m.delta !== 0 && (
                <span
                  className={`ml-2 text-[11px] font-medium ${
                    m.delta > 0 ? "text-rose-500" : "text-zinc-400"
                  }`}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </span>
              )}
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
          <p className="mt-1 text-xs text-zinc-400">최종 친밀도 {affinity}/100</p>
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
    </div>
  );
}

function Avatar({ t, size }: { t: PlayTarget; size: number }) {
  if (t.portraitUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={t.portraitUrl}
        alt={t.name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
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
