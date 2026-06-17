// 7. compose (ffmpeg) — 클립 이어붙이기 + 보이스오버 + BGM. (골격)
// 핵심 규칙(브리프):
//   - 음성을 5초에 칼같이 맞추지 말 것. 클립이 음성 길이에 느슨하게 따라가게
//     (끝프레임 홀드·연장). 오디오 속도 워핑 금지.
//   - 스톱모션 프로필이면 post_fx.frameSteppingFps(8~12)로 프레임 스테핑.
export async function runCompose(/* job: Job */): Promise<string> {
  throw new Error("not implemented");
}
