export const OPENAI_TRADE_DECISION_DEFAULT_MIN_CONFIDENCE = 0.7;
export const OPENAI_TRADE_DECISION_CHART_WIDTH = 1600;
export const OPENAI_TRADE_DECISION_CHART_HEIGHT = 900;
export const OPENAI_TRADE_DECISION_IMAGE_DETAIL = "high";

export function parseOpenAiTradeDecisionMinConfidence({
  raw,
  name = "OPENAI_TRADE_DECISION_MIN_CONFIDENCE",
}: {
  readonly raw: string;
  readonly name?: string;
}): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1.`);
  }
  return value;
}
