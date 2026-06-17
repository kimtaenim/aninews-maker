// ============================================================================
// ElevenLabs TTS 프로바이더 (골격, 선택 단계)
// ----------------------------------------------------------------------------
// 보이스오버 기본 엔진. 단어 단위 타임스탬프를 받아 자막 타이밍 소스로 쓴다.
// (국내 엔진 Supertone/Typecast/클로바는 추후 같은 인터페이스로 옵션 추가.)
// TTS 는 프로젝트 단위로 on/off (Project.ttsEnabled).
// ============================================================================

import type { TtsWord } from "./types";

const API_BASE = "https://api.elevenlabs.io/v1";

export function getElevenLabsKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing in .env.local");
  return key;
}

export interface TtsResult {
  audio: ArrayBuffer; // mp3/pcm
  words: TtsWord[]; // 자막 타이밍
}

// TODO: synthesize(text, voiceId, opts) → TtsResult
//   ElevenLabs "with timestamps" 엔드포인트 사용 (문자→단어 타임스탬프 집계).
//   오디오 속도 워핑 금지 — 자연 길이를 그대로 쓰고, 영상이 음성에 맞춰 늘어남.
export async function synthesize(): Promise<TtsResult> {
  void API_BASE;
  void getElevenLabsKey;
  throw new Error("not implemented");
}
