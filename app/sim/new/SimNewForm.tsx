"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  hasVideo: boolean; // 완성 영상 유무 — 게임화 조건은 아니고, 컷씬을 붙일 수 있는지 표시용
}

export interface CutsceneCandidate {
  id: string;
  title: string;
}

const MILESTONES = [25, 50, 75] as const;

// 직접 만들기용 아키타입 프리셋 — 클리셰 폼과 동일 세트(칩으로 빠르게, 자유 입력도 가능).
const ARCHETYPES = [
  "마초남", "소심남", "츤데레남", "오타쿠남", "재벌남", "나쁜남자", "순정남", "능글남",
  "저돌적인 여자", "청순녀", "4차원녀", "새침녀", "발랄녀", "카리스마녀", "백치미녀", "대장부녀",
  // #8 고전·명작 클리셰 — Sonnet이 원작 성격을 반영해 페르소나를 만든다.
  "다아시(오만과 편견)", "히스클리프(폭풍의 언덕)", "로체스터(제인 에어)", "그레이(그레이의 50가지)",
];

interface DirectChar {
  name: string;
  archetype: string;
}

// #9 상황 프리셋 — 설정 고민 없이 바로 고르는 '관계·만남의 계기' 예시.
const PREMISE_PRESETS = [
  "오늘 첫 출근한 회사의 신입과 까칠한 사수",
  "10년 만에 재회한 소꿉친구",
  "라이벌 회사 후계자로 협상 테이블에서 만남",
  "사정상 연인인 척 계약 연애 중",
  "같은 과 조별과제 짝",
  "짝사랑하던 선배와 우연히 단둘이 남음",
  // #10 상담 훅 — 현실 연애 고민을 털어놓는 관계
  "내 연애 고민을 다 들어주는 다정한 상담가",
  "뭐든 털어놓을 수 있는 오랜 단짝",
];
// 주인공(나) 성격 프리셋.
const PROTAG_PRESETS = [
  "당돌하고 솔직한 신입",
  "낯가리지만 은근 승부욕 있는 대학생",
  "무던하고 다 받아주는 성격",
  "겁 많지만 정 많은 사람",
];

