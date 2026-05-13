import { env } from "@alea/constants/env";
import { CliUsageError } from "@alea/lib/cli/CliUsageError";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import {
  formatAxiomTabularResult,
  quoteAplDataset,
  runAxiomAplQuery,
} from "@alea/lib/telemetry/axiom";
import pc from "picocolors";
import { z } from "zod";

const sinceOption = defineValueOption({
  key: "since",
  long: "--since",
  valueName: "TIME",
  schema: z
    .string()
    .default("now-24h")
    .describe("Axiom startTime, for example now-1h, now-24h, or RFC3339."),
});

const untilOption = defineValueOption({
  key: "until",
  long: "--until",
  valueName: "TIME",
  schema: z
    .string()
    .optional()
    .describe("Axiom endTime, for example now or an RFC3339 timestamp."),
});

const byOption = defineValueOption({
  key: "by",
  long: "--by",
  valueName: "FIELDS",
  schema: z
    .string()
    .default("asset,period")
    .describe("Comma-separated APL group-by fields."),
});

export const telemetryQueryCommand = defineCommand({
  name: "telemetry:query",
  summary: "Run a raw Axiom APL telemetry query",
  description:
    "Runs an APL query against Axiom and prints the first tabular result. Reads AXIOM_QUERY_API_KEY or AXIOM_API_KEY, AXIOM_DATASET, and optional AXIOM_DOMAIN.",
  options: [
    defineValueOption({
      key: "apl",
      long: "--apl",
      valueName: "APL",
      schema: z.string().min(1).describe("Raw APL query to run."),
    }),
    sinceOption,
    untilOption,
  ],
  examples: [
    "bun alea telemetry:query --apl \"['alea-live'] | limit 10\"",
    "bun alea telemetry:query --since now-1h --apl \"['alea-live'] | where event == 'order_result'\"",
  ],
  output: "Prints a compact terminal table.",
  sideEffects: "Reads Axiom over HTTPS. Does not mutate local or remote data.",
  async run({ io, options }) {
    await printAxiomQuery({
      io,
      apl: options.apl,
      since: options.since,
      until: options.until,
    });
  },
});

export const telemetryRejectsCommand = defineCommand({
  name: "telemetry:rejects",
  summary: "Summarize rejected live order posts",
  description:
    "Queries live trading order_result telemetry for rejected posts, grouped by the requested fields.",
  options: [sinceOption, untilOption, byOption],
  examples: [
    "bun alea telemetry:rejects",
    "bun alea telemetry:rejects --since now-6h --by asset,period,failureKind",
  ],
  output: "Prints rejected order counts.",
  sideEffects: "Reads Axiom over HTTPS. Does not mutate local or remote data.",
  async run({ io, options }) {
    const dataset = quoteAplDataset(env.axiomDataset);
    const by = groupBy(options.by);
    await printAxiomQuery({
      io,
      since: options.since,
      until: options.until,
      apl: `${dataset}
| where event == "order_result" and orderStatus == "rejected"
| summarize rejects=count()${by}`,
    });
  },
});

export const telemetryBookDepthCommand = defineCommand({
  name: "telemetry:book-depth",
  summary: "Summarize live order-book conditions at post attempts",
  description:
    "Queries live trading order_attempt telemetry for spread, quote age, and depth around our posted limit.",
  options: [
    defineValueOption({
      key: "since",
      long: "--since",
      valueName: "TIME",
      schema: z.string().default("now-6h"),
    }),
    untilOption,
    byOption,
  ],
  examples: [
    "bun alea telemetry:book-depth",
    "bun alea telemetry:book-depth --since now-1h --by asset,period,prediction",
  ],
  output: "Prints spread, depth, and book-age aggregates.",
  sideEffects: "Reads Axiom over HTTPS. Does not mutate local or remote data.",
  async run({ io, options }) {
    const dataset = quoteAplDataset(env.axiomDataset);
    const by = groupBy(options.by);
    await printAxiomQuery({
      io,
      since: options.since,
      until: options.until,
      apl: `${dataset}
| where event == "order_attempt"
| summarize attempts=count(), avgSpreadCents=avg(predictedSpreadCents), p50BidDepthUsd=percentile(predictedBidDepthAtOrAboveLimitUsd, 50), p90AskDepth1cUsd=percentile(predictedAskDepthWithin1cUsd, 90), avgBookAgeMs=avg(predictedBookAgeMs)${by}`,
    });
  },
});

export const telemetryOrdersCommand = defineCommand({
  name: "telemetry:orders",
  summary: "Summarize live order outcomes",
  description:
    "Queries live trading order_result telemetry grouped by order status.",
  options: [sinceOption, untilOption, byOption],
  examples: [
    "bun alea telemetry:orders",
    "bun alea telemetry:orders --since now-1h --by asset,period,orderStatus",
  ],
  output: "Prints order result counts by status.",
  sideEffects: "Reads Axiom over HTTPS. Does not mutate local or remote data.",
  async run({ io, options }) {
    const dataset = quoteAplDataset(env.axiomDataset);
    const by = groupBy(
      options.by.includes("orderStatus")
        ? options.by
        : `${options.by},orderStatus`,
    );
    await printAxiomQuery({
      io,
      since: options.since,
      until: options.until,
      apl: `${dataset}
| where event == "order_result"
| summarize orders=count()${by}`,
    });
  },
});

async function printAxiomQuery({
  io,
  apl,
  since,
  until,
}: {
  readonly io: { readonly writeStdout: (text: string) => void };
  readonly apl: string;
  readonly since?: string;
  readonly until?: string;
}): Promise<void> {
  if (env.axiomQueryApiKey === undefined) {
    throw new CliUsageError(
      "AXIOM_QUERY_API_KEY or AXIOM_API_KEY is not set in the environment.",
    );
  }
  io.writeStdout(`${pc.dim("APL:")}\n${apl}\n\n`);
  const result = await runAxiomAplQuery({
    apiKey: env.axiomQueryApiKey,
    domain: env.axiomDomain,
    apl,
    startTime: since,
    endTime: until,
  });
  io.writeStdout(formatAxiomTabularResult(result));
  const rowsMatched = result.status?.rowsMatched;
  const rowsExamined = result.status?.rowsExamined;
  if (rowsMatched !== undefined || rowsExamined !== undefined) {
    io.writeStdout(
      `\n${pc.dim(`rows matched=${rowsMatched ?? "-"} examined=${rowsExamined ?? "-"}`)}\n`,
    );
  }
}

function groupBy(raw: string): string {
  const fields = raw
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
  return fields.length === 0 ? "" : ` by ${fields.join(", ")}`;
}
