export type SpecialistPreviewFormat = "pdf" | "html";
export type SpecialistPreviewLoader = (signal: AbortSignal) => Promise<{ bytes: Uint8Array; contentType: string | null }>;
export interface SpecialistPreviewSession { close(): void; ready: Promise<string> }

export async function readSpecialistPreview(format: SpecialistPreviewFormat, load: SpecialistPreviewLoader, signal: AbortSignal, current: () => boolean) {
  if (signal.aborted || !current()) throw new Error("Specialist preview scope changed");
  const { bytes, contentType } = await load(signal);
  if (signal.aborted || !current()) throw new Error("Specialist preview scope changed");
  const mediaType = (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase();
  const expected = format === "pdf" ? "application/pdf" : "text/html";
  if (mediaType !== expected || !bytes.length || (format === "pdf" && ![37, 80, 68, 70, 45].every((byte, index) => bytes[index] === byte))) {
    throw new Error("Specialist preview format mismatch");
  }
  return bytes;
}
