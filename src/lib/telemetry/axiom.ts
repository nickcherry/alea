import { createWriteStream, mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { resolve as resolvePath } from "node:path";

export type TelemetryEvent = Record<string, unknown>;

export type AxiomTelemetrySink = {
  readonly enabled: boolean;
  readonly dataset: string;
  readonly spoolPath: string;
  readonly emit: (event: TelemetryEvent) => void;
  readonly flush: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export type AxiomQueryResult = {
  readonly tables?: readonly AxiomTable[];
  readonly status?: {
    readonly rowsMatched?: number;
    readonly rowsExamined?: number;
    readonly isPartial?: boolean;
  };
};

type AxiomTable = {
  readonly fields?: readonly { readonly name?: string }[];
  readonly columns?: readonly unknown[][];
};

export function createAxiomTelemetrySink({
  apiKey,
  dataset,
  domain,
  spoolDir = resolvePath(process.cwd(), "tmp", "telemetry", "live"),
  defaultFields = {},
  batchSize = 100,
  maxQueueSize = 10_000,
  flushIntervalMs = 1_000,
}: {
  readonly apiKey?: string;
  readonly dataset: string;
  readonly domain: string;
  readonly spoolDir?: string;
  readonly defaultFields?: TelemetryEvent;
  readonly batchSize?: number;
  readonly maxQueueSize?: number;
  readonly flushIntervalMs?: number;
}): AxiomTelemetrySink {
  mkdirSync(spoolDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const spoolPath = resolvePath(spoolDir, `live-${stamp}.ndjson`);
  const spool = createWriteStream(spoolPath, { flags: "a" });
  const normalizedDomain = normalizeAxiomDomain(domain);
  const enabled = apiKey !== undefined;
  const queue: string[] = [];
  let closed = false;
  let flushing = false;
  let remoteDroppedEvents = 0;
  const timer =
    flushIntervalMs > 0
      ? setInterval(() => {
          void flush();
        }, flushIntervalMs)
      : null;

  const emit = (event: TelemetryEvent): void => {
    if (closed) {
      return;
    }
    const nowMs = Date.now();
    const enriched = {
      service: "alea",
      observedAt: new Date(nowMs).toISOString(),
      observedAtMs: nowMs,
      ...defaultFields,
      ...event,
    };
    const line = JSON.stringify(enriched);
    spool.write(`${line}\n`);
    if (!enabled) {
      return;
    }
    if (queue.length >= maxQueueSize) {
      remoteDroppedEvents += 1;
      return;
    }
    queue.push(line);
    if (queue.length >= batchSize) {
      void flush();
    }
  };

  const flush = async (): Promise<void> => {
    if (!enabled || apiKey === undefined || flushing || queue.length === 0) {
      return;
    }
    flushing = true;
    try {
      const batch = queue.splice(0, batchSize);
      if (remoteDroppedEvents > 0) {
        const dropped = remoteDroppedEvents;
        remoteDroppedEvents = 0;
        batch.unshift(
          JSON.stringify({
            service: "alea",
            observedAt: new Date().toISOString(),
            observedAtMs: Date.now(),
            ...defaultFields,
            event: "telemetry_health",
            droppedRemoteEvents: dropped,
          }),
        );
      }
      const response = await fetch(
        buildAxiomIngestUrl(normalizedDomain, dataset),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/x-ndjson",
          },
          body: `${batch.join("\n")}\n`,
        },
      );
      if (!response.ok) {
        throw new Error(
          `axiom ingest HTTP ${response.status}: ${await response.text().catch(() => "")}`,
        );
      }
    } catch {
      // Local spool is the durable fallback; do not block or retry the hot path.
    } finally {
      flushing = false;
      if (queue.length >= batchSize) {
        void flush();
      }
    }
  };

  const close = async (): Promise<void> => {
    closed = true;
    if (timer !== null) {
      clearInterval(timer);
    }
    await flush();
    await new Promise<void>((resolve) => {
      spool.end(resolve);
    });
  };

  return { enabled, dataset, spoolPath, emit, flush, close };
}

export async function runAxiomAplQuery({
  apiKey,
  domain,
  apl,
  startTime,
  endTime,
}: {
  readonly apiKey: string;
  readonly domain: string;
  readonly apl: string;
  readonly startTime?: string;
  readonly endTime?: string;
}): Promise<AxiomQueryResult> {
  const response = await fetch(
    `${normalizeAxiomDomain(domain)}/v1/datasets/_apl?format=tabular`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apl,
        ...(startTime === undefined ? {} : { startTime }),
        ...(endTime === undefined ? {} : { endTime }),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `axiom query HTTP ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }
  return (await response.json()) as AxiomQueryResult;
}

export function formatAxiomTabularResult(result: AxiomQueryResult): string {
  const table = result.tables?.[0];
  if (table === undefined) {
    return "(no result table)\n";
  }
  const fields = (table.fields ?? []).map((field, index) =>
    field.name === undefined || field.name.length === 0
      ? `field_${index}`
      : field.name,
  );
  const columns = table.columns ?? [];
  const rowCount = columns[0]?.length ?? 0;
  if (fields.length === 0 || rowCount === 0) {
    return "(no rows)\n";
  }
  const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
    fields.map((_, columnIndex) =>
      formatCell(columns[columnIndex]?.[rowIndex]),
    ),
  );
  const widths = fields.map((field, columnIndex) =>
    Math.min(
      48,
      Math.max(
        field.length,
        ...rows.map((row) => row[columnIndex]?.length ?? 0),
      ),
    ),
  );
  const header = fields
    .map((field, index) => field.padEnd(widths[index] ?? field.length))
    .join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows
    .map((row) =>
      row
        .map((cell, index) => truncateCell(cell, widths[index] ?? cell.length))
        .join("  "),
    )
    .join("\n");
  return `${header}\n${divider}\n${body}\n`;
}

export function quoteAplDataset(dataset: string): string {
  return `['${dataset.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}']`;
}

export function createTelemetryRunId(): string {
  return `live-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random()
    .toString(16)
    .slice(2, 10)}`;
}

export function detectGitSha(): string | null {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      stderr: "ignore",
    });
    if (result.exitCode !== 0) {
      return null;
    }
    const text = new TextDecoder().decode(result.stdout).trim();
    return text.length === 0 ? null : text;
  } catch {
    return null;
  }
}

export function defaultTelemetryFields({
  runId,
  gitSha,
}: {
  readonly runId: string;
  readonly gitSha: string | null;
}): TelemetryEvent {
  return {
    runId,
    gitSha,
    hostname: hostname(),
  };
}

function normalizeAxiomDomain(domain: string): string {
  const trimmed = domain.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildAxiomIngestUrl(domain: string, dataset: string): string {
  const encodedDataset = encodeURIComponent(dataset);
  return domain === "https://api.axiom.co"
    ? `${domain}/v1/datasets/${encodedDataset}/ingest`
    : `${domain}/v1/ingest/${encodedDataset}`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  switch (typeof value) {
    case "string":
      return value.replace(/\s+/g, " ");
    case "number":
    case "boolean":
    case "bigint":
      return `${value}`.replace(/\s+/g, " ");
    case "symbol":
      return (value.description ?? "symbol").replace(/\s+/g, " ");
    case "function":
      return "[function]";
    case "object":
      return JSON.stringify(value).replace(/\s+/g, " ");
  }
  return "";
}

function truncateCell(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width);
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3)}...`;
}
