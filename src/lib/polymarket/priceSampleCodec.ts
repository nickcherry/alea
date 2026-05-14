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
 *     u32 offsetMs          ms since window_start_ts_ms
 *     u16 upBps             0..10000, or MISSING (0xFFFF)
 *     u16 downBps           0..10000, or MISSING (0xFFFF)
 *
 * Buffer is host byte order (LE on x86/arm64). A 15m × 1s capture is
 * 8 + 900 × 8 = 7208 bytes.
 */

export const PRICE_SAMPLE_CODEC_VERSION = 1;
export const PRICE_SAMPLE_TICK_BYTES = 8;
export const PRICE_SAMPLE_HEADER_BYTES = 8;
const MISSING_BPS = 0xffff;
const MAX_BPS = 10_000;

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
    buffer.writeUInt32LE(clampOffsetMs(tick.offsetMs), offset);
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
  if (version !== PRICE_SAMPLE_CODEC_VERSION) {
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
    ticks.push({
      offsetMs: buffer.readUInt32LE(cursor),
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
  if (!Number.isFinite(offsetMs) || offsetMs < 0) {
    return 0;
  }
  if (offsetMs > 0xffffffff) {
    return 0xffffffff;
  }
  return Math.floor(offsetMs);
}
