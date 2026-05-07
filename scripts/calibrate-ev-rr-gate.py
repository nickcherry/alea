#!/usr/bin/env python3
"""
Post-hoc calibration of the dollar-EV / reward-risk gate.

Reads one trading:replay JSONL session (defaults to the largest one
under tmp/replay-trading/) and re-evaluates each order with arbitrary
(MIN_EV, MIN_RR) thresholds applied to the *taker counterfactual*
fill price. The replay itself is maker-mode placement, so the
"would we have entered as taker?" answer is what we sweep here —
that's what production actually does.

Per order we recompute:
    shares          = takerCounterfactual.sharesIfFilled
    fillPrice       = takerCounterfactual.askPrice          (depth-weighted avg)
    feeUsd          = shares * TAKER_FEE_RATE * fillPrice * (1 − fillPrice)
    grossWinUsd     = shares                                (binary winner pays $1)
    netWinUsd       = grossWinUsd − feeUsd − stakeUsd_eff
    evUsd           = P * netWinUsd − (1 − P) * stakeUsd_eff
    rewardRiskRatio = netWinUsd / stakeUsd_eff

Where stakeUsd_eff is takerCounterfactual.costUsd (the actual USDC
required to clear `sharesIfFilled` at the walked-up book — typically
just under $20).

If the order PASSES the (MIN_EV, MIN_RR) gates, it contributes:
    won  = officialOutcome == order.side
    pnl  = won ? grossWinUsd − stakeUsd_eff − feeUsd : −stakeUsd_eff − feeUsd

Reports a 2-D heatmap + summary so the operator can pick a sensible
`MIN_EXPECTED_VALUE_USD` / `MIN_REWARD_RISK_RATIO` combination.
"""

import glob
import json
import os
import sys

TAKER_FEE_RATE = 0.07  # 700 bps — matches what /activity reveals for current
                       # Polymarket crypto markets (despite /trades reporting "0")


def load_session(path):
    orders = []
    config = None
    for line in open(path):
        obj = json.loads(line)
        t = obj.get("type")
        if t == "session_start":
            config = obj.get("config")
        elif t == "window_finalized":
            for o in obj.get("orders", []):
                orders.append(o)
    return config, orders


def compute_taker_economics(order, stake_floor):
    taker = order.get("takerCounterfactual")
    if taker is None:
        return None
    shares = taker.get("sharesIfFilled") or 0
    fill_price = taker.get("askPrice") or 0
    cost_usd = taker.get("costUsd") or 0
    if shares <= 0 or fill_price <= 0 or fill_price >= 1 or cost_usd <= 0:
        return None
    fee = shares * TAKER_FEE_RATE * fill_price * (1 - fill_price)
    gross_win = shares  # binary $1 winner
    # Use cost_usd as the effective stake — that's what we'd actually put
    # on the venue at the walked-up book. (For an order whose stake hits
    # exactly $20 it'll equal $20; for a thin book that fills less, less.)
    stake_eff = max(cost_usd, stake_floor)
    net_win = gross_win - fee - stake_eff
    p = order.get("modelProbability") or 0
    ev = p * net_win - (1 - p) * stake_eff
    rr = net_win / stake_eff if stake_eff > 0 else 0
    return {
        "fill_price": fill_price,
        "shares": shares,
        "fee": fee,
        "gross_win": gross_win,
        "net_win": net_win,
        "stake_eff": stake_eff,
        "ev": ev,
        "rr": rr,
        "p": p,
    }


def is_winner(order):
    side = order.get("side")
    chosen = order.get("officialOutcome") or order.get("proxyOutcome")
    return chosen is not None and chosen == side


def evaluate_threshold(orders, min_ev, min_rr):
    """Apply (MIN_EV, MIN_RR) to the orders and return aggregate stats."""
    taken = 0
    wins = 0
    pnl_total = 0.0
    fees_total = 0.0
    pnl_by_side_price = []  # (won, fillPrice, pnl)
    for o in orders:
        econ = compute_taker_economics(o, stake_floor=0)
        if econ is None:
            continue
        if econ["ev"] < min_ev or econ["rr"] < min_rr:
            continue
        taken += 1
        won = is_winner(o)
        if won:
            wins += 1
            pnl = econ["gross_win"] - econ["stake_eff"] - econ["fee"]
        else:
            pnl = -econ["stake_eff"] - econ["fee"]
        pnl_total += pnl
        fees_total += econ["fee"]
        pnl_by_side_price.append((won, econ["fill_price"], pnl))
    return {
        "taken": taken,
        "wins": wins,
        "win_rate": wins / taken if taken > 0 else 0,
        "pnl": pnl_total,
        "fees": fees_total,
        "pnl_per_trade": pnl_total / taken if taken > 0 else 0,
    }


