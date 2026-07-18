import Link from "next/link";
import { getSimGame, getResumablePlays } from "@/lib/simStore";
import { getSessionEmail, ADMIN_EMAIL } from "@/lib/auth";
import PlayClient, { type PlayTarget, type ResumeData } from "./PlayClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 시뮬 플레이 화면 — PoC: 상대 하나면 자동 시작, 여럿이면 client 에서 고른다.
export default async function SimPlayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const game = await getSimGame(id);

  if (!game) {
    return (
      <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
        <p className="text-sm text-red-500">게임을 찾을 수 없어요.</p>
        <Link href="/sim" className="mt-4 inline-block text-sm text-zinc-500 hover:underline">
          ← 게임 목록
        </Link>
      </main>
    );
  }

  const targets: PlayTarget[] = game.targets.map((t) => ({
    name: t.name,
    archetype: t.archetype ?? "",
    portraitUrl: t.portraitUrl ?? "",
    ...(t.faces ? { faces: t.faces } : {}),
    cutsceneCount: t.cutscenes.length,
  }));

  const email = (await getSessionEmail()) ?? undefined;
  // 개발자 비용 푸터는 관리자에게만 — 테스터에겐 안 보이게.
  const isAdmin = email === ADMIN_EMAIL;

  // 이어할 세션(관계) — 진행 중인 플레이가 있으면 이어받는다.
  const resumes: ResumeData[] = (await getResumablePlays(game.id, email)).map((p) => ({
    name: p.targetName,
    playId: p.id,
    like: p.like,
    dislike: p.dislike,
    sulking: p.sulking,
    turns: p.turns.map((t) => ({ role: t.role, text: t.text, sulking: t.sulking })),
  }));

  return (
    <main className="px-4 py-6 md:max-w-4xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold tracking-tight">{game.title}</h1>
        <Link href="/sim" className="text-sm text-zinc-500 hover:underline">
          ← 목록
        </Link>
      </div>
      <PlayClient gameId={game.id} targets={targets} resumes={resumes} isAdmin={isAdmin} />
    </main>
  );
}
