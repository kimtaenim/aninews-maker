import { NextResponse } from "next/server";
import catalog from "@/config/voices.json";

export const runtime = "nodejs";

// GET — 보이스오버 목소리 카탈로그(config/voices.json) 서빙. voice id 는 사장님이 직접 넣는다.
// 6단계에서 프로젝트 엔진(typecast/eleven)에 맞는 목록을 골라 사용.
type CatalogVoice = {
  provider?: string;
  id?: string;
  name?: string;
  lang?: string;
  gender?: string;
  note?: string;
  narration?: boolean;
};

export async function GET() {
  const raw = ((catalog as { voices?: CatalogVoice[] }).voices ?? []) as CatalogVoice[];
  const voices = raw
    .filter((v) => v && typeof v.id === "string" && v.id && !v.id.startsWith("REPLACE_ME"))
    .map((v) => ({
      id: v.id as string,
      name: v.name || (v.id as string),
      provider: v.provider === "typecast" ? "typecast" : "elevenlabs",
      lang: v.lang || "",
      gender: v.gender || "",
      note: v.note || "",
      narration: v.narration === true,
    }));
  return NextResponse.json({ ok: true, voices });
}
