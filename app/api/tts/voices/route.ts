import { NextResponse } from "next/server";
import catalog from "@/config/voices.json";

export const runtime = "nodejs";

// GET — 보이스오버 목소리 목록. 풀(어떤 목소리를 쓸지)은 config/voices.json 에서 직접 큐레이션.
// 다만 이름/성별은 provider(Typecast/ElevenLabs) 에서 "실제 이름"을 불러와 덮어씌운다
// (카탈로그의 임시 이름 '성우 N' 대신 진짜 이름 표시). 조회 실패 시 카탈로그 이름 그대로.
type CatalogVoice = {
  provider?: string;
  id?: string;
  name?: string;
  lang?: string;
  gender?: string;
  note?: string;
  narration?: boolean;
};
type Meta = { name?: string; gender?: string; note?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));

// ElevenLabs 계정 목소리 — id→이름/성별 맵(카탈로그 이름 보강용) + 카탈로그에 없는
// "내 라이브러리" 목소리 목록(커뮤니티에서 추가한 것 등, premade 제외 — 기본 20여 개
// 프리메이드로 목록이 넘치지 않게). ElevenLabs 웹에서 Voice Library → 추가만 하면
// 앱 목록에 자동으로 뜬다. 실패하면 빈 값.
type ElevenExtra = { id: string; name: string; gender: string; note: string };
async function elevenAccount(): Promise<{ meta: Record<string, Meta>; extras: ElevenExtra[] }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { meta: {}, extras: [] };
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { meta: {}, extras: [] };
    const d = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = Array.isArray(d?.voices) ? d.voices : [];
    const meta: Record<string, Meta> = {};
    const extras: ElevenExtra[] = [];
    for (const v of arr) {
      const id = s(v.voice_id);
      if (!id) continue;
      const labels = v?.labels ?? {};
      meta[id] = { name: s(v.name), gender: s(labels.gender) };
      if (s(v.category) && s(v.category) !== "premade") {
        extras.push({
          id,
          name: s(v.name),
          gender: s(labels.gender),
          note:
            [s(labels.descriptive || labels.description), s(labels.age), s(labels.use_case)]
              .filter(Boolean)
              .join(" · ") || "내 라이브러리",
        });
      }
    }
    return { meta, extras };
  } catch {
    return { meta: {}, extras: [] };
  }
}

async function typecastMeta(): Promise<Record<string, Meta>> {
  const key = process.env.TYPECAST_API_KEY;
  if (!key) return {};
  try {
    const r = await fetch("https://api.typecast.ai/v2/voices", {
      headers: { "X-API-KEY": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return {};
    const d = await r.json();
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
    const out: Record<string, Meta> = {};
    for (const v of arr) {
      const id = s(v.voice_id) || s(v.id);
      if (!id) continue;
      out[id] = {
        name: s(v.voice_name) || s(v.name),
        gender: s(v.gender),
        note: [s(v.age), s(v.style), s(v.emotion)].filter(Boolean).join(" · "),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET() {
  const raw = ((catalog as { voices?: CatalogVoice[] }).voices ?? []) as CatalogVoice[];
  const [{ meta: el, extras }, tc] = await Promise.all([elevenAccount(), typecastMeta()]);

  const voices = raw
    .filter((v) => v && typeof v.id === "string" && v.id && !v.id.startsWith("REPLACE_ME"))
    .map((v) => {
      const provider = v.provider === "typecast" ? "typecast" : "elevenlabs";
      const meta = (provider === "typecast" ? tc : el)[v.id as string] ?? {};
      return {
        id: v.id as string,
        // 실제 이름 우선(성우 N 임시명 대체), 없으면 카탈로그 이름.
        name: meta.name || v.name || (v.id as string),
        provider,
        lang: v.lang || "",
        gender: meta.gender || v.gender || "",
        note: v.note || meta.note || "",
        narration: v.narration === true,
      };
    });

  // ElevenLabs "내 라이브러리" 목소리(커뮤니티 추가분 등) — 카탈로그에 없으면 뒤에 붙인다.
  const known = new Set(voices.map((v) => v.id));
  for (const ev of extras) {
    if (known.has(ev.id)) continue;
    voices.push({
      id: ev.id,
      name: ev.name,
      provider: "elevenlabs",
      lang: "multi",
      gender: ev.gender,
      note: ev.note,
      narration: false,
    });
  }
  return NextResponse.json({ ok: true, voices });
}
