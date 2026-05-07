# Production

Operator playbook for the box that runs `alea trading:live --commit`.
Dashboards deploy from a laptop via `dashboards:build --deploy` (see
[DASHBOARDS.md](./DASHBOARDS.md)) — that's a different surface and not
covered here.

## Connect

```
alea_prod
```

Defined in your local `~/.zshrc` as
`ssh -t root@<host> 'cd /opt/alea && exec "$SHELL" -l'`. Drops you in
`/opt/alea` with the live wallet's `.env` already on disk.

## Single-process rule

**At most one `bun alea trading:live --commit` process exists at a
time.** Two would race on the same Polymarket wallet — both would try
to place orders for the same window, fight each other on the
allowance, and double-stake. Always stop the running process before
starting a new one. The "stop" step below is non-negotiable.

## Dedicated tmux session: `alea-prod-live`

Live trading always runs inside a **detached tmux session** so an
SSH disconnect doesn't kill the trader. The session name is fixed:
`alea-prod-live`. One name everywhere makes "is it running?" a
single command:

```
tmux has-session -t alea-prod-live && echo running || echo stopped
```

Don't invent ad-hoc names — the single-process rule depends on
everyone targeting the same handle.

## Sync first, every time

Before stopping the trader, before starting it, before editing
anything in `/opt/alea` — pull main:

```
cd /opt/alea
git pull --ff-only origin main
```

`--ff-only` refuses to make a merge commit on the prod tree; if it
fails, prod has drifted and needs hand inspection (`git status`,
`git log --oneline origin/main..HEAD`) before any restart.

## Start the trader

After syncing main and confirming no `alea-prod-live` session
exists, start a fresh session detached:

```
ts=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p tmp/live-trading
tmux new-session -d -s alea-prod-live \
  "cd /opt/alea && echo live-log:tmp/live-trading/live-${ts}.log && \
   bun alea trading:live --commit 2>&1 | tee -a tmp/live-trading/live-${ts}.log"
```

That:

- Creates a detached `alea-prod-live` tmux session.
- Writes a fresh log under `tmp/live-trading/live-<UTC-iso>.log` and
  tees the trader's stdout/stderr into it. The `live-log:` line is
  printed inside the tmux pane so when you attach you can grep the
  log path out of the scrollback.
- Uses `--commit` (real trading; `trading:live` without it is a
  read-only dry mode and won't actually place orders).

Confirm:

```
tmux ls | grep alea-prod-live
pgrep -af "bun.*trading:live"
```

You should see exactly one tmux session and one bun process. The
log file fills as windows fire.

## Watch it

Attach (you can detach again with `Ctrl-b d`):

```
tmux attach -t alea-prod-live
```

Or just tail the log without entering the session:

```
tail -F $(ls -1t tmp/live-trading/live-*.log | head -1)
```

The Telegram bot also fires a window-summary message at the end of
every 5-minute window, with a `Total Pnl` line that matches the live
trading dashboard at `https://alea.nickcherryjiggz.workers.dev/`.

## Stop the trader

The trader installs a `SIGINT` handler that drains current
windows and closes streams cleanly. To stop it:

```
tmux send-keys -t alea-prod-live C-c
```

Wait for the process to actually exit (the bun PID disappears from
`pgrep -af bun.*trading:live`), then tear down the session:

```
tmux kill-session -t alea-prod-live
```

If the trader hangs and won't exit on `C-c`, escalate — find the
PID and `kill -TERM`, then `kill -KILL` after a short wait. Never
`tmux kill-session` while the bun process is mid-trade; you'll
leave open orders on the venue.

## Restart

Restart is just `stop → sync → start`. There is no in-place reload:

```
tmux send-keys -t alea-prod-live C-c        # stop
# wait for the bun process to disappear
tmux kill-session -t alea-prod-live
git pull --ff-only origin main              # sync
ts=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p tmp/live-trading
tmux new-session -d -s alea-prod-live \
  "cd /opt/alea && echo live-log:tmp/live-trading/live-${ts}.log && \
   bun alea trading:live --commit 2>&1 | tee -a tmp/live-trading/live-${ts}.log"
```

## Troubleshooting

- `git pull` refuses to fast-forward → prod has local commits or a
  divergent main. `git status` and `git log --oneline origin/main..HEAD`
  before doing anything; do not `--force` or `reset --hard` without
  understanding what's there.
- A `bun alea trading:live` process exists but no tmux session →
  somebody started the trader without tmux. Stop it (`kill -INT
  <pid>`) and restart properly.
- A tmux session exists but no bun process → trader crashed; the
  session is just an idle shell. `tmux kill-session -t alea-prod-live`
  and restart. Inspect the tail of the most recent
  `tmp/live-trading/live-*.log` for the cause first.
- Two bun processes → single-process rule violated. Identify the
  newer one (by PID) and `kill -INT` it, then verify only one
  remains before re-checking the wallet for stuck orders.
