// ============================================================================
// 자막 강조 마크업 — 나레이션 안에서 [[강조할 말]] 로 감싸면 그 조각만 크게·강조색.
// ----------------------------------------------------------------------------
// narration 은 자막 소스이자 TTS·번역 소스이기도 하다. 그래서 음성/번역/길이계산
// 경로에서는 stripMarks() 로 마커를 떼고, 렌더(자막)에서만 splitRuns() 로 해석한다.
// 워커(.mjs)에도 동일 로직을 worker/emphasis.mjs 로 복제한다 — 둘을 같이 수정할 것.
// ============================================================================

export const EMPH_OPEN = "[[";
export const EMPH_CLOSE = "]]";

// 마커 제거(음성·번역·길이계산용). 짝이 안 맞아도 남은 마커까지 모두 제거한다.
export function stripMarks(s: string): string {
  return (s ?? "").split(EMPH_OPEN).join("").split(EMPH_CLOSE).join("");
}

export function hasMarks(s: string): boolean {
  return typeof s === "string" && (s.includes(EMPH_OPEN) || s.includes(EMPH_CLOSE));
}

export interface Run {
  t: string;
  em: boolean;
}

// 한 캡션 문자열 → 런(run) 배열. [[..]] 안은 em:true.
// 캡션 분할로 마커 한쪽만 남는 경우도 관대하게 처리한다:
//  - 여는 마커만 있으면(닫힘 유실): 그 뒤부터 끝까지 강조.
//  - 닫는 마커가 여는 마커보다 먼저 나오면(열림 유실): 처음부터 그 지점까지 강조.
export function splitRuns(s: string): Run[] {
  let text = s ?? "";
  if (!text) return [];
  // 닫는 마커가 여는 마커보다 앞서면 앞에 가상 여는 마커를 붙여 "처음부터 강조"로.
  const fo = text.indexOf(EMPH_OPEN);
  const fc = text.indexOf(EMPH_CLOSE);
  if (fc >= 0 && (fo < 0 || fc < fo)) text = EMPH_OPEN + text;

  const runs: Run[] = [];
  let buf = "";
  let em = false;
  let i = 0;
  const flush = () => {
    if (buf) runs.push({ t: buf, em });
    buf = "";
  };
  while (i < text.length) {
    if (!em && text.startsWith(EMPH_OPEN, i)) {
      flush();
      em = true;
      i += 2;
      continue;
    }
    if (em && text.startsWith(EMPH_CLOSE, i)) {
      flush();
      em = false;
      i += 2;
      continue;
    }
    // 짝이 안 맞는 반대 마커는 표시하지 않고 건너뛴다.
    if (!em && text.startsWith(EMPH_CLOSE, i)) {
      i += 2;
      continue;
    }
    if (em && text.startsWith(EMPH_OPEN, i)) {
      i += 2;
      continue;
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return runs;
}
