import Link from "next/link";
import DeleteButton from "@/app/library/DeleteButton";
import { STEP_ORDER, type Project } from "@/lib/types";
import { getLang } from "@/lib/languages";
import { ADMIN_EMAIL } from "@/lib/auth";

const STEP_LABELS: Record<string, string> = {
  source: "소스",
  script: "스크립트",
  keyframe: "키프레임",
  images: "이미지",
  videos: "영상",
  voiceover: "음성",
  compose: "합성",
  subtitle: "자막",
};

// 가장 멀리 진행된(승인된) 단계 라벨.
export function progressLabel(p: Project): string {
  if (p.finalVideoUrl) return "완성";
  let furthest = "";
  for (const s of STEP_ORDER) {
    if (p.steps[s]?.status === "approved") furthest = s;
  }
  return furthest ? `${STEP_LABELS[furthest]} 승인` : "진행 중";
}

// 프로젝트 카드 한 장(<li>). 라이브러리·롱폼 탭·롱폼 폴더 안에서 공용. 가로면 16:9.
export default function ProjectCard({ p }: { p: Project }) {
  const aspect = p.format === "long" ? "aspect-[16/9]" : "aspect-[9/16]";
  return (
    <li className="relative">
      <DeleteButton projectId={p.id} title={p.title} />
      <Link
        href={`/project/${p.id}`}
        className="block rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:border-accent transition-colors"
      >
        <div className={`${aspect} bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center overflow-hidden`}>
          {p.keyframeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.keyframeUrl} alt={p.title} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] text-zinc-400">미생성</span>
          )}
        </div>
        <div className="p-2">
          <p className="text-xs font-medium line-clamp-2 leading-snug">{p.title}</p>
          <p className="mt-1 text-[10px] font-medium">
            {p.lang && (
              <span className="mr-1 rounded bg-accent/10 px-1 py-0.5 text-accent">
                {getLang(p.lang)?.label ?? p.lang}
              </span>
            )}
            {p.format === "long" && (
              <span className="mr-1 rounded bg-accent/10 px-1 py-0.5 text-accent">가로</span>
            )}
            <span className="text-accent">{progressLabel(p)}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-400 truncate">
            🧑 {p.ownerEmail ?? ADMIN_EMAIL}
          </p>
        </div>
      </Link>
    </li>
  );
}
