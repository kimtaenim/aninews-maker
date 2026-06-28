"use client";

import { useLayoutEffect, useRef } from "react";

// 내용 높이에 맞춰 자동으로 늘어나는 textarea — 내부 스크롤 없이 전체가 한 번에 보인다.
// (음성 대본을 잘리지 않게 다 보여 한 번에 읽고 녹음할 수 있게.)
export default function AutoTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  minRows = 2,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
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
      ref={ref}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={minRows}
      className={className}
      style={{ overflow: "hidden", resize: "none" }}
    />
  );
}
