import type { SyllabusDocumentInput } from "../state/types";

export const MAX_SYLLABUS_FILES = 6;
export const MAX_SYLLABUS_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];

export function isSupportedSyllabusFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (
    mime === "application/pdf" ||
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/webp"
  ) {
    return true;
  }
  const name = (file.name || "").toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export async function readSyllabusDocuments(
  fileList: FileList | File[],
): Promise<SyllabusDocumentInput[]> {
  const files = Array.from(fileList);
  if (files.length === 0) return [];
  if (files.length > MAX_SYLLABUS_FILES) {
    throw new Error(
      `Select up to ${MAX_SYLLABUS_FILES} syllabus files at once (got ${files.length}).`,
    );
  }
  const docs: SyllabusDocumentInput[] = [];
  for (const file of files) {
    if (!isSupportedSyllabusFile(file)) {
      throw new Error(`${file.name || "File"} is not a PDF, PNG, JPEG, or WebP document.`);
    }
    if (file.size > MAX_SYLLABUS_FILE_BYTES) {
      throw new Error(`${file.name || "File"} exceeds the 10 MB per-file size limit.`);
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () =>
        reject(new Error(`${file.name || "File"} could not be read from disk.`));
      reader.readAsDataURL(file);
    });
    docs.push({
      name: file.name || `Syllabus ${docs.length + 1}`,
      dataUrl,
      mime: file.type || null,
    });
  }
  return docs;
}
