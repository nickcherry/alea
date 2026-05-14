import { spawn } from "node:child_process";

import { defineCommand } from "@alea/lib/cli/defineCommand";
import { definePositional } from "@alea/lib/cli/definePositional";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import pc from "picocolors";
import { z } from "zod";

export const sayTextCommand = defineCommand({
  name: "say:text",
  summary: "Speak the given text aloud via macOS `say`",
  description:
    "Shells out to the built-in macOS `say` binary to read TEXT through the system speech synthesizer. Only works on darwin; throws on other platforms.",
  positionals: [
    definePositional({
      key: "text",
      valueName: "TEXT",
      schema: z.string().min(1).describe("Text to speak."),
    }),
  ],
  options: [
    defineValueOption({
      key: "voice",
      long: "--voice",
      short: "-v",
      valueName: "VOICE",
      schema: z
        .string()
        .min(1)
        .default("Fred")
        .describe("Voice name. Run `say -v ?` to list options."),
    }),
    defineValueOption({
      key: "rate",
      long: "--rate",
      short: "-r",
      valueName: "WPM",
      schema: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Speech rate in words per minute."),
    }),
  ],
  examples: [
    'bun alea say:text "hello world"',
    'bun alea say:text --voice Samantha "trade filled"',
    'bun alea say:text --rate 220 "going fast"',
  ],
  output: "Prints a confirmation line once speech finishes.",
  sideEffects: "Plays audio through the system speech synthesizer.",
  async run({ io, options, positionals }) {
    if (process.platform !== "darwin") {
      throw new Error("say:text only works on macOS (darwin).");
    }

    const args: string[] = ["-v", options.voice];
    if (options.rate !== undefined) {
      args.push("-r", String(options.rate));
    }
    args.push(positionals.text);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("say", args, { stdio: "inherit" });
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`say exited with code ${code}`));
      });
    });

    io.writeStdout(`${pc.green("spoke")} ${pc.dim(positionals.text)}\n`);
  },
});
