import { notFound } from "next/navigation";
import { getProject } from "@/lib/projectStore";
import Studio from "./Studio";

// 단계별 스튜디오 — 현재는 1·2단계(소스 검수 + 스크립트 생성)까지 동작.
export default async function ProjectStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  return <Studio project={project} />;
}
