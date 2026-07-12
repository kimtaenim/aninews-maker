// ============================================================================
// 감정 연기 프리셋 (ani-cliché) — 씬 대사에 과장된 감정 연기를 입힌다.
// ----------------------------------------------------------------------------
// id 는 Scene.emotion 에 저장, tag 는 ElevenLabs v3 오디오 태그([태그])로 변환돼
// 대사 앞에 붙는다(과장 연기). re-animator EMOTIONS 참고 + 로맨스 클리셰용 확장.
// TTS 는 API(lib/elevenlabs)에서 적용 — 합성 워커와 무관.
// ============================================================================

export const EMOTIONS: { id: string; label: string; tag: string }[] = [
  // 설렘 계열
  { id: "flutter", label: "💓 설렘", tag: "nervously" },
  { id: "throb", label: "😳 심쿵", tag: "breathlessly" },
  { id: "shy", label: "☺️ 부끄럼", tag: "shyly" },
  { id: "aegyo", label: "🥰 애교", tag: "playfully" },
  { id: "whisper", label: "🤫 속삭임", tag: "whispering" },
  { id: "serious", label: "🙂 진지", tag: "seriously" },
  { id: "teary", label: "🥹 울컥", tag: "tearfully" },
  { id: "tease", label: "😏 능글", tag: "teasingly" },
  { id: "excited", label: "🔥 신남", tag: "excited" },
  // 갈등·격정 계열 — 삼각관계·티격태격·이별 씬용
  { id: "angry", label: "😠 화남", tag: "angrily" },
  { id: "shout", label: "📢 고함", tag: "shouting" },
  { id: "annoyed", label: "😤 짜증", tag: "annoyed, snapping" },
  { id: "cold", label: "🥶 차갑게", tag: "coldly" },
  { id: "jealous", label: "😒 질투", tag: "jealously, bitter" },
  // 슬픔 계열
  { id: "sad", label: "😢 슬픔", tag: "sadly" },
  { id: "sob", label: "😭 오열", tag: "sobbing" },
  { id: "desperate", label: "🥺 애원", tag: "desperately pleading" },
  // 리액션 계열
  { id: "panic", label: "😱 당황", tag: "panicked, flustered" },
  { id: "laugh", label: "😂 웃음", tag: "laughing" },
  { id: "sigh", label: "😮‍💨 한숨", tag: "sighing" },
];

// 감정 id → ElevenLabs v3 오디오 태그. 없으면 빈 문자열(태그 없이 일반 합성).
export function emotionTag(id?: string): string {
  return EMOTIONS.find((e) => e.id === id)?.tag ?? "";
}