export default function SimNewForm({
  sources,
  videos,
}: {
  sources: SourceCandidate[];
  videos: CutsceneCandidate[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // 인물 출처: "project"=클리셰 프로젝트에서, "direct"=직접 만들기.
  // 클리셰 프로젝트가 하나도 없으면 바로 직접 만들기로 시작.
  const [mode, setMode] = useState<"project" | "direct">(
    sources.length ? "project" : "direct"
  );
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]); // 공략 상대 이름들(project 모드)
  const [directChars, setDirectChars] = useState<DirectChar[]>([
    { name: "", archetype: "" },
  ]);
  const [personas, setPersonas] = useState<Record<string, string>>({});
  const [personaBusy, setPersonaBusy] = useState<Record<string, boolean>>({});
  // cutscenes[상대이름][마일스톤] = 컷씬 프로젝트 id ("" = 없음)
  const [cutscenes, setCutscenes] = useState<Record<string, Record<number, string>>>({});
  const [title, setTitle] = useState("");
  // 주인공(플레이어) — 게임당 하나. 상대별 관계·만남의 계기(상대이름 → 텍스트).
  const [protagName, setProtagName] = useState("");
  const [protagPersona, setProtagPersona] = useState("");
  const [relationships, setRelationships] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const source = sources.find((s) => s.id === sourceId);

  // 공략 상대 목록 — 모드에 따라 파생. 두 모드 모두 {name, archetype?, portraitUrl?} 형태로.
  const targets: { name: string; archetype?: string; portraitUrl?: string }[] =
    mode === "project"
      ? (source?.members ?? []).filter((m) => picked.includes(m.name))
      : directChars
          .map((c) => ({ name: c.name.trim(), archetype: c.archetype.trim() || undefined }))
          .filter((c) => c.name);

  // 직접 입력 유효성: 이름 하나 이상 + 이름 중복 없음.
  const directNames = directChars.map((c) => c.name.trim()).filter(Boolean);
  const directValid =
    directNames.length > 0 && new Set(directNames).size === directNames.length;
  const step1Valid = mode === "project" ? picked.length > 0 : directValid;

  function togglePick(name: string) {
    setPicked((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  function updateDirect(i: number, patch: Partial<DirectChar>) {
    setDirectChars((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
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

  // 2단계 진입 시 페르소나만 자동 생성(빠름). 표정 얼굴은 게임 생성 때 안 기다리고,
  // 처음 플레이할 때 화면에서 백그라운드로 자동 생성된다(제조기가 오래 걸리지 않게).
  const autoTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (step !== 2) return;
    for (const t of targets) {
      if (autoTried.current.has(t.name)) continue;
      if ((personas[t.name] ?? "").trim() || personaBusy[t.name]) continue;
      autoTried.current.add(t.name);
      void generatePersona(t.name, t.archetype);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
          sourceProjectId: mode === "project" ? sourceId : undefined,
          protagonist:
            protagName.trim() && protagPersona.trim()
              ? { name: protagName.trim(), persona: protagPersona.trim() }
              : undefined,
          targets: targets.map((t) => ({
            name: t.name,
            archetype: t.archetype, // 직접 만든 인물의 아키타입(클리셰면 서버가 원본 사용)
            persona: (personas[t.name] ?? "").trim(),
            relationship: (relationships[t.name] ?? "").trim() || undefined,
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

      {/* ── 1단계: 인물 출처(클리셰/직접) + 공략 상대 ── */}
      {step === 1 && (
        <div className="mt-5 grid gap-4">
          {/* 출처 토글 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("project")}
              disabled={sources.length === 0}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-40 ${
                mode === "project"
                  ? "border-accent bg-accent/10"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              클리셰에서 데려오기
            </button>
            <button
              type="button"
              onClick={() => setMode("direct")}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
                mode === "direct"
                  ? "border-accent bg-accent/10"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              직접 만들기
            </button>
          </div>

          {/* 직접 만들기 */}
          {mode === "direct" && (
            <div>
              <h2 className="text-sm font-semibold">인물 직접 추가</h2>
              <p className="mt-1 text-xs text-zinc-500">
                이름과 성격(아키타입)만 정하면 됩니다. 클리셰 프로젝트 없이 바로 게임이 돼요.
              </p>
              <div className="mt-3 grid gap-3">
                {directChars.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={c.name}
                        onChange={(e) => updateDirect(i, { name: e.target.value })}
                        placeholder="이름 (예: 서준)"
                        className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
                      />
                      {directChars.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDirectChars((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-red-500"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                    <input
                      value={c.archetype}
                      onChange={(e) => updateDirect(i, { archetype: e.target.value })}
                      placeholder="성격 (예: 츤데레남) — 아래에서 골라도 돼요"
                      className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ARCHETYPES.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => updateDirect(i, { archetype: a })}
                          className={`rounded-full border px-2.5 py-0.5 text-xs ${
                            c.archetype === a
                              ? "border-accent bg-accent/10"
                              : "border-zinc-200 dark:border-zinc-800 text-zinc-500"
                          }`}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setDirectChars((prev) => [...prev, { name: "", archetype: "" }])
                }
                className="mt-2 text-sm text-accent hover:underline"
              >
                + 인물 추가
              </button>
              {directNames.length !== new Set(directNames).size && (
                <p className="mt-2 text-xs text-red-500">이름이 겹쳐요 — 다르게 지어주세요.</p>
              )}
            </div>
          )}

          {/* 클리셰에서 데려오기 */}
          {mode === "project" && (
          <div>
            <h2 className="text-sm font-semibold">인물을 데려올 클리셰 프로젝트</h2>
            <p className="mt-1 text-xs text-zinc-500">
              영상이 완성되지 않아도 됩니다 — 인물만 정해져 있으면 바로 게임으로 만들 수
              있어요.
            </p>
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
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        s.hasVideo
                          ? "bg-pink-100 dark:bg-pink-950/50 text-pink-600 dark:text-pink-400"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {s.hasVideo ? "영상 완성 · 컷씬 가능" : "인물만 · 컷씬 없이"}
                    </span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {s.members.map((m) => m.name).join(", ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          )}

          {mode === "project" && source && (
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
            disabled={!step1Valid}
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

          {/* 주인공(나) 설정 — 상대가 당신을 '누구'로 대할지 결정한다 */}
          <div className="rounded-2xl border border-accent/40 bg-accent/5 p-4">
            <div className="text-sm font-semibold">
              🙋 주인공(나) 설정{" "}
              <span className="text-xs font-normal text-zinc-500">
                — 상대가 당신을 누구로 대할지 (비우면 익명)
              </span>
            </div>
            <input
              value={protagName}
              onChange={(e) => setProtagName(e.target.value)}
              placeholder="내 이름 (예: 하연)"
              className="mt-3 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              value={protagPersona}
              onChange={(e) => setProtagPersona(e.target.value)}
              rows={3}
              placeholder="내 성격·설정 (예: 당돌하고 솔직한 신입 사원)"
              className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent p-3 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PROTAG_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProtagPersona(p)}
                  className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

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

              <input
                value={relationships[t.name] ?? ""}
                onChange={(e) =>
                  setRelationships((r) => ({ ...r, [t.name]: e.target.value }))
                }
                placeholder={`${t.name}와의 관계·만남의 계기 (예: 오늘 첫 출근한 그의 비서)`}
                className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PREMISE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRelationships((r) => ({ ...r, [t.name]: p }))}
                    className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    {p}
                  </button>
                ))}
              </div>

              <p className="mt-2 text-xs text-zinc-400">
                표정 얼굴은 이 인물을 처음 플레이할 때 자동으로 만들어져요.
              </p>
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
