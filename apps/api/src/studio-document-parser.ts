import { Worker } from "node:worker_threads";

export const maxStudioDocumentBytes = 2 * 1024 * 1024;
export const maxStudioDocumentChars = 50_000;
const maxBase64Length = 4 * Math.ceil(maxStudioDocumentBytes / 3);
export const maxStudioKnowledgeBody = maxBase64Length + 4096;
const pdfTimeoutMs = 3000;
let activePdfParsers = 0;

export type StudioDocumentError =
  | "invalid-document" | "document-too-large" | "unsupported-file-type"
  | "pdf-no-extractable-text" | "pdf-unreadable" | "pdf-parser-busy";

type ParsedDocument =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413 | 422 | 429; error: StudioDocumentError; message?: string };

const acceptedTypes: Record<string, readonly string[]> = {
  txt: ["text/plain"], md: ["text/markdown", "text/x-markdown", "text/plain"], pdf: ["application/pdf"],
};

function checkText(text: string): ParsedDocument {
  if (text.length > maxStudioDocumentChars) return { ok: false, status: 413, error: "document-too-large" };
  return text.trim()
    ? { ok: true, text }
    : { ok: false, status: 400, error: "invalid-document" };
}

async function readPdf(data: Uint8Array): Promise<ParsedDocument> {
  if (activePdfParsers >= 2) return { ok: false, status: 429, error: "pdf-parser-busy" };
  activePdfParsers++;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(new URL("./studio-pdf-worker.js", import.meta.url), {
      workerData: data, transferList: [data.buffer as ArrayBuffer],
      env: {}, execArgv: [], stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 12, stackSizeMb: 2 },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const task = worker;
    const text = await new Promise<string | false>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("PDF processing limit")), pdfTimeoutMs);
      task.once("message", (value: unknown) => {
        if (typeof value === "string" || value === false) resolve(value);
        else reject(new Error("PDF processing failed"));
      });
      task.once("error", reject);
      task.once("exit", () => reject(new Error("PDF worker exited")));
    });
    if (text === false) return { ok: false, status: 413, error: "document-too-large" };
    if (!text.trim()) {
      return {
        ok: false, status: 422, error: "pdf-no-extractable-text",
        message: "Teks PDF tidak terbaca otomatis. Salin-tempel teks panduan langsung ke kolom chat.",
      };
    }
    return checkText(text);
  } catch {
    return {
      ok: false, status: 422, error: "pdf-unreadable",
      message: "PDF tidak dapat diproses. Coba dokumen lebih pendek atau salin-tempel teksnya.",
    };
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate();
    activePdfParsers--;
  }
}

export async function parseStudioDocument(input: Record<string, unknown>): Promise<ParsedDocument> {
  if (input.text !== undefined) {
    if (typeof input.text !== "string" || input.fileBase64 !== undefined ||
        input.fileName !== undefined || input.mimeType !== undefined) {
      return { ok: false, status: 400, error: "invalid-document" };
    }
    return checkText(input.text);
  }
  const { fileBase64, fileName, mimeType } = input;
  if (typeof fileName !== "string" || fileName.length > 255 || typeof mimeType !== "string" ||
      typeof fileBase64 !== "string" || !fileBase64.length) {
    return { ok: false, status: 400, error: "invalid-document" };
  }
  const extension = /\.([a-z]+)$/i.exec(fileName)?.[1].toLowerCase() ?? "";
  const allowed = Object.hasOwn(acceptedTypes, extension) ? acceptedTypes[extension] : undefined;
  const mime = mimeType.trim().toLowerCase().split(";")[0].trim();
  if (!allowed || (mime && mime !== "application/octet-stream" && !allowed.includes(mime))) {
    return { ok: false, status: 400, error: "unsupported-file-type" };
  }
  if (fileBase64.length > maxBase64Length) return { ok: false, status: 413, error: "document-too-large" };
  if (fileBase64.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(fileBase64)) {
    return { ok: false, status: 400, error: "invalid-document" };
  }
  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length > maxStudioDocumentBytes) return { ok: false, status: 413, error: "document-too-large" };
  if (extension === "pdf") {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return { ok: false, status: 422, error: "pdf-unreadable" };
    return readPdf(Uint8Array.from(buffer));
  }
  try {
    return checkText(new TextDecoder("utf8", { fatal: true }).decode(buffer));
  } catch {
    return { ok: false, status: 400, error: "invalid-document" };
  }
}
