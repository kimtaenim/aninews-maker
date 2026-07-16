// ============================================================================
// 시뮬 상황 이벤트 풀 — 랜덤은 코드가, 연기는 Claude 가.
// ----------------------------------------------------------------------------
// LLM 에게 "가끔 사건을 일으켜라" 라고 맡기면 패턴이 뻔해지거나 아예 안 일으킨다.
// 그래서 발동 시점(매 4~7 어시스턴트 턴 사이)과 어떤 상황인지는 서버가 주사위를
// 굴려 정하고, Claude 는 디렉터 지시를 받아 자연스럽게 연기만 한다.
// 상황 턴은 채점 무대 — 플레이어 반응에 따라 델타 폭을 ±10 까지 허용한다.
// ============================================================================

export interface SimSituation {
  id: string;
  label: string; // 제조기·로그 표시용 짧은 이름
  direction: string; // Claude 에게 주는 연출 지시(1인칭 "나" = 상대 캐릭터)
}

export const SIM_SITUATIONS: SimSituation[] = [
  {
    id: "team-project",
    label: "팀 과제",
    direction:
      "플레이어와 같은 조가 됐다. 역할 분담 얘기를 꺼내되, 은근히 같이 하고 싶은 티를 성격대로 내라.",
  },
  {
    id: "misunderstanding",
    label: "오해",
    direction:
      "플레이어가 다른 이성과 다정하게 있는 걸 봤다. 서운함을 성격대로 표현하라(츤데레면 괜히 쏘아붙이고, 순정파면 애써 아무렇지 않은 척).",
  },
  {
    id: "rain",
    label: "소나기",
    direction: "갑자기 비가 쏟아지는데 우산이 하나뿐이다. 같이 쓸지 말지 애매한 상황을 만들어라.",
  },
  {
    id: "sick",
    label: "몸살",
    direction: "감기 기운이 있는데 티 내지 않으려 한다. 목소리나 말끝에서만 살짝 드러나게.",
  },
  {
    id: "festival",
    label: "축제",
    direction: "다음 주 축제에 같이 갈 사람이 없다는 얘기를 지나가듯 흘려라. 대놓고 청하지는 말 것.",
  },
  {
    id: "exam-period",
    label: "시험기간",
    direction: "시험 준비로 예민해진 상태다. 스트레스를 성격대로 드러내며 플레이어의 반응을 시험하라.",
  },
  {
    id: "old-friend",
    label: "옛 친구 등장",
    direction:
      "나에게 호감을 보이는 옛 친구가 나타났다는 얘기를 꺼내라. 플레이어가 질투하는지 슬쩍 떠보라.",
  },
  {
    id: "accidental-touch",
    label: "우연한 스킨십",
    direction:
      "좁은 곳에서 스치거나 물건을 동시에 잡는 등 우연한 접촉이 일어났다. 어색해진 공기를 성격대로 수습하라.",
  },
  {
    id: "lost-item",
    label: "잃어버린 물건",
    direction: "아끼는 물건을 잃어버려 시무룩하다. 뭘 잃어버렸는지, 왜 소중한지 조금씩 흘려라.",
  },
  {
    id: "late-night-call",
    label: "늦은 밤 연락",
    direction: "잠이 안 와서 괜히 연락했다. 진짜 용건은 없고, 끊기 아쉬운 기색을 성격대로 내라.",
  },
];

// 발동 간격 — 어시스턴트 턴 기준 매 4~7턴 사이 랜덤.
export const SITUATION_GAP_MIN = 4;
export const SITUATION_GAP_MAX = 7;

// 다음 상황 발동 턴 번호 — 현재 어시스턴트 턴 수에 4~7 을 더한다.
export function rollNextSituationTurn(currentAssistantTurns: number): number {
  const gap =
    SITUATION_GAP_MIN +
    Math.floor(Math.random() * (SITUATION_GAP_MAX - SITUATION_GAP_MIN + 1));
  return currentAssistantTurns + gap;
}

// 안 쓴 상황 중 하나를 랜덤으로 — 다 썼으면 null(더 이상 발동 안 함).
export function pickSituation(usedIds: string[]): SimSituation | null {
  const remaining = SIM_SITUATIONS.filter((s) => !usedIds.includes(s.id));
  if (remaining.length === 0) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}
