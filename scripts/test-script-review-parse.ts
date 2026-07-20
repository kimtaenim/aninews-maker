// 대본 검수 응답 파서 단위 테스트 — LLM 무관(결정적).
//   실행: npx tsx scripts/test-script-review-parse.ts
import { parseReview } from "../lib/scriptReview";

let fail = 0;
function check(label: string, cond: boolean) {
  console.log(cond ? "  ✓" : "  ✗", label);
  if (!cond) fail++;
}

// 1) pass=true
const passJson = `여기 결과: {"pass": true, "loop_map": [{"scene":1,"status":"고리 열림","note":"질문 염"}], "violations": [], "diagnosis_summary": "구조 양호", "consent_question": "", "revised_scenes": []}`;
const p1 = parseReview(passJson);
check("pass=true 파싱", !!p1 && p1.pass === true);
check("pass 시 위반 없음", !!p1 && p1.violations.length === 0);

// 2) pass=false (PBR편류 — ① 조기 폐쇄 + 수정안)
const failJson = `{"pass": false,
  "loop_map": [
    {"scene":1,"status":"고리 열림","note":"질문 염"},
    {"scene":2,"status":"고리 조기 폐쇄","note":"바로 답함"},
    {"scene":7,"status":"고리 미결 이월","note":"다음에 할게요"}
  ],
  "violations": ["①의 질문이 ②에서 즉시 닫힘", "⑦이 답을 다음 영상으로 이월"],
  "diagnosis_summary": "①에서 연 질문이 ②에서 바로 닫혀 고리가 없습니다. 유사 구조(PBR편)는 완주율 44.9%였습니다.",
  "consent_question": "①의 질문이 ②에서 바로 닫혀요. 고리 구조로 수정해볼까요?",
  "revised_scenes": [
    {"scene":2,"original":"PBR은 이겁니다","revised":"그런데 여기엔 함정이 있어요","changed":true,"reason":"질문 유지 위해 즉답 제거"},
    {"scene":1,"original":"원문1","revised":"원문1","changed":false,"reason":""}
  ]}`;
const p2 = parseReview(failJson);
check("pass=false 파싱", !!p2 && p2.pass === false);
check("위반 배열 존재", !!p2 && p2.violations.length === 2);
check("진단 요약 존재", !!p2 && p2.diagnosisSummary.length > 5);
check("동의 질문 존재", !!p2 && p2.consentQuestion.includes("고리"));
check("수정안 changed 씬 검출", !!p2 && p2.revisedScenes.some((s) => s.changed));
check("loop_map 7씬 상태", !!p2 && p2.loopMap.find((e) => e.scene === 7)?.status === "고리 미결 이월");

// 3) JSON 없음 → null
check("JSON 없으면 null", parseReview("응답 실패했습니다") === null);

if (fail > 0) {
  console.error(`\n❌ ${fail}개 실패`);
  process.exit(1);
}
console.log("\n✅ 전부 통과");
