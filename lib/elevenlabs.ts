// ============================================================================
// ElevenLabs TTS 프로바이더 (골격, 선택 단계)
// ----------------------------------------------------------------------------
// 보이스오버 기본 엔진. 단어 단위 타임스탬프를 받아 자막 타이밍 소스로 쓴다.
// (국내 엔진 Supertone/Typecast/클로바는 추후 같은 인터페이스로 옵션 추가.)
// TTS 는 프로젝트 단위로 on/off (Project.ttsEnabled).
// ============================================================================

import { elevenLabsCostUsd, usdToKrw } from "./cost";

const API_BASE = "https://api.elevenlabs.io/v1";

// multilingual 기본 voice. 한국어 품질은 voice 마다 다르니 ELEVENLABS_VOICE_ID 로
// 한국어에 맞는 voice 를 지정하는 걸 권장.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
const DEFAULT_MODEL = "eleven_multilingual_v2"; // 한국어 지원
const TTS_TIMEOUT_MS = 60_000;

export function getElevenLabsKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing in .env.local");
  return key;
}

// 6단계 — 텍스트 → 보이스오버 오디오(mp3 bytes). 동기 호출(짧음).
// 자막 단어 타임스탬프(8단계)는 추후 "with timestamps" 엔드포인트로 별도 처리.
export async function synthesizeSpeech(opts: {
  text: string;
  voiceId?: string;
  model?: string;
  speed?: number; // 1.0 기본. ElevenLabs voice_settings.speed 허용 범위 0.7~1.2.
}): Promise<{
  audioBuffer: ArrayBuffer;
  costUsd: number;
  costKrw: number;
  charsUsed: number;
}> {
  const key = getElevenLabsKey();
  const text = (opts.text ?? "").trim();
  if (!text) throw new Error("TTS 텍스트가 비었어요");

  const voiceId = opts.voiceId || DEFAULT_VOICE_ID;
  const model = opts.model || DEFAULT_MODEL;
  // ElevenLabs 는 speed 0.7~1.2 만 허용 — 범위 밖 값은 클램프.
  const speed = Math.min(1.2, Math.max(0.7, opts.speed ?? 1.0));

  const r = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(
      `ElevenLabs ${r.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  const audioBuffer = await r.arrayBuffer();
  const charsUsed = text.length;
  const costUsd = elevenLabsCostUsd(charsUsed);
  return { audioBuffer, costUsd, costKrw: usdToKrw(costUsd), charsUsed };
}
