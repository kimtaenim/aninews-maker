// ============================================================================
// 관계 기억 온톨로지 — config/sim-memory-ontology.json 단일 원천을 읽어
// 프롬프트 지시·주입 문자열을 만들고, 모델이 낸 memoryAdd 를 적용한다.
// ----------------------------------------------------------------------------
// 요약이 아니라 '타입이 있는 영구 기억'. 잘려나간 옛 대화에서 오래 기억할 것만
// 뽑아 저장 → 매 턴 상대에게 주입 → 옛날 얘기를 기억하는 연인이 된다.
// ============================================================================

import ontology from "@/config/sim-memory-ontology.json";
import type { SimMemory } from "./types";

interface OntoType {
  id: string;
  label: string;
  keyed: boolean;
  guidance: string;
}

const TYPES: OntoType[] = ontology.types as OntoType[];
const TYPE_IDS = new Set(TYPES.map((t) => t.id));
const LABEL = new Map(TYPES.map((t) => [t.id, t.label]));

const MAX_PER_TYPE = 6; // 타입별 상한 — 비용·주입 길이 관리(넘치면 오래된 것부터 밀어냄)

// 프롬프트에 넣을 '기억 온톨로지 설명 + 출력 형식' 지시.
export function memoryInstruction(): string {
  const lines = TYPES.map((t) => `    - ${t.id}(${t.label}): ${t.guidance}`);
  return [
    "[관계 기억] 잘려나간 옛 대화라도 '오래 기억할 것'은 아래 타입으로 뽑아 memoryAdd 로 남긴다.",
    "플레이어가 새로 알려준 사실·취향·아픈 곳·약속·특별한 순간·둘만의 호칭이 나오면 그때만 남기고,",
    "별 거 없으면 memoryAdd=null(대부분의 턴). 갱신은 같은 key 로(덮어씀).",
    ...lines,
    '    형식: "memoryAdd": null 또는 {"type":"위 id 중 하나","text":"기억 내용","key":"갱신키(선택)"}',
  ].join("\n");
}

// 저장된 기억을 타입별로 묶어 '상대가 기억하는 것' 주입 문자열로.
export function formatMemory(memory: SimMemory[]): string {
  if (!memory.length) return "";
  const byType = new Map<string, string[]>();
  for (const m of memory) {
    if (!byType.has(m.type)) byType.set(m.type, []);
    byType.get(m.type)!.push(m.text);
  }
  const lines: string[] = [];
  for (const t of TYPES) {
    const items = byType.get(t.id);
    if (items?.length) lines.push(`· ${t.label}: ${items.join("; ")}`);
  }
  if (!lines.length) return "";
  return `\n\n[상대가 기억하는 것 — 잊지 말 것]\n${lines.join("\n")}`;
}

// 모델이 낸 memoryAdd 를 검증·적용한 새 배열을 돌려준다(원본 불변).
export function applyMemoryAdd(
  memory: SimMemory[],
  add: unknown,
  turn: number
): SimMemory[] {
  if (!add || typeof add !== "object") return memory;
  const o = add as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "";
  const text = typeof o.text === "string" ? o.text.trim() : "";
  const key = typeof o.key === "string" && o.key.trim() ? o.key.trim() : undefined;
  if (!TYPE_IDS.has(type) || !text) return memory;

  const next = [...memory];
  // key 갱신: 같은 type+key 를 덮어쓴다.
  if (key) {
    const idx = next.findIndex((m) => m.type === type && m.key === key);
    if (idx >= 0) {
      next[idx] = { type, text, key, turn };
      return next;
    }
  }
  // 완전 동일 텍스트는 중복 저장 안 함.
  if (next.some((m) => m.type === type && m.text === text)) return next;
  next.push({ type, text, key, turn });

  // 타입별 상한 — 넘치면 그 타입에서 가장 오래된 것 하나 제거.
  const sameType = next.filter((m) => m.type === type);
  if (sameType.length > MAX_PER_TYPE) {
    const oldest = sameType[0];
    const oi = next.indexOf(oldest);
    if (oi >= 0) next.splice(oi, 1);
  }
  return next;
}

export function memoryLabel(typeId: string): string {
  return LABEL.get(typeId) ?? typeId;
}
