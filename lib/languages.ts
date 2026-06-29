// ============================================================================
// 다국어(더빙) 언어 레지스트리 — 한 곳에서 언어를 늘린다
// ----------------------------------------------------------------------------
// 한국어(ko)는 원본 트랙이라 여기 없음. 여기 있는 건 "번역 + 더빙" 대상 언어.
// 언어 추가 = 아래 배열에 한 줄. 각 필드:
//   code    앱 내부 코드 / dub 맵 키 ("en")
//   label   UI 표기 ("영어")
//   english 번역 프롬프트용 영어 이름 ("English")
//   iso3    Typecast language 코드 (ISO 639-3, "eng"). ElevenLabs 는 텍스트 자동감지라 불필요.
// ============================================================================

import type { Scene } from "./types";

export interface LangDef {
  code: string;
  label: string;
  english: string;
  iso3: string;
}

export const TARGET_LANGUAGES: LangDef[] = [
  { code: "en", label: "영어", english: "English", iso3: "eng" },
  { code: "es", label: "스페인어", english: "Spanish", iso3: "spa" },
  { code: "ja", label: "일본어", english: "Japanese", iso3: "jpn" },
  { code: "vi", label: "베트남어", english: "Vietnamese", iso3: "vie" },
];

export const TARGET_LANG_CODES = TARGET_LANGUAGES.map((l) => l.code);

export function getLang(code: string): LangDef | undefined {
  return TARGET_LANGUAGES.find((l) => l.code === code);
}

// "ko" 는 원본, 그 외 등록된 코드만 더빙 대상으로 인정.
export function isTargetLang(code: string | undefined): boolean {
  return !!code && TARGET_LANG_CODES.includes(code);
}

// 원본 한국어도 하나의 "언어"로 다룬다 — 다국어판 생성을 어느 언어에서든 대칭으로
// 할 수 있게(예: 영어판 → 한국어판). 빈/미지정 lang 은 한국어 원본으로 본다.
export const KOREAN: LangDef = { code: "ko", label: "한국어", english: "Korean", iso3: "kor" };
export const ALL_LANGUAGES: LangDef[] = [KOREAN, ...TARGET_LANGUAGES];

// ko 포함 해석(번역 라우트·라벨용). 빈 코드 → 한국어.
export function resolveLang(code: string | undefined): LangDef | undefined {
  return ALL_LANGUAGES.find((l) => l.code === (code || "ko"));
}

// 현재 언어를 뺀 나머지 = 만들 수 있는 다른 언어판(한국어 포함). 빈 코드 → 한국어 기준.
export function otherLanguages(currentCode: string | undefined): LangDef[] {
  const cur = currentCode || "ko";
  return ALL_LANGUAGES.filter((l) => l.code !== cur);
}

// ── 씬 더빙 접근 헬퍼 (dub 맵 우선, 레거시 narrationEn/audioUrlEn 폴백) ──────────
// 기존 프로젝트는 영어가 dub 맵이 아니라 평면 필드에 있으니 en 만 폴백해 준다.
export function dubNarration(scene: Scene, code: string): string {
  const v = scene.dub?.[code]?.narration;
  if (v != null) return v;
  return (code === "en" ? scene.narrationEn : "") ?? "";
}

export function dubAudioUrl(scene: Scene, code: string): string | undefined {
  return scene.dub?.[code]?.audioUrl ?? (code === "en" ? scene.audioUrlEn : undefined);
}
