import {
  appendFile,
  type FileHandle,
  mkdir,
  open,
  writeFile,
} from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import {
  sessionForWindow,
  type WindowSession,
  windowStartFor,
} from "@alea/lib/marketCapture/session";
import type { CaptureRecord } from "@alea/lib/marketCapture/types";

/**
 * Append-only JSONL writer that rotates files at the hourly window
 * boundary. Designed for a long-lived capture process: holds one open
 * file handle, appends every record as it arrives, and atomically
 * rotates on the wall-clock boundary.
 *
 * Why a long-held handle (vs. open-append-close per record): at high
 * event rates the syscall cost of `open + close` per write becomes
 * noticeable, and the OS page cache batches our `write()` calls into
 * efficient flushes anyway. We do *not* explicitly fsync — durability
 * comes from session rollover (which closes the handle, forcing the
 * page cache to flush) and from the OS's own dirty-page eviction.
 *
 * Rollover semantics:
 *   1. The previous window's `.jsonl` file is closed cleanly.
 *   2. A `.jsonl.complete` sibling is created — the ingester treats
 *      this as the "ready to be loaded" marker. We do NOT rename the
 *      file itself so the path stays stable for any human or
 *      monitoring process inspecting it.
 *   3. The new window's `.jsonl` file is opened.
 *   4. The caller's `onRollover` hook is dispatched onto a SEPARATE
 *      sequential chain — the writer's main queue does NOT await it.
 *      A slow ingester (e.g. Postgres backlog) cannot stall the
 *      writer's next rotation; rotations queue cleanly and only the
 *      ingest chain backs up. `close()` drains the rollover chain
 *      so the process exits cleanly.
 *
 * Concurrency: every public method awaits a single in-flight chain
 * to keep writes ordered. Callers can fire-and-forget `write()` and
 * trust ordering; the only awaited boundary that matters is `close()`.
 */
export type CaptureJsonlWriter = {
  readonly currentSession: () => WindowSession | null;
  readonly write: (record: CaptureRecord) => Promise<void>;
  readonly close: () => Promise<void>;
};

export type CaptureJsonlWriterParams = {
  readonly dir: string;
  readonly nowMs?: () => number;
  readonly onRollover?: (input: {
    readonly closedSession: WindowSession;
    readonly closedPath: string;
  }) => Promise<void> | void;
  readonly onError?: (error: Error) => void;
};

export async function createCaptureJsonlWriter({
  dir,
  nowMs = () => Date.now(),
  onRollover,
  onError,
}: CaptureJsonlWriterParams): Promise<CaptureJsonlWriter> {
  let handle: FileHandle | null = null;
  let session: WindowSession | null = null;
  let closed = false;
  // Single-slot serialiser so write/close/rollover-internals can't
  // interleave. Used for everything that touches `handle` / `session`.
  let queue: Promise<void> = Promise.resolve();
  // Independent serial chain for `onRollover` callbacks (typically a
  // Postgres bulk insert). Kept off the main queue so a slow or stuck
  // ingester cannot wedge subsequent rotations or writes — observed in
  // production: a hung onRollover used to block all future window
  // rotations, the WS handlers piled up records in heap, and the
  // process grew to multi-GB before SIGINT.
  let rolloverChain: Promise<void> = Promise.resolve();

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const openSession = async (windowStartMs: number): Promise<void> => {
    const next = sessionForWindow({ windowStartMs });
    const sessionDir = resolvePath(dir, next.relativeDir);
    await mkdir(sessionDir, { recursive: true });
    const path = resolvePath(sessionDir, next.fileName);
    handle = await open(path, "a");
    session = next;
  };

  const finishSession = async (): Promise<void> => {
    const ending = session;
    const ph = handle;
    if (ending === null || ph === null) {
      return;
    }
    handle = null;
    session = null;
    try {
      await ph.close();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
    const sessionDir = resolvePath(dir, ending.relativeDir);
    const closedPath = resolvePath(sessionDir, ending.fileName);
    const completePath = resolvePath(sessionDir, ending.completeFileName);
    try {
      // The `.complete` marker is a zero-byte sentinel; its existence
      // is the contract with the ingester. Best-effort write — a
      // disk-full scenario shouldn't take down the writer, but we
      // surface the error so the operator notices.
      await writeFile(completePath, "");
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
    if (onRollover !== undefined) {
      // Dispatch onto the rollover chain so the writer's main queue
      // stays free for the next rotation. Errors are isolated per
      // rotation so one stuck ingest doesn't stop subsequent ones from
      // running.
      const rolloverInput = { closedSession: ending, closedPath };
      rolloverChain = rolloverChain.then(async () => {
        try {
          await onRollover(rolloverInput);
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
  };

  const ensureCurrentSession = async (recordTsMs: number): Promise<void> => {
    const targetWindowStart = windowStartFor({ nowMs: recordTsMs });
    if (session === null) {
      await openSession(targetWindowStart);
      return;
    }
    if (session.windowStartMs === targetWindowStart) {
      return;
    }
    await finishSession();
    await openSession(targetWindowStart);
  };

  // Open the current window up front so `currentSession()` returns a
  // valid value before the first event arrives. Useful for operator
  // visibility.
  await enqueue(async () => {
    await openSession(windowStartFor({ nowMs: nowMs() }));
  });

  return {
    currentSession: () => session,
    write: (record) =>
      enqueue(async () => {
        if (closed) {
          throw new Error("capture jsonl writer is closed");
        }
        // Route by WALL-CLOCK at write time, not by `record.tsMs`.
        //
        // We tried event-time routing first and it blew up at every
        // Window boundary: cross-venue clock skew puts simultaneous
        // events on opposite sides of the wall-clock boundary (Binance
        // says 14:59:59.97, Coinbase says 15:00:00.05). Routing by each
        // event's clock causes the writer to flip-flop between two
        // windows for several seconds, triggering O(n) redundant
        // rotations and re-ingestions per boundary.
        //
        // The window a record lands in is now defined by "the wall-
        // clock window during which we observed it." `record.tsMs` is
        // still preserved verbatim in the JSONL line, so any analysis
        // that wants venue-time bucketing can re-bin from there. The
        // file's window key is operational, not analytical.
        await ensureCurrentSession(nowMs());
        if (handle === null) {
          // Defensive — `ensureCurrentSession` always sets handle.
          throw new Error("capture jsonl writer has no open handle");
        }
        const line = `${JSON.stringify(record)}\n`;
        // `appendFile` on a FileHandle writes from current position
        // (open mode 'a' positions at EOF on each write under POSIX).
        await appendFile(handle, line, "utf8");
      }),
    close: async () => {
      // Drain writes + the final rotation, then drain any rollover
      // callbacks that were dispatched onto the parallel chain. The
      // process is shutting down; we wait so the operator gets a clean
      // last-window ingest before exit.
      await enqueue(async () => {
        if (closed) {
          return;
        }
        closed = true;
        await finishSession();
      });
      await rolloverChain;
    },
  };
}
