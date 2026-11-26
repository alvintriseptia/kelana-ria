// Compact zero-dependency offline QR Code SVG encoder (ISO/IEC 18004, Byte mode, ECC Level L, Versions 1-9).

type QrVersionSpec = {
  version: number;
  totalData: number;
  ecPerBlock: number;
  blocks: number;
  align: number[];
};

const VERSIONS: QrVersionSpec[] = [
  { version: 1, totalData: 19, ecPerBlock: 7, blocks: 1, align: [] },
  { version: 2, totalData: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
  { version: 3, totalData: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
  { version: 4, totalData: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
  { version: 5, totalData: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
  { version: 6, totalData: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
  { version: 7, totalData: 156, ecPerBlock: 20, blocks: 2, align: [6, 22, 38] },
  { version: 8, totalData: 194, ecPerBlock: 24, blocks: 2, align: [6, 24, 42] },
  { version: 9, totalData: 232, ecPerBlock: 30, blocks: 2, align: [6, 26, 46] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function formatBitsEccL(mask: number): number {
  const data = (0b01 << 3) | (mask & 7); // ECC Level L = 01
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if (rem & (1 << i)) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

function encodeCodewords(payload: Uint8Array, spec: QrVersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(payload.length, 8);
  for (const byte of payload) pushBits(byte, 8);
  const capacityBits = spec.totalData * 8;
  const termLen = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(spec.totalData);
  const byteCount = bits.length / 8;
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    data[i] = b;
  }
  for (let i = byteCount, pad = 0; i < spec.totalData; i++, pad++) {
    data[i] = pad % 2 === 0 ? 0xec : 0x11;
  }

  const blockSize = Math.floor(spec.totalData / spec.blocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let b = 0; b < spec.blocks; b++) {
    const slice = data.subarray(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
  }

  const out = new Uint8Array(spec.totalData + spec.blocks * spec.ecPerBlock);
  let idx = 0;
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < spec.blocks; b++) out[idx++] = dataBlocks[b][i];
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) out[idx++] = ecBlocks[b][i];
  }
  return out;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function penaltyScore(grid: Uint8Array, size: number): number {
  let score = 0;
  const at = (r: number, c: number) => grid[r * size + c];

  // Rule 1: runs of 5+ same-colored modules in rows & columns
  for (let r = 0; r < size; r++) {
    let runR = 1;
    let runC = 1;
    for (let c = 1; c < size; c++) {
      if (at(r, c) === at(r, c - 1)) runR++;
      else {
        if (runR >= 5) score += 3 + (runR - 5);
        runR = 1;
      }
      if (at(c, r) === at(c - 1, r)) runC++;
      else {
        if (runC >= 5) score += 3 + (runC - 5);
        runC = 1;
      }
    }
    if (runR >= 5) score += 3 + (runR - 5);
    if (runC >= 5) score += 3 + (runC - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  // Rule 4: dark module balance
  let dark = 0;
  for (let i = 0; i < grid.length; i++) dark += grid[i];
  const pct = (dark * 100) / grid.length;
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

export function buildQrMatrix(text: string): { size: number; modules: Uint8Array } {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSIONS.find((v) => bytes.length + 2 <= v.totalData) ?? VERSIONS[VERSIONS.length - 1];
  const payload = bytes.length + 2 <= spec.totalData ? bytes : bytes.subarray(0, spec.totalData - 2);
  const size = spec.version * 4 + 17;
  const codewords = encodeCodewords(payload, spec);

  const isFunc = new Uint8Array(size * size);
  const base = new Uint8Array(size * size);
  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    isFunc[r * size + c] = 1;
    base[r * size + c] = dark ? 1 : 0;
  };

  // Finder patterns + separators
  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r, c, inOuter && (onBorder || inCore));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  for (const ar of spec.align) {
    for (const ac of spec.align) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunc(ar + dr, ac + dc, dist === 0 || dist === 2);
        }
      }
    }
  }

  // Reserve format info + dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunc(8, size - 1 - i, false);
    setFunc(size - 1 - i, 8, false);
  }
  setFunc(size - 8, 8, true);

  // Version info (V7+)
  if (spec.version >= 7) {
    const vBits = versionBits(spec.version);
    for (let i = 0; i < 18; i++) {
      const dark = Boolean((vBits >>> i) & 1);
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, dark);
      setFunc(b, a, dark);
    }
  }

  // Zigzag data placement
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let colOff = 0; colOff < 2; colOff++) {
        const c = right - colOff;
        if (isFunc[r * size + c]) continue;
        const dark = bitIdx < totalBits ? Boolean((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) : false;
        base[r * size + c] = dark ? 1 : 0;
        bitIdx++;
      }
    }
  }

  // Pick lowest-penalty mask
  let bestGrid = base;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const grid = new Uint8Array(base);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r * size + c] && maskBit(m, r, c)) {
          grid[r * size + c] ^= 1;
        }
      }
    }
    const fmt = formatBitsEccL(m);
    const putFmt = (r: number, c: number, bit: number) => {
      grid[r * size + c] = (fmt >>> bit) & 1;
    };
    for (let i = 0; i <= 5; i++) putFmt(8, i, 14 - i);
    putFmt(8, 7, 8);
    putFmt(8, 8, 7);
    putFmt(7, 8, 6);
    for (let i = 0; i <= 5; i++) putFmt(5 - i, 8, 5 - i);
    for (let i = 0; i <= 7; i++) putFmt(8, size - 1 - i, i);
    for (let i = 0; i <= 6; i++) putFmt(size - 1 - i, 8, 14 - i);
    grid[(size - 8) * size + 8] = 1;

    const score = penaltyScore(grid, size);
    if (score < bestScore) {
      bestScore = score;
      bestGrid = grid;
    }
  }

  return { size, modules: bestGrid };
}

export function renderQrSvg(text: string, label = "Kode QR undangan ruang"): string {
  const { size, modules } = buildQrMatrix(text);
  const quiet = 4;
  const viewSize = size + quiet * 2;
  const parts: string[] = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!modules[r * size + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < size && modules[r * size + c]) c++;
      const run = c - start;
      parts.push(`M${start + quiet} ${r + quiet}h${run}v1h-${run}z`);
    }
  }
  const safeLabel = label.replace(/["&<>]/g, "");
  return `<svg class="lobby-qr-svg" viewBox="0 0 ${viewSize} ${viewSize}" width="220" height="220" role="img" aria-label="${safeLabel}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff"/><path d="${parts.join("")}" fill="#103a32"/></svg>`;
}
