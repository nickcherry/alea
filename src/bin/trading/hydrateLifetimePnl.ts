import { env } from "@alea/constants/env";
import { CliUsageError } from "@alea/lib/cli/CliUsageError";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { getPolymarketAuthState } from "@alea/lib/polymarket/getPolymarketClobClient";
import { formatUsd } from "@alea/lib/trading/format";
import {
  DEFAULT_LIFETIME_PNL_PATH,
  persistLifetimePnl,
} from "@alea/lib/trading/state/lifetimePnlStore";
import { scanPolymarketLifetimePnl } from "@alea/lib/trading/vendor/polymarket/scanLifetimePnl";
import pc from "picocolors";

/**
 * Manually rescans the wallet's lifetime PnL via the same Polymarket
 * data-api scan that backs the live trading dashboard, and overwrites
 * the on-disk checkpoint. Used when the checkpoint was deleted or the
 * operator wants an out-of-band refresh.
 *
 * Read-only against the venue. Does not place or cancel any orders.
 */
export const tradingHydrateLifetimePnlCommand = defineCommand({
  name: "trading:hydrate-lifetime-pnl",
  summary:
    "Rescan the wallet's Polymarket lifetime PnL and refresh the on-disk checkpoint",
  description:
    "Calls the same data-api `/activity` + `/positions` scan the live trading dashboard uses, and writes the resulting lifetime PnL to tmp/lifetime-pnl.json. Required when the on-disk checkpoint was deleted, became corrupt, or the operator wants an out-of-band refresh.",
  options: [],
  examples: ["bun alea trading:hydrate-lifetime-pnl"],
  output:
    "Per-step progress (activity events, open positions), the final lifetime PnL, and the path of the refreshed checkpoint file.",
  sideEffects:
    "Reads from Polymarket data-api endpoints. OVERWRITES tmp/lifetime-pnl.json. Does not place or cancel any orders.",
  async run({ io }) {
    if (
      env.polymarketPrivateKey === undefined ||
      env.polymarketFunderAddress === undefined
    ) {
      throw new CliUsageError(
        "POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS must be set.",
      );
    }
    const auth = await getPolymarketAuthState();
    io.writeStdout(
      `${pc.bold("trading:hydrate-lifetime-pnl")} ${pc.dim(`(wallet=`)}${auth.walletAddress.slice(0, 10)}…${pc.dim(")")}\n`,
    );
    const scan = await scanPolymarketLifetimePnl({
      funderAddress: auth.funderAddress,
      onProgress: (event) => {
        if (event.kind === "activity-page") {
          io.writeStdout(
            `  ${pc.dim("activity events fetched:")} ${event.activitiesSoFar}\n`,
          );
        } else {
          io.writeStdout(
            `  ${pc.dim("open positions fetched:")} ${event.positionsSoFar}\n`,
          );
        }
      },
    });
    await persistLifetimePnl({
      walletAddress: auth.walletAddress,
      lifetimePnlUsd: scan.lifetimePnlUsd,
    });
    io.writeStdout(
      `\n${pc.green("lifetime pnl =")} ${formatUsd({ value: scan.lifetimePnlUsd })}\n` +
        `  ${pc.dim("markets:")} ${scan.marketCount}\n` +
        `  ${pc.dim("open positions:")} ${scan.openPositionCount}\n` +
        `${pc.green("wrote")} ${pc.dim(DEFAULT_LIFETIME_PNL_PATH)}\n`,
    );
  },
});
