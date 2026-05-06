import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";

const repoRoot = resolvePath(import.meta.dir, "../../../..");

/**
 * Default location for replay session JSONL — sibling of dry-trading
 * sessions under `tmp/` so the existing tooling (`ls`, `find`) finds
 * both.
 */
export const DEFAULT_REPLAY_LOG_DIR = resolvePath(
  repoRoot,
  "tmp/replay-trading",
);

export type ReplayJsonlWriter = {
  readonly path: string;
  readonly append: (record: unknown) => Promise<void>;
};

export async function createReplayJsonlWriter({
  dir = DEFAULT_REPLAY_LOG_DIR,
  nowMs = Date.now(),
}: {
  readonly dir?: string;
  readonly nowMs?: number;
} = {}): Promise<ReplayJsonlWriter> {
  const timestamp = new Date(nowMs).toISOString().replaceAll(":", "-");
  const path = resolvePath(dir, `replay-trading_${timestamp}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  return {
    path,
    append: async (record) => {
      await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    },
  };
}
