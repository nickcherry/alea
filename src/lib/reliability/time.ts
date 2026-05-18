export const RELIABILITY_WINDOW_MS = 60 * 60 * 1000;

export function currentReliabilityWindowStartMs({
  nowMs,
}: {
  readonly nowMs: number;
}): number {
  return Math.floor(nowMs / RELIABILITY_WINDOW_MS) * RELIABILITY_WINDOW_MS;
}

export function nextReliabilityWindowStartMs({
  nowMs,
}: {
  readonly nowMs: number;
}): number {
  const current = currentReliabilityWindowStartMs({ nowMs });
  return nowMs === current ? current : current + RELIABILITY_WINDOW_MS;
}
