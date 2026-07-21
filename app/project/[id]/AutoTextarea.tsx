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
  placeholder,
  className,
  minRows = 2,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  autoFocus?: boolean;
  inputRef?: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // 값(또는 외부 동기화)이 바뀔 때마다 높이를 내용에 맞춘다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

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
      placeholder={placeholder}
      rows={minRows}
      autoFocus={autoFocus}
      className={className}
      style={{ overflow: "hidden", resize: "none" }}
    />
  );
}
