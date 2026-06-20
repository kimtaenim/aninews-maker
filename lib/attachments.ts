// 파일 첨부 — 클라이언트·서버 공용 상수/타입 (cardnews lib/attachments.ts 이식).
// 서버 텍스트 추출은 /api/source/from-files 에서 officeparser + imageOcr 로.

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 파일당 10MB
export const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 전체 30MB

const PDF_MIME = "application/pdf";
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const ACCEPT_ATTR = [
  PDF_MIME,
  ...IMAGE_MIMES,
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME,
  ".docx",
  ".xlsx",
  ".pptx",
].join(",");

export type FileKind = "pdf" | "image" | "docx" | "xlsx" | "pptx";

export function classifyFile(file: { name: string; type: string }): FileKind | null {
  const t = file.type;
  if (t === PDF_MIME) return "pdf";
  if (IMAGE_MIMES.includes(t)) return "image";
  if (t === DOCX_MIME) return "docx";
  if (t === XLSX_MIME) return "xlsx";
  if (t === PPTX_MIME) return "pptx";
  // 브라우저가 Office MIME 을 비워 보내는 경우 확장자 폴백.
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "pptx") return "pptx";
  if (ext === "pdf") return "pdf";
  return null;
}

const KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  image: "IMG",
  docx: "DOC",
  xlsx: "XLS",
  pptx: "PPT",
};

export function kindLabel(kind: FileKind): string {
  return KIND_LABEL[kind];
}