def fmt_usd(v):
    sign = "+" if v >= 0 else "-"
    return f"{sign}${abs(v):>7.2f}"


def main():
    if len(sys.argv) > 1:
        path = sys.argv[1]
    else:
        sessions = glob.glob(
            "/Users/nickcherry/src/alea/tmp/replay-trading/replay-trading_*.jsonl"
        )
        sessions.sort(key=lambda p: -os.path.getsize(p))
        path = sessions[0]
    print(f"session: {os.path.basename(path)}")
    config, orders = load_session(path)
    print(
        f"  range: {config.get('replay', {}).get('fromMs')} → "
        f"{config.get('replay', {}).get('toMs')}"
    )
    print(f"  orders: {len(orders)}")
    valid_orders = [o for o in orders if compute_taker_economics(o, 0) is not None]
    print(f"  orders with usable takerCounterfactual: {len(valid_orders)}")
    print()

    # Baseline: no gate (every order taken)
    baseline = evaluate_threshold(valid_orders, min_ev=-1e9, min_rr=-1e9)
    print(
        f"baseline (no EV/RR gate): "
        f"taken={baseline['taken']} "
        f"wins={baseline['wins']} ({baseline['win_rate']:.1%}) "
        f"pnl={fmt_usd(baseline['pnl'])} "
        f"fees={fmt_usd(baseline['fees'])} "
        f"pnl/trade={fmt_usd(baseline['pnl_per_trade'])}"
    )
    print()

    # Sweep
    ev_grid = [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]
    rr_grid = [0.0, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]

    print("PnL ($) heatmap — rows: MIN_EV, cols: MIN_RR")
    header = f"  {'MIN_EV':>8}  " + "  ".join(f"{rr:>7.2f}" for rr in rr_grid)
    print(header)
    print(f"  {'':>8}  " + "  ".join("-" * 7 for _ in rr_grid))
    for ev in ev_grid:
        row = [f"  ${ev:>6.2f}  "]
        for rr in rr_grid:
            r = evaluate_threshold(valid_orders, min_ev=ev, min_rr=rr)
            row.append(f"{r['pnl']:>+7.0f}")
        print("  ".join(row))
    print()

    print("trades-taken heatmap")
    print(header)
    print(f"  {'':>8}  " + "  ".join("-" * 7 for _ in rr_grid))
    for ev in ev_grid:
        row = [f"  ${ev:>6.2f}  "]
        for rr in rr_grid:
            r = evaluate_threshold(valid_orders, min_ev=ev, min_rr=rr)
            row.append(f"{r['taken']:>7}")
        print("  ".join(row))
    print()

    print("win-rate heatmap")
    print(header)
    print(f"  {'':>8}  " + "  ".join("-" * 7 for _ in rr_grid))
    for ev in ev_grid:
        row = [f"  ${ev:>6.2f}  "]
        for rr in rr_grid:
            r = evaluate_threshold(valid_orders, min_ev=ev, min_rr=rr)
            row.append(f"{r['win_rate']*100:>6.1f}%")
        print("  ".join(row))
    print()

    # Show a few featured combos
    print("featured points:")
    for ev, rr in [
        (0.0, 0.0),     # no gate
        (1.0, 0.20),    # current proposed defaults
        (0.5, 0.20),
        (1.0, 0.15),
        (0.5, 0.15),
        (2.0, 0.20),
        (1.0, 0.30),
    ]:
        r = evaluate_threshold(valid_orders, min_ev=ev, min_rr=rr)
        print(
            f"  EV≥${ev:.2f} RR≥{rr:.2f}: "
            f"taken={r['taken']:>4} wins={r['wins']:>3} "
            f"win-rate={r['win_rate']:.1%} "
            f"pnl={fmt_usd(r['pnl'])} pnl/trade={fmt_usd(r['pnl_per_trade'])}"
        )


if __name__ == "__main__":
    main()
