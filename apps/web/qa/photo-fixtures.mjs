import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Generates a valid uncompressed RGBA PNG > 2 MB (default 1600x640 -> ~4.1 MB)
 * so Playwright QA can verify client-side canvas downscaling (<= 1280px) and
 * JPEG compression below the 2 MB server limit.
 */
export function buildLargeTestPhotoFile(width = 1600, height = 640) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowSize;
    raw[rowOff] = 0;
    for (let x = 0; x < width; x++) {
      const p = rowOff + 1 + x * 4;
      raw[p] = (x * 7 + y * 3) & 0xff;
      raw[p + 1] = (x * 3 + y * 11) & 0xff;
      raw[p + 2] = ((x ^ y) * 5) & 0xff;
      raw[p + 3] = 255;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 0 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const buffer = Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
  return {
    name: "smartphone-raw-4mb.png",
    mimeType: "image/png",
    buffer,
  };
}

export function buildCorruptPhotoFile() {
  return {
    name: "corrupt-upload.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not-a-valid-image-buffer-123456"),
  };
}
