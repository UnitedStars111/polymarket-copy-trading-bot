import type { ClobClient } from "@polymarket/clob-client";
import { OrderType, Side } from "@polymarket/clob-client";
import type { AppConfig } from "../types";
import { DATA_API, EXIT_INTERVAL_MS, POSITIONS_MAX_OFFSET, POSITIONS_PAGE_SIZE } from "../constant";

interface Entry {
  entryPrice: number;
  size: number;
  maxPrice: number;
}

const entries = new Map<string, Entry>();

export function recordEntry(assetId: string, size: number, price: number): void {
  const cur = entries.get(assetId);
  if (cur) {
    const newSize = cur.size + size;
    cur.entryPrice = (cur.entryPrice * cur.size + price * size) / newSize;
    cur.size = newSize;
  } else {
    entries.set(assetId, { entryPrice: price, size: size, maxPrice: price });
  }
}

export function runExitLoop(client: ClobClient, config: AppConfig): void {
  const { exit: exitConfig, walletAddress } = config;
  if (!walletAddress) return;
  const hasExit = exitConfig.takeProfit > 0 || exitConfig.stopLoss > 0 || exitConfig.trailingStop > 0;
  if (!hasExit) return;

  const takeProfit = exitConfig.takeProfit;
  const stopLoss = exitConfig.stopLoss;
  const trailingStop = exitConfig.trailingStop;

  async function check(): Promise<void> {
    try {
      const positions: Array<{ asset: string; size: number; curPrice: number }> = [];
      let offset = 0;
      while (offset <= POSITIONS_MAX_OFFSET) {
        const url = `${DATA_API}/positions?user=${encodeURIComponent(walletAddress)}&limit=${POSITIONS_PAGE_SIZE}&offset=${offset}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const page = (await res.json()) as Array<{ asset: string; size: number; curPrice: number }>;
        positions.push(...page);
        if (page.length < POSITIONS_PAGE_SIZE) break;
        offset += POSITIONS_PAGE_SIZE;
      }
      for (const p of positions) {
        const entry = entries.get(p.asset);
        if (!entry || entry.size <= 0) continue;
        const sizeB = entry.size <= p.size ? entry.size : p.size;
        if (sizeB <= 0) continue;
        const pnlPct = (p.curPrice - entry.entryPrice) / entry.entryPrice * 100;
        const e = entries.get(p.asset)!;
        if (p.curPrice > e.maxPrice) e.maxPrice = p.curPrice;
        const trailPct = e.maxPrice > 0 ? (e.maxPrice - p.curPrice) / e.maxPrice * 100 : 0;

        let shouldSell = false;
        if (takeProfit > 0 && pnlPct >= takeProfit) shouldSell = true;
        if (stopLoss > 0 && pnlPct <= -stopLoss) shouldSell = true;
        if (trailingStop > 0 && trailPct >= trailingStop) shouldSell = true;
        if (!shouldSell) continue;

        const amount = sizeB * p.curPrice;
        const tickSize = await client.getTickSize(p.asset);
        const negRisk = await client.getNegRisk(p.asset);
        await client.createAndPostMarketOrder(
          { tokenID: p.asset, amount, side: Side.SELL, orderType: OrderType.FOK },
          { tickSize, negRisk },
          OrderType.FOK
        );
        e.size = e.size - sizeB;
        if (e.size <= 0) entries.delete(p.asset);
      }
    } catch (e) {
      console.error("exit check", e?.message ?? e);
    }
  }

  setInterval(check, EXIT_INTERVAL_MS);
  check();
}
