// ============================================================================
// 칩셋 — 사용자가 직접 등록해 두고 다음 영상에서도 계속 불러 쓰는 프롬프트 조각.
// ----------------------------------------------------------------------------
// 코드에 박힌 기본 칩(IMG_CHIP_GROUPS·CAMERA_MOVES)은 그대로 두고, 그 옆에 사용자
// 칩을 붙인다. 팔레트 색 지정·거대 금화 같은 소품·주인공 특징 등이 여기 들어간다.
//
// 저장은 **계정 단위 전역**(프로젝트에 안 묶임) — 그래야 다음 프로젝트에서 다시 부른다.
// 단계별로 따로 관리한다(3=키프레임/4=이미지/5=영상). 씬 단위로는 저장하지 않는다 —
// 씬마다 칩을 만들면 목록이 금세 관리 불가능해진다(사용자 지적).
//   chipsets:<ownerEmail> → Chipset[]
// ============================================================================

import { getRedis } from "./redis";

export const CHIPSET_STAGES = ["keyframe", "images", "videos"] as const;
export type ChipsetStage = (typeof CHIPSET_STAGES)[number];

export const CHIPSET_STAGE_LABEL: Record<ChipsetStage, string> = {
  keyframe: "3단계 키프레임",
  images: "4단계 이미지",
  videos: "5단계 영상",
};

export interface Chipset {
  id: string;
  stage: ChipsetStage;
  label: string; // 버튼에 보이는 짧은 이름 ("황금 팔레트")
  text: string; // 프롬프트에 실제로 붙는 조각
  createdAt: number;
  usedAt?: number; // 마지막으로 쓴 시각 — 최근 쓴 것부터 보여주려고
}

const KEY = (email: string) => `chipsets:${email.toLowerCase()}`;
const MAX_PER_USER = 200; // 폭주 방지(사실상 안 닿는 값)
export const CHIPSET_LABEL_MAX = 20;
export const CHIPSET_TEXT_MAX = 600;

function isStage(v: unknown): v is ChipsetStage {
  return CHIPSET_STAGES.includes(v as ChipsetStage);
}

export async function listChipsets(email: string): Promise<Chipset[]> {
  try {
    const rows = (await getRedis().get<Chipset[]>(KEY(email))) ?? [];
    if (!Array.isArray(rows)) return [];
    // 최근 쓴 것 → 최근 만든 것 순. 자주 쓰는 칩이 앞에 오게.
    return rows
      .filter((c) => c && typeof c.id === "string" && isStage(c.stage))
      .sort((a, b) => (b.usedAt ?? b.createdAt) - (a.usedAt ?? a.createdAt));
  } catch {
    return [];
  }
}

// 등록 — 같은 단계에 같은 이름이 있으면 덮어쓴다(중복 칩이 쌓이는 것 방지).
export async function addChipset(
  email: string,
  input: { stage: ChipsetStage; label: string; text: string }
): Promise<{ ok: true; chipset: Chipset } | { ok: false; error: string }> {
  const label = input.label.trim().slice(0, CHIPSET_LABEL_MAX);
  const text = input.text.trim().slice(0, CHIPSET_TEXT_MAX);
  if (!label) return { ok: false, error: "칩 이름을 입력해주세요" };
  if (!text) return { ok: false, error: "칩 내용을 입력해주세요" };
  if (!isStage(input.stage)) return { ok: false, error: "단계가 잘못됐어요" };

  const rows = (await listChipsets(email)).slice(0, MAX_PER_USER);
  const now = Date.now();
  const dupIdx = rows.findIndex((c) => c.stage === input.stage && c.label === label);
  const chipset: Chipset = {
    id: dupIdx >= 0 ? rows[dupIdx].id : `chip_${now.toString(36)}_${Math.floor(now % 9973)}`,
    stage: input.stage,
    label,
    text,
    createdAt: dupIdx >= 0 ? rows[dupIdx].createdAt : now,
  };
  const next = dupIdx >= 0 ? rows.map((c, i) => (i === dupIdx ? chipset : c)) : [chipset, ...rows];
  await getRedis().set(KEY(email), next);
  return { ok: true, chipset };
}

// 수정 — 이름·내용을 바꾼다. 이름을 바꾸면 addChipset 의 "같은 이름 덮어쓰기"로는
// 잡히지 않으므로 id 로 직접 고치는 경로가 따로 필요하다.
export async function updateChipset(
  email: string,
  id: string,
  patch: { label?: string; text?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await listChipsets(email);
  const idx = rows.findIndex((c) => c.id === id);
  if (idx < 0) return { ok: false, error: "칩을 찾을 수 없어요" };

  const label = (patch.label ?? rows[idx].label).trim().slice(0, CHIPSET_LABEL_MAX);
  const text = (patch.text ?? rows[idx].text).trim().slice(0, CHIPSET_TEXT_MAX);
  if (!label) return { ok: false, error: "칩 이름을 입력해주세요" };
  if (!text) return { ok: false, error: "칩 내용을 입력해주세요" };
  // 같은 단계에 같은 이름이 이미 있으면(자기 자신 제외) 막는다 — 어느 칩인지 헷갈린다.
  if (rows.some((c, i) => i !== idx && c.stage === rows[idx].stage && c.label === label)) {
    return { ok: false, error: `이 단계에 "${label}" 칩이 이미 있어요` };
  }

  rows[idx] = { ...rows[idx], label, text };
  await getRedis().set(KEY(email), rows);
  return { ok: true };
}

export async function deleteChipset(email: string, id: string): Promise<void> {
  const rows = await listChipsets(email);
  await getRedis().set(
    KEY(email),
    rows.filter((c) => c.id !== id)
  );
}

// 쓴 시각 갱신 — 정렬(최근 쓴 것 먼저)에만 쓴다. 실패해도 무시.
export async function touchChipsets(email: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const rows = await listChipsets(email);
    const set = new Set(ids);
    const now = Date.now();
    await getRedis().set(
      KEY(email),
      rows.map((c) => (set.has(c.id) ? { ...c, usedAt: now } : c))
    );
  } catch {
    /* 무시 */
  }
}
