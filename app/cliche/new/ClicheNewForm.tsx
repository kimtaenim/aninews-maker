"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

export default function ClicheNewForm() {
  const router = useRouter();
  // 인물별 설정 — 각 인물마다 이름 + 클리셰 아키타입 지정. 이 인물들이 스크립트 화자/캐스팅으로 이어짐.
  const [characters, setCharacters] = useState<{ name: string; archetype: string }[]>([
    { name: "", archetype: "" },
    { name: "", archetype: "" },
  ]);
  const [selected, setSelected] = useState<Set<string>>(new Set(["첫 만남", "심쿵 눈맞춤", "고백"]));
  const [free, setFree] = useState("");
  const [style, setStyle] = useState<"webtoon" | "realistic">("webtoon");
  const [userPrompt, setUserPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(t: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }
  function setChar(i: number, patch: Partial<{ name: string; archetype: string }>) {
    setCharacters((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addChar() {
    setCharacters((prev) => [...prev, { name: "", archetype: "" }]);
  }
  function removeChar(i: number) {
    setCharacters((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function create() {
    setError(null);
    const freeTropes = free.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const tropes = [...selected, ...freeTropes];
    if (tropes.length === 0) {
      setError("클리셰를 하나 이상 골라주세요");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/cliche/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tropes,
          characters: characters
            .map((c) => ({ name: c.name.trim(), archetype: c.archetype }))
            .filter((c) => c.name || c.archetype),
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
                className="w-28 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-pink-500"
              />
              <select
                value={c.archetype}
                onChange={(e) => setChar(i, { archetype: e.target.value })}
                className="flex-1 min-w-[120px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-pink-500"
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
          업로드한 실제 얼굴은 항상 웹툰체로 변환되어 나옵니다(실사 복제 불가). 얼굴 캐스팅은 다음 단계에서.
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
        onClick={create}
        disabled={loading}
        className="rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-40 text-white font-semibold py-3 transition-colors"
      >
        {loading ? "만드는 중…" : "💘 만들기 → 스튜디오로"}
      </button>
    </div>
  );
}
