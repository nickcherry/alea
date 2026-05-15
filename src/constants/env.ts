const defaultDatabaseUrl = "postgres://localhost:5432/alea";

/**
 * Canonical environment dependency access for the application. All env-var
 * reads should go through this object so external dependencies stay
 * discoverable in one place.
 */
export const env = {
  get databaseUrl(): string {
    return process.env["DATABASE_URL"] ?? defaultDatabaseUrl;
  },
  get databasePoolMax(): number | undefined {
    const raw = process.env["DATABASE_POOL_MAX"];

    if (raw === undefined || raw.trim() === "") {
      return undefined;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      throw new Error("DATABASE_POOL_MAX must be a positive integer.");
    }

    return value;
  },
  get telegramBotToken(): string | undefined {
    return optionalEnv("TELEGRAM_BOT_TOKEN");
  },
  get telegramChatId(): string | undefined {
    return optionalEnv("TELEGRAM_CHAT_ID");
  },
  get polymarketPrivateKey(): string | undefined {
    return optionalEnv("POLYMARKET_PRIVATE_KEY");
  },
  get polymarketFunderAddress(): string | undefined {
    return optionalEnv("POLYMARKET_FUNDER_ADDRESS");
  },
  get axiomApiKey(): string | undefined {
    return optionalEnv("AXIOM_API_KEY");
  },
  get axiomQueryApiKey(): string | undefined {
    return optionalEnv("AXIOM_QUERY_API_KEY") ?? optionalEnv("AXIOM_API_KEY");
  },
  get axiomDataset(): string {
    return optionalEnv("AXIOM_DATASET") ?? "alea-live";
  },
  get axiomDomain(): string {
    return optionalEnv("AXIOM_DOMAIN") ?? "https://api.axiom.co";
  },
  get chartBrowserPath(): string | undefined {
    return optionalEnv("ALEA_CHART_BROWSER_PATH");
  },
  get playwrightChromiumExecutablePath(): string | undefined {
    return optionalEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
  },
  get openaiApiKey(): string | undefined {
    return optionalEnv("OPENAI_API_KEY");
  },
  get openaiChartModel(): string | undefined {
    return optionalEnv("OPENAI_CHART_MODEL");
  },
};

function optionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
