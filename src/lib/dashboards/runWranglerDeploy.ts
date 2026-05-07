import { spawn } from "node:child_process";

/**
 * Shells out to `bunx wrangler deploy` from `cwd`. Wrangler reads its
 * config from `wrangler.toml` in that directory and serves whatever
 * lives under the configured `[assets].directory` — for this repo,
 * `tmp/web/`. Inherits the parent process's environment so Wrangler
 * picks up the user's OAuth token and home-dir state.
 *
 * Returns the public URL on success; throws on Wrangler failure
 * (exit code, missing binary, network problem) so the caller can
 * surface the error to the operator.
 */
export async function runWranglerDeploy({
  cwd,
  onLog,
}: {
  readonly cwd: string;
  readonly onLog?: (line: string) => void;
}): Promise<{ readonly url: string }> {
  const log = onLog ?? ((line) => console.log(line));
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bunx", ["wrangler", "deploy"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const buffer: string[] = [];
    const ingest = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      buffer.push(text);
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) {
          log(line);
        }
      }
    };
    proc.stdout?.on("data", ingest);
    proc.stderr?.on("data", ingest);
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `wrangler deploy exited with code ${code}\n` + buffer.join(""),
        ),
      );
    });
  });
  return { url: "https://alea.nickcherryjiggz.workers.dev" };
}
