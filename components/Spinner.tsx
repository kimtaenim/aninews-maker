// 진행 중 스피너 — 회전하는 링. border-current 라 버튼 글자색을 따라간다
// (민트 버튼=흰색, 아웃라인 버튼=민트). Tailwind 기본 animate-spin 사용.
export default function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="진행 중"
      className={`inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
