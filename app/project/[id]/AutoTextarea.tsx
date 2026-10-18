"use client";

import { useLayoutEffect, useRef } from "react";

// 내용 높이에 맞춰 자동으로 늘어나는 textarea — 내부 스크롤 없이 전체가 한 번에 보인다.
// (음성 대본·나레이션을 잘리지 않게 다 보여, 스크롤 없이 한 번에 읽고 고칠 수 있게.)
// inputRef: 바깥에서 실제 DOM 노드가 필요할 때(예: 강조 selection 조작). 내부 리사이즈 ref 와 겸용.
export default function AutoTextarea({
  value,
  onChange,
  onBlur,
  onKeyDown,
  onSelect,
  placeholder,
  className,
  minRows = 2,
  maxRows,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  // 선택 영역이 바뀔 때마다 알림 — 강조 버튼이 "마지막 선택"을 기억해 두기 위한 것.
  // 모바일은 버튼을 누르는 순간 선택이 풀려서 클릭 시점의 선택만 믿으면 안 된다.
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  maxRows?: number; // 상한(줄) — 넘으면 그 이상은 내부 스크롤. 짧은 대사용 편집기가 화면을 다 먹지 않게.
  autoFocus?: boolean;
  inputRef?: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // 값(또는 외부 동기화)이 바뀔 때마다 높이를 내용에 맞춘다. maxRows 가 있으면 그 높이에서 멈추고
  // 넘치는 만큼만 내부 스크롤을 켠다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    let h = el.scrollHeight;
    if (maxRows) {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const extra =
        parseFloat(cs.paddingTop) +
        parseFloat(cs.paddingBottom) +
        parseFloat(cs.borderTopWidth) +
        parseFloat(cs.borderBottomWidth);
      const max = lh * maxRows + extra;
      el.style.overflowY = h > max ? "auto" : "hidden";
      if (h > max) h = max;
    }
    el.style.height = `${h}px`;
  }, [value, maxRows]);

  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        inputRef?.(el);
      }}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onSelect={onSelect}
      placeholder={placeholder}
      rows={minRows}
      autoFocus={autoFocus}
      className={className}
      style={{ overflow: "hidden", resize: "none" }}
    />
  );
}
