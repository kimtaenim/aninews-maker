"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // 새 세션 쿠키를 확실히 반영하도록 하드 이동(클라 라우터 캐시 우회).
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했어요");
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-accent";

  return (
    <main className="px-4 py-12 md:max-w-sm md:mx-auto">
      <h1 className="text-lg font-semibold tracking-tight">
        {mode === "login" ? "로그인" : "가입하기"}
      </h1>
      <p className="mt-1 text-xs text-zinc-500">
        AI인 뉴스영상 — 이메일로 {mode === "login" ? "로그인" : "가입"}하세요.
      </p>

      <form onSubmit={submit} className="mt-6 grid gap-3">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={inputCls}
        />
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder="비밀번호 (6자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className={inputCls}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-accent hover:bg-accent-strong disabled:opacity-50 text-white font-semibold px-5 py-3.5 transition-colors"
        >
          {loading ? "처리 중…" : mode === "login" ? "로그인" : "가입하고 시작"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "login" ? "signup" : "login"));
          setError(null);
        }}
        className="mt-4 text-xs text-zinc-500 hover:text-accent"
      >
        {mode === "login"
          ? "계정이 없나요? 가입하기 →"
          : "이미 계정이 있나요? 로그인 →"}
      </button>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
