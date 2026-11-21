import { crc32 } from "node:zlib";
import sharp from "sharp";

const maxPhotoBytes = 2 * 1024 * 1024;
export const maxBase64Length = Math.ceil(maxPhotoBytes / 3) * 4;
const maxPhotoPixels = 16_000_000;
const maxPhotoDimension = 960;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isStillPng(input: Buffer): boolean {
  // The PNG decoder can silently use only the first frame of an APNG.
  let offset = pngSignature.length;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString("latin1", offset + 4, offset + 8);
    const checksumOffset = offset + length + 8;
    if (checksumOffset + 4 > input.length || type === "acTL" || type === "fcTL" || type === "fdAT") return false;
    if (crc32(input.subarray(offset + 4, checksumOffset)) !== input.readUInt32BE(checksumOffset)) return false;
    offset = checksumOffset + 4;
    if (type === "IEND") return length === 0 && offset === input.length;
  }
  return false;
}

function photoFormat(input: Buffer): "jpeg" | "png" | "webp" | undefined {
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff
    && input[input.length - 2] === 0xff && input[input.length - 1] === 0xd9) return "jpeg";
  if (input.subarray(0, pngSignature.length).equals(pngSignature) && isStillPng(input)) return "png";
  if (input.toString("latin1", 0, 4) === "RIFF" && input.toString("latin1", 8, 12) === "WEBP"
    && input.readUInt32LE(4) === input.length - 8) return "webp";
  return undefined;
}

export async function sanitizeSeekPhoto(encoded: string): Promise<Buffer> {
  if (!encoded.length || encoded.length > maxBase64Length || encoded.length % 4 !== 0) {
    throw new Error("Invalid clue photo");
  }
  const padding = encoded.endsWith("==") ? 2 : Number(encoded.endsWith("="));
  if (encoded.length / 4 * 3 - padding > maxPhotoBytes) throw new Error("Invalid clue photo");

  const input = Buffer.from(encoded, "base64");
  if (input.toString("base64") !== encoded) throw new Error("Invalid clue photo");
  const format = photoFormat(input);
  if (!format) throw new Error("Invalid clue photo");

  try {
    const image = sharp(input, { failOn: "warning", limitInputPixels: maxPhotoPixels });
    const metadata = await image.metadata();
    if (metadata.format === format && (metadata.pages ?? 1) === 1 && metadata.loop === undefined) {
      // Sharp strips source metadata when writing a new image by default.
      return await image.autoOrient()
        .resize(maxPhotoDimension, maxPhotoDimension, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82 })
        .toBuffer();
    }
  } catch {
    // Give callers the same error for decoder failures and rejected inputs.
  }
  throw new Error("Invalid clue photo");
}
