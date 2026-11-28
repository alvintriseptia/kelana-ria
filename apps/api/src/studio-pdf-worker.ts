import { parentPort, workerData } from "node:worker_threads";
import { maxStudioDocumentChars } from "./studio-document-parser.js";

type TextDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: ({ str: string; hasEOL: boolean } | { type: string })[] }>;
    cleanup(): void;
  }>;
  loadingTask: { destroy(): Promise<void> };
};

// Keep the PDF library's browser renderer types out of the Node API project.
const pdfModule = "unpdf";
async function extract(data: Uint8Array) {
  const { getDocumentProxy } = await import(pdfModule) as {
    getDocumentProxy(data: Uint8Array, options: Record<string, boolean | number>): Promise<TextDocument>;
  };
  const pdf = await getDocumentProxy(data, {
    enableXfa: false, disableFontFace: true, useWasm: false, useWorkerFetch: false,
    maxImageSize: 1_000_000, stopAtErrors: true, verbosity: 0,
  });
  try {
    if (pdf.numPages > 80) return null;
    const pages: string[] = [];
    let totalChars = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const { items } = await page.getTextContent();
      let text = "";
      for (const item of items) {
        if (!("str" in item)) continue;
        totalChars += item.str.length + 1;
        if (totalChars > maxStudioDocumentChars) return false;
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      totalChars += 2;
      pages.push(text.trim());
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await pdf.loadingTask.destroy();
  }
}

try {
  parentPort?.postMessage(await extract(workerData as Uint8Array));
} catch {
  parentPort?.postMessage(null);
}
