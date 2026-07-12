import { NextResponse } from "next/server";
import catalog from "@/config/voices.json";

export const runtime = "nodejs";

// GET — 보이스오버 목소리 목록. 큐레이션 카탈로그(config/voices.json) + 계정 실시간 조회
// (ElevenLabs /v1/voices, Typecast /v2/voices)를 합쳐 준다. 계정 대시보드에서 게임·애니
// 성우 목소리를 추가하면 여기 자동 반영. provider=typecast|elevenlabs.
type Voice = {
  id: string;
  name: string;
  provider: string;
  lang?: string;
  gender?: string;
  note?: string;
  narration?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));

async function fetchEleven(): Promise<Voice[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = Array.isArray(d?.voices) ? d.voices : [];
    return arr
      .map((v) => ({
        id: s(v.voice_id),
        name: s(v.name) || s(v.voice_id),
        provider: "elevenlabs",
        gender: s(v?.labels?.gender),
        note: [s(v?.labels?.descriptive), s(v?.labels?.accent), s(v?.category)]
          .filter(Boolean)
          .join(" · "),
      }))
      .filter((v) => v.id);
  } catch {
    return [];
  }
}

async function fetchTypecast(): Promise<Voice[]> {
  const key = process.env.TYPECAST_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch("https://api.typecast.ai/v2/voices", {
      headers: { "X-API-KEY": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    // 응답 형태가 배열/래핑 어느 쪽이든 대응.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = Array.isArray(d)
      ? d
      : Array.isArray(d?.voices)
        ? d.voices
        : Array.isArray(d?.result)
          ? d.result
          : Array.isArray(d?.data)
            ? d.data
            : [];
    return arr
      .map((v) => ({
        id: s(v.voice_id) || s(v.id),
        name: s(v.voice_name) || s(v.name) || s(v.voice_id) || s(v.id),
        provider: "typecast",
        gender: s(v.gender),
        note: [s(v.age), s(v.style), s(v.emotion), s(v.language)].filter(Boolean).join(" · "),
      }))
      .filter((v) => v.id && v.name);
  } catch {
    return [];
  }
}

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = (catalog as { voices?: any[] }).voices ?? [];
  const catVoices: Voice[] = raw
    .filter((v) => v?.id && !s(v.id).startsWith("REPLACE_ME"))
    .map((v) => ({
      id: s(v.id),
      name: s(v.name) || s(v.id),
      provider: v.provider === "typecast" ? "typecast" : "elevenlabs",
      lang: s(v.lang),
      gender: s(v.gender),
      note: s(v.note),
      narration: v.narration === true,
    }));

  const [el, tc] = await Promise.all([fetchEleven(), fetchTypecast()]);
  // 병합 — 큐레이션 카탈로그(이름·노트) 우선, 계정 목소리는 중복 id 빼고 추가.
  const byId = new Map<string, Voice>();
  for (const v of [...catVoices, ...el, ...tc]) if (v.id && !byId.has(v.id)) byId.set(v.id, v);
  return NextResponse.json({ ok: true, voices: [...byId.values()] });
}
