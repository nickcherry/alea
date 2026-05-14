# Say

Tiny wrapper around macOS's built-in `say` binary so the CLI can speak
arbitrary text. Handy for audible alerts during long-running commands
without leaving a terminal open.

```sh
bun alea say:text "hello world"
bun alea say:text --voice Samantha "trade filled"
bun alea say:text --rate 220 "going fast"
```

Only works on darwin; the command throws on other platforms.

## Options

- `TEXT` (positional) — the string to speak.
- `--voice, -v VOICE` — voice name. Defaults to `Fred` (vintage Mac
  robotic voice). Run `say -v ?` to list every installed voice; common
  natural-sounding picks are `Samantha`, `Kathy`, `Albert`, and the
  newer `Reed (English (US))` / `Sandy (English (US))` family.
- `--rate, -r WPM` — speech rate in words per minute. `say`'s default
  is around 175; bump higher to skim, lower to enunciate.

## Implementation

[`src/bin/say/text.ts`](../src/bin/say/text.ts) spawns
`say -v <voice> [-r <wpm>] <text>` via `node:child_process` and waits
for the process to exit before printing a confirmation line. No third
party dependency — `say` ships with macOS.
