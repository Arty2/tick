// A QR code generator, small enough to read: byte mode, error correction
// level M, versions 1–10 (up to 213 bytes — a link to this app is about 40).
// It replaces a request to a QR web service, so the codes draw offline and
// the link they hold never leaves the page.
//
// qrMatrix(text) returns rows of booleans (true = dark), or null when the
// text is too long. tests/qr.spec.ts checks it against matrices made once by
// an independent encoder and stored in the test.

// Per version, level M: [error-correction bytes per block, blocks in group 1,
// data bytes in each, blocks in group 2] — group 2's blocks hold one more.
const BLOCKS = [null,
  [10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0],
  [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const dataBytes = v => { const [, g1, d, g2] = BLOCKS[v]; return g1 * d + g2 * (d + 1); };

// ── GF(256) arithmetic and Reed–Solomon ──────────────────────────────
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;

function rsDivisor(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    g = next;
  }
  return g.slice(1); // the leading 1 is implied
}
function rsRemainder(data, divisor) {
  const rem = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    divisor.forEach((c, i) => { rem[i] ^= mul(c, factor); });
  }
  return rem;
}

// ── Text to the final sequence of codewords ──────────────────────────
function codewords(bytes, v) {
  const cap = dataBytes(v), bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);                           // byte mode
  put(bytes.length, v < 10 ? 8 : 16);  // character count
  bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let padByte = 0xec; data.length < cap; padByte ^= 0xec ^ 0x11) data.push(padByte);

  // Split into blocks, give each its error-correction bytes, then interleave.
  const [ecLen, g1, d, g2] = BLOCKS[v], divisor = rsDivisor(ecLen), blocks = [];
  for (let i = 0, at = 0; i < g1 + g2; i++) {
    const block = data.slice(at, at += d + (i < g1 ? 0 : 1));
    blocks.push({ data: block, ec: rsRemainder(block, divisor) });
  }
  const out = [];
  for (let i = 0; i <= d; i++) blocks.forEach(b => { if (i < b.data.length) out.push(b.data[i]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach(b => out.push(b.ec[i]));
  return out;
}

// ── The grid ─────────────────────────────────────────────────────────
// BCH remainders for the format (15,5) and version (18,6) information.
const bch = (val, poly, len) => {
  let r = val << len;
  for (let i = Math.clz32(poly) - Math.clz32(r); i >= 0; i = Math.clz32(poly) - Math.clz32(r)) r ^= poly << i;
  return (val << len) | r;
};

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => ((r >> 1) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

function build(v, words, maskNo) {
  const n = 17 + 4 * v;
  const dark = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixed = Array.from({ length: n }, () => new Array(n).fill(false)); // not data
  const set = (r, c, on) => { if (r >= 0 && r < n && c >= 0 && c < n) { dark[r][c] = !!on; fixed[r][c] = true; } };

  // Finder patterns with their separators, in three corners.
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]])
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(r0 + r, c0 + c, ring !== 2 && ring <= 3);
    }
  // Alignment patterns, except where a finder already sits.
  const al = ALIGN[v];
  for (const r0 of al) for (const c0 of al) {
    if (fixed[r0][c0]) continue;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(r0 + r, c0 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
  }
  // Timing patterns.
  for (let i = 8; i < n - 8; i++) { if (!fixed[6][i]) set(6, i, i % 2 === 0); if (!fixed[i][6]) set(i, 6, i % 2 === 0); }
  // Format information (level M is 00, then the mask), twice; and the dark module.
  const fmt = bch(maskNo, 0x537, 10) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const on = (fmt >> i) & 1;
    if (i < 6) set(i, 8, on); else if (i < 8) set(i + 1, 8, on); else if (i === 8) set(8, 7, on); else set(8, 14 - i, on);
    if (i < 8) set(8, n - 1 - i, on); else set(n - 15 + i, 8, on);
  }
  set(n - 8, 8, true);
  // Version information, from version 7.
  if (v >= 7) {
    const ver = bch(v, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const on = (ver >> i) & 1, a = Math.floor(i / 3), b = n - 11 + i % 3;
      set(a, b, on); set(b, a, on);
    }
  }
  // Data: two columns at a time from the right edge, snaking up and down,
  // skipping the vertical timing column; masked as it is placed.
  const mask = MASKS[maskNo];
  let bit = 0;
  for (let right = n - 1, up = true; right >= 1; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [right, right - 1]) {
        if (fixed[r][c]) continue;
        const on = bit < words.length * 8 && (words[bit >> 3] >> (7 - (bit & 7))) & 1;
        dark[r][c] = !!on !== mask(r, c);
        bit++;
      }
    }
  }
  return dark;
}

// The standard's four penalty rules; the mask with the lowest score reads best.
function penalty(m) {
  const n = m.length;
  let score = 0, darkCount = 0;
  const line = get => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) { run++; continue; }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      // 1:1:3:1:1 with four light modules on either side.
      for (let b = 0; b + 10 < n; b++) {
        const s = k => get(a, b + k);
        if (s(0) && !s(1) && s(2) && s(3) && s(4) && !s(5) && s(6) && !s(7) && !s(8) && !s(9) && !s(10)) score += 40;
        if (!s(0) && !s(1) && !s(2) && !s(3) && s(4) && !s(5) && s(6) && s(7) && s(8) && !s(9) && s(10)) score += 40;
      }
    }
  };
  line((a, b) => m[a][b]); line((a, b) => m[b][a]);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (m[r][c]) darkCount++;
    if (r + 1 < n && c + 1 < n && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  }
  return score + Math.floor(Math.abs(darkCount * 20 - n * n * 10) / (n * n)) * 10;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  // Mode and count take 12 bits (20 from version 10).
  while (v <= 10 && bytes.length * 8 + (v < 10 ? 12 : 20) > dataBytes(v) * 8) v++;
  if (v > 10) return null;
  const words = codewords(bytes, v);
  let best = null, bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    const m = build(v, words, k), s = penalty(m);
    if (s < bestScore) { best = m; bestScore = s; }
  }
  return best;
}

// Drawn as one SVG path on white, with the four-module quiet zone a scanner
// needs. Built with DOM calls, never from a string of markup.
export function qrSvg(text) {
  const m = qrMatrix(text);
  if (!m) return null;
  const NS = 'http://www.w3.org/2000/svg', quiet = 4, size = m.length + quiet * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(NS, 'path');
  let d = '';
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + quiet} ${r + quiet}h1v1h-1z`; }));
  path.setAttribute('d', d); path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}
