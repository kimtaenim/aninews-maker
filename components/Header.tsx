import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-white/80 dark:bg-black/60 border-b border-zinc-200/60 dark:border-zinc-800/60">
      <div className="px-4 h-12 flex items-center justify-between md:max-w-2xl md:mx-auto">
        <Link href="/" className="font-semibold tracking-tight text-sm">
          AI인 뉴스영상
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/new"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            새 영상
          </Link>
          <Link
            href="/library"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            라이브러리
          </Link>
        </nav>
      </div>
    </header>
  );
}
