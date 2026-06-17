// ============================================================================
// 스타일 프로필 로더 (골격) — cardnews categories.json image_styles 확장
// ----------------------------------------------------------------------------
// 각 프로필이 image_bible + motion_style + post_fx 를 들고 전 단계에 자동 주입.
//   - image_bible → script/keyframe/images 프롬프트에 합쳐짐
//   - motion_style → script(motion 필드) / videos 프롬프트
//   - post_fx → compose(ffmpeg) 단계 (예: 스톱모션 프레임 스테핑 8~12fps)
// ============================================================================

import profilesJson from "../config/style-profiles.json";

export const DEFAULT_STYLE_PROFILE_ID = profilesJson.default;

export interface StyleProfile {
  id: string;
  label: string;
  imageBible: string; // 인물·팔레트·구도 규약
  motionStyle: string; // 모션 프롬프트 톤 (매끄럽게 vs steppy)
  postFx: {
    frameSteppingFps?: number; // 스톱모션 손맛 (8~12). 없으면 매끄러운 모션.
    [k: string]: unknown;
  };
}

export function listStyleProfiles(): StyleProfile[] {
  return profilesJson.profiles as StyleProfile[];
}

export function getStyleProfile(id: string): StyleProfile {
  const p = listStyleProfiles().find((x) => x.id === id);
  if (!p) throw new Error(`style profile not found: ${id}`);
  return p;
}
