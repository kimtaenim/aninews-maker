// ============================================================================
// 시뮬 상황 이벤트 풀 — 랜덤은 코드가, 연기는 Claude 가.
// ----------------------------------------------------------------------------
// LLM 에게 "가끔 사건을 일으켜라" 라고 맡기면 패턴이 뻔해지거나 아예 안 일으킨다.
// 그래서 발동 시점(매 4~7 어시스턴트 턴 사이)과 어떤 상황인지는 서버가 주사위를
// 굴려 정하고, Claude 는 디렉터 지시를 받아 자연스럽게 연기만 한다.
// 상황 턴은 채점 무대 — 플레이어 반응에 따라 델타 폭을 ±10 까지 허용한다.
//
// 내용은 '로맨스 상황설계' 문서의 드라마 클리셰 20종을 반영한다. tag 는 시나리오
// Step4(감정 트리거) 선택과 매칭돼, 사용자가 고른 트리거 계열 상황이 우선 발동한다.
// ============================================================================

// 감정 트리거 태그 — 시나리오 Step4 선택지와 매칭.
export type SituationTag =
  | "jealousy" // 질투 유발
  | "misunderstanding" // 오해와 갈등
  | "rescue" // 위기에서 구해주기
  | "triangle" // 삼각관계 긴장
  | "skinship" // 설레는 밀착
  | "reunion" // 재회·아련함
  | "sacrifice" // 희생·미련
  | "memory"; // 기억·취중

export interface SimSituation {
  id: string;
  label: string; // 제조기·로그 표시용 짧은 이름
  tag: SituationTag; // 감정 트리거 계열
  direction: string; // Claude 에게 주는 연출 지시(1인칭 "나" = 상대 캐릭터)
}

