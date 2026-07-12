"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

// 자주 쓰는 연애 클리셰(트로프) 프리셋. 자유 입력도 가능.
const TROPES = [
  "벽치기",
  "심쿵 눈맞춤",
  "우산 같이 쓰기",
  "손목 잡기",
  "재회",
  "첫 만남",
  "짝사랑",
  "밀당",
  "삼각관계",
  "고백",
  "티격태격",
  "비 오는 날",
];

// 인물 클리셰 아키타입 — 두 주인공 성격. 스크립트의 A·B + (다음 페이즈)시뮬 페르소나로 이어짐.
const CHAR_M = ["마초남", "소심남", "츤데레남", "오타쿠남", "재벌남", "나쁜남자", "순정남", "능글남"];
const CHAR_F = ["저돌적인 여자", "청순녀", "4차원녀", "새침녀", "발랄녀", "카리스마녀", "백치미녀", "대장부녀"];

// 위저드 화면 2(캐스팅)에서 채우는 인물 한 명. /api/cliche/new 의 castMembers 로 전달.
type WizardChar = {
  name: string;
  archetype: string;
  faceSource: "upload" | "generate"; // 얼굴 모드(업로드→웹툰 변환 / 설명 생성)
  faceUploadUrl?: string; // 업로드 원본 사진(변환 입력)
  faceDesc: string; // 생성 모드 외모 설명
  portraitUrl?: string; // 확정 포트레이트(캐릭터 시트)
  voiceId: string; // 목소리 ("" = 기본)
};

type Voice = { id: string; name: string; provider: string; gender?: string; note?: string; narration?: boolean };

const emptyChar = (): WizardChar => ({
  name: "",
  archetype: "",
  faceSource: "generate",
  faceDesc: "",
  voiceId: "",
});

