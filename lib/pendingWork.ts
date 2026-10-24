// ============================================================================
// 끊긴 작업 찾기 — 탭을 벗어나 브라우저 루프가 죽은 뒤 빠진 씬.
// ----------------------------------------------------------------------------
// 영상 제출 루프와 음성 생성 루프는 브라우저 안에서 돈다. 화면을 떠나면 루프가 죽고
// 남은 씬이 빠진 채로 남는다. 서버(Project.scenes)가 진실이므로 거기서 빠진 것을 센다.
//
// ★ 생성은 돈이 나가는 일이다. 두 가지를 반드시 지킨다.
//   1) 이미 제출된 영상(videoJobId)은 세지 않는다 — 폴링이 이어받는다. 다시 제출하면
//      같은 씬에 두 번 과금된다.
//   2) 시작한 적 없는 공정은 세지 않는다 — 손도 안 댄 단계에 배너가 뜨면 안 된다.
// ============================================================================

import type { Scene } from "./types";

type S = Pick<
  Scene,
  "videoUrl" | "videoJobId" | "videoSource" | "audioUrl" | "skipped" | "mood"
>;

// 영상이 빠진 씬. 한 씬이라도 결과·제출이 있어야(= 시작했어야) 센다.
export function pendingVideoScenes(scenes: S[]): number[] {
  const started = scenes.some((s) => s.videoUrl || s.videoJobId);
  if (!started) return [];
  return scenes
    .map((_, i) => i)
    .filter((i) => {
      const s = scenes[i];
      if (s.skipped) return false;
      if (s.videoSource === "upload") return false; // 직접 올린 영상
      if (s.videoUrl) return false; // 이미 완성
      if (s.videoJobId) return false; // 제출됨 — 폴링이 이어받는다(재제출 금지)
      return true;
    });
}

// 음성이 빠진 씬. ttsEnabled 가 꺼져 있으면 아예 세지 않는다.
export function pendingAudioScenes(scenes: S[], ttsEnabled: boolean): number[] {
  if (!ttsEnabled) return [];
  const started = scenes.some((s) => s.audioUrl);
  if (!started) return [];
  return scenes
    .map((_, i) => i)
    .filter((i) => {
      const s = scenes[i];
      if (s.skipped) return false;
      if (s.mood) return false; // 분위기 씬 — 대사가 없다
      return !s.audioUrl;
    });
}
