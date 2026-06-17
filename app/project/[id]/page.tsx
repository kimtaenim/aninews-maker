import { notFound } from "next/navigation";
import { getProject } from "@/lib/projectStore";
import { listStyleProfiles } from "@/lib/styleProfiles";
import Studio from "./Studio";

// 단계별 스튜디오. 스타일 프로필(2D/3D 모드·모션·postFx)을 같이 넘겨 키프레임
// 단계에서 표시·미세조정에 쓴다.
export default async function ProjectStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const styleProfiles = listStyleProfiles().map((p) => ({ id: p.id, label: p.label }));

  return <Studio project={project} styleProfiles={styleProfiles} />;
}
