// ============================================================================
// TTS 프로바이더 디스패처 — 보이스오버 엔진을 env 로 전환
// ----------------------------------------------------------------------------
// TTS_PROVIDER = "elevenlabs"(기본) | "typecast".
// 호출부(app/api/audio/scene)는 synthesize() 하나만 쓰고, 어떤 엔진을 썼는지는
// 반환값 vendor/model 로 받아 비용 적재에 그대로 넘긴다.
// ============================================================================

import { synthesizeSpeech } from "./elevenlabs";
import { synthesizeSpeechTypecast } from "./typecast";
import { TARGET_LANG_CODES } from "./languages";

export type TtsProvider = "elevenlabs" | "typecast";

// env 기본값. 프로젝트가 ttsProvider 를 지정하면 그게 우선(resolveTtsProvider).
export function getTtsProvider(): TtsProvider {
  return (process.env.TTS_PROVIDER || "").toLowerCase() === "typecast"
    ? "typecast"
    : "elevenlabs";
}

// 프로젝트 선택 > env 기본값. 프로젝트가 안 골랐으면 env 로 폴백.
export function resolveTtsProvider(choice?: string): TtsProvider {
  return choice === "typecast" || choice === "elevenlabs" ? choice : getTtsProvider();
}

// 클라이언트(6단계 UI)에 내려줄 정보: env 기본값 + 각 엔진 키 설정 여부 +
// 타입캐스트 언어별 voice 설정 현황(다국어판 언어 탭을 이에 연동).
export function ttsProviderInfo(): {
  default: TtsProvider;
  configured: { elevenlabs: boolean; typecast: boolean };
  typecastVoices: { fallback: boolean; perLang: Record<string, boolean> };
} {
  // 언어별 전용 voice(TYPECAST_VOICE_ID_<LANG>) 설정 여부. 공용 voice 가 있으면
  // 전용이 없어도 그걸로 더빙되므로 fallback 으로 따로 표시.
  const perLang: Record<string, boolean> = {};
  for (const code of TARGET_LANG_CODES) {
    perLang[code] = !!process.env[`TYPECAST_VOICE_ID_${code.toUpperCase()}`];
  }
  return {
    default: getTtsProvider(),
    configured: {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      typecast: !!process.env.TYPECAST_API_KEY,
    },
    typecastVoices: { fallback: !!process.env.TYPECAST_VOICE_ID, perLang },
  };
}

export interface TtsResult {
  audioBuffer: ArrayBuffer;
  costUsd: number;
  costKrw: number;
  charsUsed: number;
  vendor: TtsProvider;
  model: string;
}

// lang: "ko"(원본) 또는 다국어 코드(en/es/ja…). ElevenLabs 는 텍스트로 언어를
// 자동 감지하므로 lang 을 쓰지 않고, Typecast 만 언어별 코드·voice 에 반영한다.
// provider: 프로젝트가 고른 엔진(없으면 env 기본값으로 폴백).
export async function synthesize(opts: {
  text: string;
  lang?: string;
  provider?: string;
  voiceId?: string; // 프로젝트가 고른 목소리(config/voices.json). 없으면 엔진별 env 기본 voice.
  speed?: number; // 보이스오버 속도(1.0 기본). 엔진별 voice_settings.speed / output.tempo 로 전달.
}): Promise<TtsResult> {
  if (resolveTtsProvider(opts.provider) === "typecast") {
    const out = await synthesizeSpeechTypecast({
      text: opts.text,
      lang: opts.lang,
      voiceId: opts.voiceId,
      speed: opts.speed,
    });
    return { ...out, vendor: "typecast", model: out.model };
  }
  const out = await synthesizeSpeech({ text: opts.text, voiceId: opts.voiceId, speed: opts.speed });
  return { ...out, vendor: "elevenlabs", model: "eleven_multilingual_v2" };
}
