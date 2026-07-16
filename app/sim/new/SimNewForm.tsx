"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Spinner from "@/components/Spinner";

// 시뮬 제조기 위저드 — 3단계.
//  1) 인물 프로젝트 선택 + 공략 상대 고르기
//  2) 상대별 페르소나 초안 생성(Haiku)·수정
//  3) 마일스톤(25/50/75) 컷씬 영상 지정(선택) + 게임 만들기
// 저장 시 서버가 포트레이트·컷씬 영상 URL 을 원본에서 다시 읽어 스냅샷 뜬다.

export interface SourceCandidate {
  id: string;
  title: string;
  members: { name: string; archetype?: string; portraitUrl?: string }[];
}

export interface CutsceneCandidate {
  id: string;
  title: string;
}

const MILESTONES = [25, 50, 75] as const;

export default function SimNewForm({
  sources,
  videos,
}: {
  sources: SourceCandidate[];
  videos: CutsceneCandidate[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]); // 공략 상대 이름들
  const [personas, setPersonas] = useState<Record<string, string>>({});
  const [personaBusy, setPersonaBusy] = useState<Record<string, boolean>>({});
  // cutscenes[상대이름][마일스톤] = 컷씬 프로젝트 id ("" = 없음)
  const [cutscenes, setCutscenes] = useState<Record<string, Record<number, string>>>({});
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const source = sources.find((s) => s.id === sourceId);
  const targets = (source?.members ?? []).filter((m) => picked.includes(m.name));

  function togglePick(name: string) {
    setPicked((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  async function generatePersona(name: string, archetype?: string) {
    setPersonaBusy((b) => ({ ...b, [name]: true }));
    setError("");
    try {
      const res = await fetch("/api/sim/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, archetype }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `생성 실패 (${res.status})`);
      setPersonas((p) => ({ ...p, [name]: data.persona }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "페르소나 생성 실패");
    } finally {
      setPersonaBusy((b) => ({ ...b, [name]: false }));
    }
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sim/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          sourceProjectId: sourceId,
          targets: targets.map((t) => ({
            name: t.name,
            persona: (personas[t.name] ?? "").trim(),
            cutscenes: MILESTONES.filter((at) => cutscenes[t.name]?.[at])
              .map((at) => ({ at, projectId: cutscenes[t.name][at] })),
          })),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `생성 실패 (${res.status})`);
      router.push("/sim");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "게임 생성 실패");
      setBusy(false);
    }
  }

  const stepChip = (n: number, label: string) => (
    <span
      className={`rounded-full px-3 py-1 text-xs ${
        step === n
          ? "bg-accent text-white"
          : "border border-zinc-200 dark:border-zinc-800 text-zinc-500"
      }`}
    >
      {n}. {label}
    </span>
  );

  return (
    <div className="mt-5">
      <div className="flex gap-2">{stepChip(1, "상대 고르기")}{stepChip(2, "페르소나")}{stepChip(3, "컷씬·완성")}</div>

      {/* ── 1단계: 인물 프로젝트 + 공략 상대 ── */}
      {step === 1 && (
        <div className="mt-5 grid gap-4">
          <div>
            <h2 className="text-sm font-semibold">인물을 데려올 클리셰 프로젝트</h2>
            <div className="mt-2 grid gap-2">
              {sources.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 ${
                    sourceId === s.id
                      ? "border-accent"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="source"
                    checked={sourceId === s.id}
                    onChange={() => {
                      setSourceId(s.id);
                      setPicked([]);
                    }}
                  />
                  <span className="text-sm">
                    {s.title}
                    <span className="ml-2 text-xs text-zinc-500">
                      {s.members.map((m) => m.name).join(", ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {source && (
            <div>
              <h2 className="text-sm font-semibold">
                공략 상대 <span className="text-zinc-400">(1명 이상)</span>
              </h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {source.members.map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => togglePick(m.name)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      picked.includes(m.name)
                        ? "border-accent bg-accent/10"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    {m.portraitUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.portraitUrl}
                        alt={m.name}
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs">
                        {m.name.slice(0, 1)}
                      </span>
                    )}
                    {m.name}
                    {m.archetype && (
                      <span className="text-xs text-zinc-500">{m.archetype}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={picked.length === 0}
            onClick={() => setStep(2)}
            className="rounded-2xl bg-accent hover:bg-accent-strong text-white font-semibold px-5 py-3 disabled:opacity-40"
          >
            다음 — 페르소나 만들기
          </button>
        </div>
      )}

      {/* ── 2단계: 페르소나 ── */}
      {step === 2 && (
        <div className="mt-5 grid gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            상대별 성격·말투·좋아하는/싫어하는 반응을 정합니다. 이게 대화와 친밀도
            채점의 기준이 돼요. 자동 생성 후 자유롭게 고쳐 쓰세요.
          </p>
          {targets.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  {t.name}
                  {t.archetype && (
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {t.archetype}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!!personaBusy[t.name]}
                  onClick={() => generatePersona(t.name, t.archetype)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                >
                  {personaBusy[t.name] ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Spinner /> 생성 중
                    </span>
                  ) : personas[t.name] ? (
                    "다시 생성"
                  ) : (
                    "자동 생성"
                  )}
                </button>
              </div>
              <textarea
                value={personas[t.name] ?? ""}
                onChange={(e) =>
                  setPersonas((p) => ({ ...p, [t.name]: e.target.value }))
                }
                rows={10}
                placeholder="자동 생성을 누르거나 직접 입력하세요"
                className="mt-3 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent p-3 text-sm"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 px-5 py-3 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              ← 이전
            </button>
            <button
              type="button"
              disabled={targets.some((t) => !(personas[t.name] ?? "").trim())}
              onClick={() => setStep(3)}
              className="flex-1 rounded-2xl bg-accent hover:bg-accent-strong text-white font-semibold px-5 py-3 disabled:opacity-40"
            >
              다음 — 컷씬 정하기
            </button>
          </div>
        </div>
      )}

      {/* ── 3단계: 컷씬 + 완성 ── */}
      {step === 3 && (
        <div className="mt-5 grid gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            친밀도 25·50·75 에 도달하면 재생할 클리셰 영상을 고릅니다(선택 —
            비워두면 컷씬 없이 진행). 완성 영상이 있는 프로젝트만 나와요.
          </p>
          {targets.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4"
            >
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="mt-3 grid gap-2">
                {MILESTONES.map((at) => (
                  <label key={at} className="flex items-center gap-3 text-sm">
                    <span className="w-20 shrink-0 text-xs text-zinc-500">
                      친밀도 {at}
                    </span>
                    <select
                      value={cutscenes[t.name]?.[at] ?? ""}
                      onChange={(e) =>
                        setCutscenes((c) => ({
                          ...c,
                          [t.name]: { ...(c[t.name] ?? {}), [at]: e.target.value },
                        }))
                      }
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent p-2 text-sm"
                    >
                      <option value="">(컷씬 없음)</option>
                      {videos.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {videos.length === 0 && (
            <p className="text-xs text-zinc-500">
              완성된 클리셰 영상이 아직 없어요 — 컷씬 없이 만들고 나중에 다시 만들 수
              있어요.
            </p>
          )}

          <div>
            <h2 className="text-sm font-semibold">게임 이름 (비우면 자동)</h2>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`💞 ${targets.map((t) => t.name).join("·")} 공략`}
              className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent p-3 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 px-5 py-3 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              ← 이전
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={create}
              className="flex-1 rounded-2xl bg-accent hover:bg-accent-strong text-white font-semibold px-5 py-3 disabled:opacity-40"
            >
              {busy ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Spinner /> 만드는 중
                </span>
              ) : (
                "🎮 게임 만들기"
              )}
            </button>
          </div>
        </div>
      )}

      {error && step !== 3 && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </div>
  );
}
