import Link from "next/link";
import ClicheNewForm from "./ClicheNewForm";

// ani-cliché — 연애 클리셰 미니 영상 새로 만들기. 트로프만 고르면 나머지는 스튜디오에서.
export default function ClicheNewPage() {
  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">💘 연애 클리셰 — 새로 만들기</h1>
        {/* 시뮬 제조기 진입 — 클리셰의 하위 기능. 이미 만든 인물로 대화형 게임을 만든다. */}
        <Link
          href="/sim"
          className="shrink-0 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
        >
          🎮 시뮬 제조기
        </Link>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        벽치기·심쿵 같은 클리셰를 골라 두 주인공의 미니 러브스토리를 뽑습니다. 그림체·목소리·
        영상은 스튜디오에서 이어서 다듬어요.
      </p>
      <ClicheNewForm />
    </main>
  );
}
