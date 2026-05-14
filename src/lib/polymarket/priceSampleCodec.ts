/**
 * Packed-tick codec for `polymarket_price_samples.samples` bytea.
 *
 * Layout, all little-endian:
 *
 *   header (8 bytes)
 *     u16 version
 *     u16 reserved
 *     u32 tickCount
 *
 *   per-tick (8 bytes × tickCount)
 *     i32 offsetMs          ms since window_start_ts_ms (v2; v1 stored u32)
 *     u16 upBps             0..10000, or MISSING (0xFFFF)
 *     u16 downBps           0..10000, or MISSING (0xFFFF)
 *
 * Versions:
 *   v1 — offsetMs is unsigned (≥ 0). No pre-market samples possible.
 *   v2 — offsetMs is signed (i32). Negative offsets are pre-market ticks
 *        captured before `window_start_ts_ms`.
 *
 * Buffer is host byte order (LE on x86/arm64). A 15m × 1s capture is
 * 8 + 900 × 8 = 7208 bytes; adding 5m of pre-market at 1Hz brings a
 * 15m capture to 8 + 1200 × 8 = 9608 bytes.
 */

export const PRICE_SAMPLE_CODEC_VERSION = 2;
export const PRICE_SAMPLE_TICK_BYTES = 8;
export const PRICE_SAMPLE_HEADER_BYTES = 8;
const MISSING_BPS = 0xffff;
const MAX_BPS = 10_000;
const I32_MIN = -0x80000000;
const I32_MAX = 0x7fffffff;

export type PriceSampleTick = {
  readonly offsetMs: number;
  readonly upBps: number | null;
  readonly downBps: number | null;
};

export function encodePriceSamples(
  ticks: readonly PriceSampleTick[],
): Buffer {
  const buffer = Buffer.alloc(
    PRICE_SAMPLE_HEADER_BYTES + ticks.length * PRICE_SAMPLE_TICK_BYTES,
  );
  buffer.writeUInt16LE(PRICE_SAMPLE_CODEC_VERSION, 0);
  buffer.writeUInt16LE(0, 2);
  buffer.writeUInt32LE(ticks.length, 4);

  let offset = PRICE_SAMPLE_HEADER_BYTES;
  for (const tick of ticks) {
    buffer.writeInt32LE(clampOffsetMs(tick.offsetMs), offset);
    buffer.writeUInt16LE(encodeBps(tick.upBps), offset + 4);
    buffer.writeUInt16LE(encodeBps(tick.downBps), offset + 6);
    offset += PRICE_SAMPLE_TICK_BYTES;
  }
  return buffer;
}

export function decodePriceSamples(
  input: Buffer | Uint8Array,
): readonly PriceSampleTick[] {
  const buffer = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.byteLength < PRICE_SAMPLE_HEADER_BYTES) {
    return [];
  }
  const version = buffer.readUInt16LE(0);
  if (version !== 1 && version !== 2) {
    return [];
  }
  const tickCount = buffer.readUInt32LE(4);
  const expectedBytes =
    PRICE_SAMPLE_HEADER_BYTES + tickCount * PRICE_SAMPLE_TICK_BYTES;
  if (buffer.byteLength < expectedBytes) {
    return [];
  }
  const ticks: PriceSampleTick[] = [];
  for (let i = 0; i < tickCount; i += 1) {
    const cursor = PRICE_SAMPLE_HEADER_BYTES + i * PRICE_SAMPLE_TICK_BYTES;
    const offsetMs =
      version === 2
        ? buffer.readInt32LE(cursor)
        : buffer.readUInt32LE(cursor);
    ticks.push({
      offsetMs,
      upBps: decodeBps(buffer.readUInt16LE(cursor + 4)),
      downBps: decodeBps(buffer.readUInt16LE(cursor + 6)),
    });
  }
  return ticks;
}

function encodeBps(bps: number | null): number {
  if (bps === null) {
    return MISSING_BPS;
  }
  if (!Number.isFinite(bps)) {
    return MISSING_BPS;
  }
  const rounded = Math.round(bps);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > MAX_BPS) {
    return MAX_BPS;
  }
  return rounded;
}

function decodeBps(raw: number): number | null {
  if (raw === MISSING_BPS) {
    return null;
  }
  if (raw > MAX_BPS) {
    return null;
  }
  return raw;
}

function clampOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) {
    return 0;
  }
  if (offsetMs < I32_MIN) {
    return I32_MIN;
  }
  if (offsetMs > I32_MAX) {
    return I32_MAX;
  }
  return Math.floor(offsetMs);
}
