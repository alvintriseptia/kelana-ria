import "./photo-capture.css";

export const MAX_RAW_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_EDGE_PX = 1280;

export type PreparedPhoto = {
  dataUrl: string;
  base64: string;
  byteLength: number;
  width: number;
  height: number;
  compressed: boolean;
};

export type PhotoDraftState = {
  processing: boolean;
  prepared: PreparedPhoto | null;
  promise?: Promise<PreparedPhoto>;
  seq: number;
};

export function formatPhotoSizeKb(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

type DecodedSource = {
  width: number;
  height: number;
  drawTo: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  cleanup: () => void;
};

async function decodeImageFile(file: File): Promise<DecodedSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          width: bitmap.width,
          height: bitmap.height,
          drawTo: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
          cleanup: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // Fall through to HTMLImageElement decode fallback.
    }
  }

  return new Promise<DecodedSource>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w <= 0 || h <= 0) {
        URL.revokeObjectURL(url);
        reject({ code: "invalid-photo" });
        return;
      }
      resolve({
        width: w,
        height: h,
        drawTo: (ctx, targetW, targetH) => ctx.drawImage(img, 0, 0, targetW, targetH),
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject({ code: "invalid-photo" });
    };
    img.src = url;
  });
}

function encodeCanvasJpeg(
  source: DecodedSource,
  maxEdge: number,
  qualities: number[],
): PreparedPhoto | null {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw { code: "photo-unreadable" };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  source.drawTo(ctx, width, height);

  let last: PreparedPhoto | null = null;
  for (const quality of qualities) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) continue;
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const byteLength = base64ByteLength(base64);
    last = { dataUrl, base64, byteLength, width, height, compressed: true };
    if (byteLength <= MAX_UPLOAD_PHOTO_BYTES - 32_768) {
      return last;
    }
  }
  return last;
}

export async function preparePhotoFile(file: File): Promise<PreparedPhoto> {
  if (!file) throw { code: "photo-required" };
  if (file.size === 0) throw { code: "invalid-photo" };
  if (file.size > MAX_RAW_PHOTO_BYTES) throw { code: "photo-too-large" };
  if (file.type && !file.type.startsWith("image/")) {
    throw { code: "invalid-photo" };
  }

  let source: DecodedSource;
  try {
    source = await decodeImageFile(file);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) throw err;
    throw { code: "invalid-photo" };
  }

  try {
    let encoded = encodeCanvasJpeg(source, MAX_PHOTO_EDGE_PX, [0.82, 0.72, 0.62, 0.5, 0.38]);
    if (!encoded || encoded.byteLength > MAX_UPLOAD_PHOTO_BYTES) {
      encoded = encodeCanvasJpeg(source, 960, [0.6, 0.45, 0.32]);
    }
    if (!encoded || !encoded.base64) {
      throw { code: "photo-unreadable" };
    }
    if (encoded.byteLength > MAX_UPLOAD_PHOTO_BYTES) {
      throw { code: "photo-too-large" };
    }
    return encoded;
  } finally {
    source.cleanup();
  }
}