export const SIM_SITUATIONS: SimSituation[] = [
  {
    id: "denial-of-love",
    label: "입덕 부정기",
    tag: "misunderstanding",
    direction:
      "네게 끌리는 걸 자존심 때문에 강하게 부정한다. '내가 왜 하필 너 같은 애한테' 하고 괴로워하면서도 눈을 못 뗀다. 티 내지 않으려다 도리어 들킨다.",
  },
  {
    id: "return-of-ex",
    label: "옛 연인의 귀환",
    tag: "triangle",
    direction:
      "과거 오해로 떠났던 옛 연인이 돌아왔다는 얘기를 흘린다. 흔들리는 티를 내며 플레이어가 질투하거나 붙잡는지 떠본다.",
  },
  {
    id: "family-opposition",
    label: "가족의 반대",
    tag: "misunderstanding",
    direction:
      "우리 사이를 두고 신분 차이·집안의 반대가 있다는 걸 무겁게 꺼낸다. 지켜줄지 포기할지 시험하듯, 일부러 차갑게 밀어내며 반응을 본다.",
  },
  {
    id: "proximity-line",
    label: "초밀착 심쿵 멘트",
    tag: "skinship",
    direction:
      "좁은 곳에서 얼굴이 바짝 닿을 만큼 다가가, 능청스럽게 직진 멘트를 툭 던져 설레게 한다('넌 언제부터 그렇게 예뻤냐?' 류). 그러고는 아무렇지 않은 척한다.",
  },
  {
    id: "enemies-to-lovers",
    label: "티격태격 싸움",
    tag: "misunderstanding",
    direction:
      "사사건건 부딪혀 으르렁댄다. 티격태격 싸우다가도 미운 정이 묻어나게, 지는 척은 안 하면서 은근히 신경 쓰는 티를 낸다.",
  },
  {
    id: "public-rescue",
    label: "돌발 고백·구출",
    tag: "rescue",
    direction:
      "플레이어가 곤란한 자리(맞선·전 연인 앞 등)에 처하자 불쑥 나타나 손목을 낚아채 '내 사람'이라 선언하며 데리고 나간다.",
  },
  {
    id: "amnesia-pull",
    label: "본능적 이끌림",
    tag: "memory",
    direction:
      "머리로는 기억 못 하는 척하지만 몸과 본능이 먼저 반응한다. '낯익은데 왜 이러지' 하며 저도 모르게 끌리는 티를 낸다.",
  },
  {
    id: "younger-devotion",
    label: "연하의 직진",
    tag: "skinship",
    direction:
      "연하 특유의 저돌적 직진으로 거리를 확 좁혀온다. '네가 모르는 나, 하나 더 있는데' 식으로 자신을 남자(여자)로 각인시킨다.",
  },
  {
    id: "waiting-in-rain",
    label: "빗속에서 기다림",
    tag: "sacrifice",
    direction:
      "말없이 빗속에서 젖은 채 기다렸다. 왜 왔냐 물으면 별거 아닌 척하지만, 목소리와 말끝에 서운함·애틋함이 배어난다.",
  },
  {
    id: "blind-sacrifice",
    label: "맹목적 희생",
    tag: "sacrifice",
    direction:
      "지키기 위해 일부러 나쁜 사람이 되어 밀어낸다. 진심을 숨기고 차갑게 굴며 떠나려 하되, 정곡을 찔리면 흔들린다.",
  },
  {
    id: "lingering-breakup",
    label: "이별 후 미련",
    tag: "sacrifice",
    direction:
      "헤어졌지만 친구인 척, 남은 미련이 자꾸 새어 나온다. 아무렇지 않은 척 툭툭대다 결국 옛정을 들킨다.",
  },
  {
    id: "jealousy-trigger",
    label: "질투 유발",
    tag: "jealousy",
    direction:
      "다른 이성 얘기를 슬쩍 흘려 플레이어가 질투하는지 본다. 반응이 시원찮으면 실망을, 질투하면 은근히 좋아하는 티를 낸다.",
  },
  {
    id: "nostalgic-reunion",
    label: "추억의 재회",
    tag: "reunion",
    direction:
      "추억이 깃든 장소에서 우연히 마주쳤다. 첫 마음이 아련하게 되살아나, 아무렇지 않은 척하지만 눈빛이 흔들린다.",
  },
  {
    id: "office-elevator",
    label: "사내연애·엘리베이터",
    tag: "skinship",
    direction:
      "밖에선 남처럼 굴다가 단둘이 엘리베이터·창고에 갇힌 순간 확 달라진다. 들킬까 조마조마한 밀착의 긴장을 만든다.",
  },
  {
    id: "misunderstood-antagonist",
    label: "오해받는 다정",
    tag: "misunderstanding",
    direction:
      "겉으론 못되게 굴어 오해받지만, 사실은 지키려고 그런 거다. 진심은 숨긴 채 퉁명스럽게 챙기고, 티 내면 발뺌한다.",
  },
  {
    id: "cohabitation",
    label: "동거의 일상 설렘",
    tag: "skinship",
    direction:
      "한 집에서 마주치는 사소한 일상(부엌·욕실 앞)에서 자꾸 부딪힌다. 아무것도 아닌 순간이 이상하게 설레게 흐르도록 만든다.",
  },
  {
    id: "fake-dating",
    label: "가짜 연애의 진짜 질투",
    tag: "jealousy",
    direction:
      "연인인 척하다가 주변이 진짜처럼 엮어주자, 튀어나온 진짜 감정에 스스로 당황한다. 아닌 척하지만 자꾸 신경 쓴다.",
  },
  {
    id: "drunk-confession",
    label: "취중 고백",
    tag: "memory",
    direction:
      "술기운에 평소 못 하던 속말·고백이 툭 나온다. 취한 척 진심을 흘리되, 다음날 기억 못 하는 척할 여지를 남긴다.",
  },
  {
    id: "rescuer-in-crisis",
    label: "위기의 구원자",
    tag: "rescue",
    direction:
      "넘어질 뻔하거나 위협받는 순간 몸을 던져 구해낸다. 놀란 채 코앞에서 눈이 마주친 그 두근거림을 성격대로 수습한다.",
  },
  {
    id: "confession-pressure",
    label: "고백 직전 뜸들이기",
    tag: "reunion",
    direction:
      "분위기가 무르익어 뭔가 말하려다 만다. '할 말 있는데…' 뜸을 들이며 플레이어의 반응을 떠본다. 아직 확신은 없다.",
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

// 안 쓴 상황 중 하나를 랜덤으로 — 다 썼으면 null. preferTags 가 있으면 그 계열을 우선.
export function pickSituation(
  usedIds: string[],
  preferTags?: SituationTag[]
): SimSituation | null {
  let remaining = SIM_SITUATIONS.filter((s) => !usedIds.includes(s.id));
  if (remaining.length === 0) return null;
  if (preferTags && preferTags.length) {
    const tagged = remaining.filter((s) => preferTags.includes(s.tag));
    if (tagged.length) remaining = tagged; // 고른 트리거 계열이 남아있으면 거기서만
  }
  return remaining[Math.floor(Math.random() * remaining.length)];
}
