/**
 * A large domain list (~1M entries) stored compactly as sorted 64-bit FNV-1a hashes: ~8 bytes
 * per domain instead of a string set. A host matches if it or any parent domain is in the list
 * (old.example.com → example.com). Hash collisions are possible in theory but negligible at this
 * size (~1 in 10^13 per lookup).
 *
 * File format (big-endian, same as the Android app): magic "NBDS", int32 version (1), int32
 * count, then [count] int64 hashes sorted as signed values. Made by tools/build_domain_list.py.
 */
export class DomainHashSet {
  constructor(private readonly sorted: BigInt64Array) {}

  get size(): number {
    return this.sorted.length;
  }

  static parse(buffer: ArrayBuffer): DomainHashSet {
    const view = new DataView(buffer);
    if (buffer.byteLength < 12 || view.getUint32(0) !== MAGIC) throw new Error("Not a domain list file");
    if (view.getInt32(4) !== 1) throw new Error("Unsupported domain list version");
    const count = view.getInt32(8);
    if (buffer.byteLength < 12 + count * 8) throw new Error("Domain list file is truncated");
    const hashes = new BigInt64Array(count);
    for (let i = 0; i < count; i++) hashes[i] = view.getBigInt64(12 + i * 8);
    return new DomainHashSet(hashes);
  }

  containsHostOrParent(host: string): boolean {
    const h = host.trim().toLowerCase().replace(/\.+$/, "");
    if (h === "") return false;
    let start = 0;
    for (;;) {
      const suffix = h.slice(start);
      if (!suffix.includes(".")) return false; // don't match bare TLDs like "com"
      if (this.has(fnv1a64(suffix))) return true;
      const nextDot = h.indexOf(".", start);
      if (nextDot < 0) return false;
      start = nextDot + 1;
    }
  }

  private has(hash: bigint): boolean {
    let lo = 0;
    let hi = this.sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = this.sorted[mid]!;
      if (v === hash) return true;
      if (v < hash) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }
}

const MAGIC = 0x4e424453; // "NBDS"
const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;

/** FNV-1a, 64-bit, over the UTF-8 bytes, as a signed value. Must match tools/build_domain_list.py. */
export function fnv1a64(s: string): bigint {
  let h = OFFSET;
  for (const b of new TextEncoder().encode(s)) {
    h = BigInt.asUintN(64, (h ^ BigInt(b)) * PRIME);
  }
  return BigInt.asIntN(64, h);
}

/** Builds a list file from domains (for tests). */
export function encodeDomainList(domains: readonly string[]): ArrayBuffer {
  const hashes = [...new Set(domains.map(fnv1a64))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const buffer = new ArrayBuffer(12 + hashes.length * 8);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC);
  view.setInt32(4, 1);
  view.setInt32(8, hashes.length);
  hashes.forEach((h, i) => view.setBigInt64(12 + i * 8, h));
  return buffer;
}
