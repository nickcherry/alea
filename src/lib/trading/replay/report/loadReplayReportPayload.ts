import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve as resolvePath } from "node:path";

import { buildReplayReportPayload } from "@alea/lib/trading/replay/report/buildReplayReportPayload";
import type { ReplayReportPayload } from "@alea/lib/trading/replay/report/types";

export async function loadReplayReportPayload({
  sessionPath,
  replayTradingDir,
  generatedAtMs = Date.now(),
}: {
  readonly sessionPath?: string;
  readonly replayTradingDir: string;
  readonly generatedAtMs?: number;
}): Promise<ReplayReportPayload> {
  const sourcePath =
    sessionPath === undefined
      ? await findLatestReplaySession({ replayTradingDir })
      : normalizePath({ path: sessionPath });
  const text = await readFile(sourcePath, "utf8");
  const records: unknown[] = [];
  const parseErrors: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed));
    } catch (error) {
      parseErrors.push(`line ${index + 1}: ${(error as Error).message}`);
    }
  }
  const payload = buildReplayReportPayload({
    records,
    sourcePath,
    generatedAtMs,
  });
  return {
    ...payload,
    parseErrors: [...payload.parseErrors, ...parseErrors],
  };
}

export async function findLatestReplaySession({
  replayTradingDir,
}: {
  readonly replayTradingDir: string;
}): Promise<string> {
  const entries = await readdir(replayTradingDir);
  const candidates = await Promise.all(
    entries
      .filter((entry) => /^replay-trading_.*\.jsonl$/.test(entry))
      .map(async (entry) => {
        const path = resolvePath(replayTradingDir, entry);
        const stats = await stat(path);
        return { path, mtimeMs: stats.mtimeMs, label: basename(path) };
      }),
  );
  candidates.sort(
    (a, b) => b.mtimeMs - a.mtimeMs || b.label.localeCompare(a.label),
  );
  const latest = candidates[0];
  if (latest === undefined) {
    throw new Error(`No dry trading JSONL sessions found in ${replayTradingDir}.`);
  }
  return latest.path;
}

function normalizePath({ path }: { readonly path: string }): string {
  return isAbsolute(path) ? path : resolvePath(process.cwd(), path);
}
