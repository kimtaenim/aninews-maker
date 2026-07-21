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
  // ── 갈등·방해자 클리셰(#3 방해자/리스크, #5 다양화) ──
  {
    id: "rival-appears",
    label: "연적 등장",
    direction:
      "나에게 대놓고 들이대는 매력적인 연적(라이벌)이 끼어들었다. 그 앞에서 플레이어를 두고 신경전을 벌여라. 플레이어가 누구 편인지, 질투하는지 떠보고 시험하라.",
  },
  {
    id: "rival-provoke",
    label: "라이벌의 도발",
    direction:
      "라이벌이 '너 따위가 무슨' 식으로 나를(또는 플레이어와의 사이를) 깔봤다. 자존심이 상해 발끈한 상태다. 플레이어가 내 편에서 어떻게 받아치는지 본다.",
  },
  {
    id: "near-fall",
    label: "넘어질 뻔",
    direction:
      "플레이어(또는 내)가 넘어질 뻔한 걸 확 잡아 거리가 확 좁혀졌다. 코앞에서 눈이 마주친 그 순간의 두근거림을 성격대로 수습하거나 밀당하라.",
  },
  {
    id: "drunk-truth",
    label: "취중진담",
    direction:
      "술기운이 살짝 올라 평소 못 하던 속말이 툭 나올 것 같다. 취한 척 진심을 흘리되, 다음날 기억 못 하는 척할 여지를 남겨라.",
  },
  {
    id: "walk-home-rain",
    label: "비 오는 밤 데려다주기",
    direction:
      "늦은 밤 비가 와서 데려다주는(혹은 받는) 상황. 우산 속 좁은 거리, 헤어지기 아쉬운 골목 앞의 미묘한 공기를 만들어라.",
  },
  {
    id: "confession-pressure",
    label: "고백 직전 압박",
    direction:
      "분위기가 무르익어 뭔가 말하려다 만다. '할 말 있는데…' 하고 뜸을 들이며 플레이어의 반응을 떠보라. 아직 확신은 없다.",
  },
  {
    id: "wound-reveal",
    label: "과거 상처",
    direction:
      "지난 연애나 옛 상처가 문득 떠올라 방어적이 됐다. 왜 쉽게 마음 못 여는지 조금씩 흘리되, 플레이어가 함부로 파고들면 벽을 세워라.",
  },
  {
    id: "jealousy-test",
    label: "질투 유발",
    direction:
      "일부러 다른 이성 얘기를 꺼내 플레이어가 질투하는지 슬쩍 본다. 반응이 시원찮으면 실망을, 질투하면 은근히 좋아하는 티를 성격대로 내라.",
  },
  {
    id: "meddling-friend",
    label: "훼방꾼 친구",
    direction:
      "눈치 없는 친구(또는 후배)가 끼어들어 둘만의 분위기를 깬다. 짜증나지만 티는 못 내고, 어떻게든 다시 둘의 흐름으로 돌리려 애써라.",
  },
  {
    id: "cold-shoulder",
    label: "갑작스런 냉담",
    direction:
      "이유 모를 이유로 갑자기 거리를 둔다(사실은 마음이 커져 겁이 난 것). 플레이어가 그 벽을 눈치채고 다가오는지, 이유를 알아채는지 시험하라.",
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