export default function ClicheNewForm() {
  const router = useRouter();
  // 2화면 위저드: 1=클리셰·인물, 2=캐스팅(얼굴·목소리). 캐스팅 확정 후 프로젝트 생성.
  const [step, setStep] = useState<1 | 2>(1);
  // 캐스팅 산출물(포트레이트) Blob 경로용 임시 id — 프로젝트 생성 전이라 projectId 가 없다.
  const [draftId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `d${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const [characters, setCharacters] = useState<WizardChar[]>([emptyChar(), emptyChar()]);
  const [selected, setSelected] = useState<Set<string>>(new Set(["첫 만남", "심쿵 눈맞춤", "고백"]));
  const [free, setFree] = useState("");
  const [style, setStyle] = useState<"webtoon" | "realistic">("webtoon");
  const [userPrompt, setUserPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 캐스팅 화면 상태 — 포트레이트 생성/업로드 busy(한 번에 한 명), 목소리 목록·미리듣기.
  const [castBusy, setCastBusy] = useState<number | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [previewBusy, setPreviewBusy] = useState<number | null>(null);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/tts/voices")
      .then((r) => r.json())
      .then((d) => {
        // 클리셰 프로젝트 기본 TTS 엔진은 ElevenLabs — 그 목소리만 노출.
        if (alive && d?.ok) {
          setVoices(((d.voices ?? []) as Voice[]).filter((v) => v.provider === "elevenlabs"));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function toggle(t: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }
  function setChar(i: number, patch: Partial<WizardChar>) {
    setCharacters((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addChar() {
    setCharacters((prev) => [...prev, emptyChar()]);
  }
  function removeChar(i: number) {
    setCharacters((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function goCasting() {
    setError(null);
    const freeTropes = free.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (selected.size + freeTropes.length === 0) {
      setError("클리셰를 하나 이상 골라주세요");
      return;
    }
    setStep(2);
  }

  // ── 캐스팅: 포트레이트 생성/변환 ─────────────────────────────────────────────
  // uploadUrl 을 명시로 받는 이유: 업로드 직후 자동 변환 시 setState 반영 전이라 최신 URL 을 직접 넘긴다.
  async function genPortrait(i: number, uploadUrlOverride?: string) {
    const c = characters[i];
    const uploadUrl =
      c.faceSource === "upload" ? uploadUrlOverride ?? c.faceUploadUrl : undefined;
    if (c.faceSource === "upload" && !uploadUrl) {
      setError("먼저 사진을 올려주세요");
      return;
    }
    if (c.faceSource === "generate" && !c.name && !c.archetype && !c.faceDesc.trim()) {
      setError("이름·성격·외모 설명 중 하나는 입력해주세요");
      return;
    }
    setError(null);
    setCastBusy(i);
    try {
      const r = await fetch("/api/cast/portrait", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId,
          styleProfileId: style === "realistic" ? "realistic" : "webtoon-romance",
          name: c.name.trim() || undefined,
          archetype: c.archetype || undefined,
          description: c.faceDesc.trim() || undefined,
          uploadUrl,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setChar(i, { portraitUrl: data.url as string });
    } catch (e) {
      setError(e instanceof Error ? e.message : "포트레이트 생성 실패");
    } finally {
      setCastBusy(null);
    }
  }

  async function uploadFace(i: number, file: File) {
    setError(null);
    setCastBusy(i);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-60);
      const blob = await upload(`casting/${draftId}/face-${i}-${safe}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });
      setChar(i, { faceUploadUrl: blob.url });
      setCastBusy(null);
      // 올리자마자 웹툰 변환까지 이어서(한 번의 손짓).
      await genPortrait(i, blob.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진 업로드 실패");
      setCastBusy(null);
    }
  }

  async function previewVoice(i: number) {
    const c = characters[i];
    if (!c.voiceId) return;
    setPreviewBusy(i);
    try {
      const r = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "elevenlabs",
          voiceId: c.voiceId,
          text: `안녕, ${c.name.trim() || "나"}야. 오늘 왠지 좋은 일이 생길 것 같아.`,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        throw new Error(d?.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      void new Audio(URL.createObjectURL(blob)).play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "미리듣기 실패");
    } finally {
      setPreviewBusy(null);
    }
  }

  // withCasting=false 는 "건너뛰고 만들기" — 캐스팅 산출물 없이 기존 흐름 그대로.
  async function create(withCasting: boolean) {
    setError(null);
    const freeTropes = free.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const tropes = [...selected, ...freeTropes];
    if (tropes.length === 0) {
      setError("클리셰를 하나 이상 골라주세요");
      setStep(1);
      return;
    }
    setLoading(true);
    try {
      const filled = characters.filter(
        (c) => c.name.trim() || c.archetype || c.portraitUrl || c.voiceId
      );
      const r = await fetch("/api/cliche/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tropes,
          characters: filled.map((c) => ({ name: c.name.trim(), archetype: c.archetype })),
          ...(withCasting && filled.length
            ? {
                castMembers: filled.map((c) => ({
                  name: c.name.trim(),
                  archetype: c.archetype,
                  faceSource: c.portraitUrl ? c.faceSource : undefined,
                  faceUploadUrl: c.faceUploadUrl,
                  faceDesc: c.faceDesc.trim() || undefined,
                  portraitUrl: c.portraitUrl,
                  voiceId: c.voiceId || undefined,
                })),
              }
            : {}),
          styleProfileId: style === "realistic" ? "realistic" : "webtoon-romance",
          userPrompt: userPrompt.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      router.push(`/project/${data.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
      setLoading(false);
    }
  }

  const inputCls =
    "rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-pink-500";

  // ── 화면 2: 캐스팅 ───────────────────────────────────────────────────────────
  if (step === 2) {
    const anyBusy = castBusy !== null || loading;
    return (
      <div className="mt-6 grid gap-4">
        <div>
          <div className="text-[15px] font-semibold">🎬 캐스팅</div>
          <p className="mt-1 text-[12px] text-zinc-400">
            인물마다 얼굴(캐릭터 시트)과 목소리를 정하면, 스크립트·이미지가 이 인물들로
            일관되게 만들어집니다. 업로드한 실제 얼굴은 항상 웹툰체로 변환됩니다(실사 복제 불가).
          </p>
        </div>

        {characters.map((c, i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 grid gap-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-zinc-400">인물 {i + 1}</span>
              <input
                value={c.name}
                onChange={(e) => setChar(i, { name: e.target.value })}
                placeholder={`이름 (비면 인물${i + 1})`}
                className={`w-28 ${inputCls}`}
              />
              <select
                value={c.archetype}
                onChange={(e) => setChar(i, { archetype: e.target.value })}
                className={`flex-1 min-w-[120px] ${inputCls}`}
              >
                <option value="">성격 (안 고르면 AI가 정함)</option>
                <optgroup label="남">
                  {CHAR_M.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="여">
                  {CHAR_F.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </optgroup>
              </select>
              {characters.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeChar(i)}
                  disabled={anyBusy}
                  className="shrink-0 rounded-md px-2 py-1 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"
                  aria-label="인물 삭제"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 얼굴 — 업로드→웹툰 변환 또는 설명 생성 → 포트레이트 미리보기 + 다시 생성 */}
            <div className="flex flex-wrap items-start gap-3">
              <div className="w-20 shrink-0">
                {c.portraitUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.portraitUrl}
                    alt={`${c.name || `인물${i + 1}`} 포트레이트`}
                    className="w-20 h-20 rounded-lg object-cover object-top border border-zinc-200 dark:border-zinc-800"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-[11px] text-zinc-400">
                    {castBusy === i ? "생성 중…" : "얼굴 미정"}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-[200px] grid gap-1.5">
                <div className="inline-flex self-start rounded-lg border border-zinc-200 dark:border-zinc-800 p-0.5 text-[12px]">
                  {([
                    { id: "generate", label: "✨ 설명으로 생성" },
                    { id: "upload", label: "📷 사진 → 웹툰" },
                  ] as const).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setChar(i, { faceSource: m.id })}
                      disabled={anyBusy}
                      className={
                        "rounded-md px-2.5 py-1 transition-colors " +
                        (c.faceSource === m.id ? "bg-pink-500 text-white" : "text-zinc-500")
                      }
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {c.faceSource === "generate" ? (
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={c.faceDesc}
                      onChange={(e) => setChar(i, { faceDesc: e.target.value })}
                      placeholder="외모 설명 (예: 은발 단발, 안경, 차가운 인상)"
                      className={`flex-1 min-w-[160px] ${inputCls}`}
                    />
                    <button
                      type="button"
                      onClick={() => genPortrait(i)}
                      disabled={anyBusy}
                      className="rounded-lg bg-pink-500 hover:bg-pink-600 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5"
                    >
                      {castBusy === i ? "생성 중…" : c.portraitUrl ? "다시 생성" : "생성"}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={(el) => {
                        fileRefs.current[i] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void uploadFace(i, f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRefs.current[i]?.click()}
                      disabled={anyBusy}
                      className="rounded-lg bg-pink-500 hover:bg-pink-600 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5"
                    >
                      {castBusy === i ? "변환 중…" : c.faceUploadUrl ? "다른 사진" : "사진 올리기"}
                    </button>
                    {c.faceUploadUrl && (
                      <button
                        type="button"
                        onClick={() => genPortrait(i)}
                        disabled={anyBusy}
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm px-3 py-1.5 text-zinc-600 dark:text-zinc-300 disabled:opacity-40"
                      >
                        다시 변환
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 목소리 — 선택 + 미리듣기 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-zinc-400">목소리</span>
              <select
                value={c.voiceId}
                onChange={(e) => setChar(i, { voiceId: e.target.value })}
                className={`flex-1 min-w-[160px] ${inputCls}`}
              >
                <option value="">나중에 (스튜디오에서)</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.narration ? "★ " : ""}
                    {v.name}
                    {v.gender ? ` · ${v.gender}` : ""}
                    {v.note ? ` · ${v.note}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => previewVoice(i)}
                disabled={!c.voiceId || previewBusy !== null}
                className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300 disabled:opacity-40"
              >
                {previewBusy === i ? "…" : "▶ 미리듣기"}
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addChar}
          disabled={anyBusy}
          className="justify-self-start text-[12px] text-pink-600 dark:text-pink-400 hover:underline disabled:opacity-40"
        >
          ＋ 인물 추가
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => create(true)}
            disabled={anyBusy}
            className="rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-40 text-white font-semibold py-3 transition-colors"
          >
            {loading ? "만드는 중…" : "💘 캐스팅 확정하고 만들기 → 스튜디오로"}
          </button>
          <div className="flex items-center justify-between text-[13px]">
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={anyBusy}
              className="text-zinc-500 hover:underline disabled:opacity-40"
            >
              ← 클리셰로 돌아가기
            </button>
            <button
              type="button"
              onClick={() => create(false)}
              disabled={anyBusy}
              className="text-zinc-400 hover:underline disabled:opacity-40"
            >
              캐스팅 건너뛰고 만들기 (얼굴 일관성 없이)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 화면 1: 클리셰·인물 ──────────────────────────────────────────────────────
  return (
    <div className="mt-6 grid gap-5">
      <div>
        <div className="text-[13px] font-medium text-zinc-600 dark:text-zinc-300">
          인물 설정 <span className="text-zinc-400">(각 인물마다 이름·성격 — 남남·여여·남녀 자유)</span>
        </div>
        <div className="mt-2 grid gap-2">
          {characters.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-zinc-400">인물 {i + 1}</span>
              <input
                value={c.name}
                onChange={(e) => setChar(i, { name: e.target.value })}
                placeholder="이름 (선택)"
                className={`w-28 ${inputCls}`}
              />
              <select
                value={c.archetype}
                onChange={(e) => setChar(i, { archetype: e.target.value })}
                className={`flex-1 min-w-[120px] ${inputCls}`}
              >
                <option value="">성격 (안 고르면 AI가 정함)</option>
                <optgroup label="남">
                  {CHAR_M.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="여">
                  {CHAR_F.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </optgroup>
              </select>
              {characters.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeChar(i)}
                  className="shrink-0 rounded-md px-2 py-1 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                  aria-label="인물 삭제"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addChar}
            className="justify-self-start text-[12px] text-pink-600 dark:text-pink-400 hover:underline"
          >
            ＋ 인물 추가
          </button>
        </div>
      </div>

      <div>
        <div className="text-[13px] font-medium text-zinc-600 dark:text-zinc-300">
          클리셰 고르기 <span className="text-zinc-400">(복수 선택 → 5~6씬으로 엮음)</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {TROPES.map((t) => {
            const on = selected.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                className={
                  "rounded-full px-3.5 py-1.5 text-sm border transition-colors " +
                  (on
                    ? "border-pink-500 bg-pink-50 text-pink-700 dark:bg-pink-950/50 dark:text-pink-300 font-medium"
                    : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900")
                }
              >
                {t}
              </button>
            );
          })}
        </div>
        <input
          value={free}
          onChange={(e) => setFree(e.target.value)}
          placeholder="직접 입력 (쉼표로 여러 개: 옥상 고백, 첫눈)"
          className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-pink-500"
        />
      </div>

      <div>
        <div className="text-[13px] font-medium text-zinc-600 dark:text-zinc-300">그림체</div>
        <div className="mt-2 inline-flex rounded-xl border border-zinc-200 dark:border-zinc-800 p-0.5 text-sm">
          {([
            { id: "webtoon", label: "웹툰 미남미녀" },
            { id: "realistic", label: "실사" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setStyle(opt.id)}
              className={
                "rounded-lg px-4 py-1.5 font-medium transition-colors " +
                (style === opt.id ? "bg-pink-500 text-white" : "text-zinc-500")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400">
          업로드한 실제 얼굴은 항상 웹툰체로 변환되어 나옵니다(실사 복제 불가). 얼굴·목소리는 다음
          화면(캐스팅)에서.
        </p>
      </div>

      <div>
        <div className="text-[13px] font-medium text-zinc-600 dark:text-zinc-300">
          추가 지시 <span className="text-zinc-400">(선택)</span>
        </div>
        <textarea
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          rows={2}
          placeholder="예: 무뚝뚝한 남주 × 발랄한 여주, 학원물 배경"
          className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-pink-500 resize-y"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={goCasting}
        className="rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-semibold py-3 transition-colors"
      >
        다음 → 🎬 캐스팅 (얼굴·목소리)
      </button>
    </div>
  );
}
