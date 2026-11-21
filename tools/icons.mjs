// Draws the extension icon (a crescent moon on a navy tile) as PNGs, with no dependencies.
// Used by build.mjs; writes <outdir>/icons/icon-<size>.png.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const TILE = [0x1c, 0x21, 0x36];
const MOON = [0x9a, 0xaa, 0xff];
export const ICON_SIZES = [16, 32, 48, 128];

/** Coverage of the shapes at a point in unit coordinates. */
function sample(x, y) {
  // Rounded square tile.
  const r = 0.22;
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  const inTile = dx * dx + dy * dy <= r * r;
  // Crescent: a disc minus an offset disc.
  const inA = (x - 0.47) ** 2 + (y - 0.53) ** 2 <= 0.3 ** 2;
  const inB = (x - 0.62) ** 2 + (y - 0.4) ** 2 <= 0.25 ** 2;
  return { inTile, inMoon: inTile && inA && !inB };
}

function render(size) {
  const ss = 4; // 4×4 supersampling for smooth edges
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0, moon = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (s.inTile) tile++;
          if (s.inMoon) moon++;
        }
      }
      const n = ss * ss;
      const alpha = tile / n;
      const m = tile === 0 ? 0 : moon / tile;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(TILE[c] * (1 - m) + MOON[c] * m);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writeIcons(outdir) {
  mkdirSync(`${outdir}/icons`, { recursive: true });
  for (const size of ICON_SIZES) writeFileSync(`${outdir}/icons/icon-${size}.png`, render(size));
}
