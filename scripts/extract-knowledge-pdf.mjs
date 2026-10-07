import { open, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { extractKnowledgePdf, KNOWLEDGE_PDF_MAX_BYTES } from "../server/knowledge-pdf.ts";

const usage = "Usage: node scripts/extract-knowledge-pdf.mjs <trusted-local-official.pdf> --output <result.json> [--start-page <n>] [--page-limit <1-8>] [--expected-hash <sha256>]";
let input;
try {
  const args = process.argv.slice(2);
  const source = args.shift();
  if (!source || source.startsWith("--") || /^[a-z][a-z0-9+.-]*:\/\//i.test(source)
    || source.startsWith("\\\\") || source.startsWith("//")) throw new Error("Invalid local PDF path");
  const allowed = new Set(["--output", "--start-page", "--page-limit", "--expected-hash"]);
  const flags = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[++index];
    if (!allowed.has(flag) || flags.has(flag) || !value || value.startsWith("--")) throw new Error("Invalid option");
    flags.set(flag, value);
  }
  const output = flags.get("--output");
  if (!output || /^[a-z][a-z0-9+.-]*:\/\//i.test(output) || output.startsWith("\\\\")
    || output.startsWith("//")) throw new Error("Local output path required");
  const sourcePath = isAbsolute(source) ? source : resolve(source);
  const outputPath = isAbsolute(output) ? output : resolve(output);
  if (sourcePath.toLowerCase() === outputPath.toLowerCase()) throw new Error("Output must differ from input");
  const integer = (flag) => {
    const value = flags.get(flag);
    if (value === undefined) return undefined;
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error("Invalid page range");
    return Number(value);
  };
  input = await open(sourcePath, "r");
  const stat = await input.stat();
  if (!stat.isFile() || stat.size <= 0 || stat.size > KNOWLEDGE_PDF_MAX_BYTES) throw new Error("Invalid PDF size");
  // Read at most one byte beyond the limit even if the file grows after stat.
  const bytes = new Uint8Array(KNOWLEDGE_PDF_MAX_BYTES + 1);
  let size = 0;
  while (size < bytes.length) {
    const { bytesRead } = await input.read(bytes, size, bytes.length - size, size);
    if (bytesRead === 0) break;
    size += bytesRead;
  }
  const result = await extractKnowledgePdf(bytes.subarray(0, size), {
    startPage: integer("--start-page"),
    pageLimit: integer("--page-limit"),
    expectedHash: flags.get("--expected-hash"),
  });
  // Exclusive output prevents accidental replacement of an existing extraction.
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ fileHash: result.fileHash, totalPages: result.totalPages,
    startPage: result.startPage, extractedPages: result.pages.length, nextPage: result.nextPage, complete: result.complete,
    extractionQuality: result.extractionQuality }));
} catch {
  console.error("knowledge_pdf_extraction_failed");
  console.error(usage);
  process.exitCode = 1;
} finally {
  await input?.close();
}
