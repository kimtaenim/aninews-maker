import Link from "next/link";
import { getSimTheater } from "@/lib/simTheaterStore";
import { getSessionEmail, ADMIN_EMAIL } from "@/lib/auth";
import TheaterClient from "./TheaterClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TheaterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const theater = await getSimTheater(id);

  if (!theater) {
    return (
      <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
        <p className="text-sm text-red-500">극장을 찾을 수 없어요.</p>
        <Link href="/sim" className="mt-4 inline-block text-sm text-zinc-500 hover:underline">
          ← 목록
        </Link>
      </main>
    );
  }

  const email = (await getSessionEmail()) ?? undefined;
  const isAdmin = email === ADMIN_EMAIL;

  return (
    <main className="px-4 py-6 md:max-w-4xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold tracking-tight">{theater.title}</h1>
        <Link href="/sim" className="text-sm text-zinc-500 hover:underline">
          ← 목록
        </Link>
      </div>
      <TheaterClient
        theaterId={theater.id}
        title={theater.title}
        situation={theater.situation}
        cast={theater.cast.map((c) => ({
          name: c.name,
          archetype: c.archetype ?? "",
          portraitUrl: c.portraitUrl ?? "",
          faces: c.faces,
        }))}
        initialTurns={theater.turns.map((t) => ({
          speaker: t.speaker,
          text: t.text,
          situation: t.situation,
        }))}
        initialFeelings={theater.feelings}
        initialNextSpeaker={theater.cast[theater.nextSpeakerIdx % theater.cast.length]?.name ?? ""}
        isAdmin={isAdmin}
      />
    </main>
  );
}
