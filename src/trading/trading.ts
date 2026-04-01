import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import type { LeaderTrade, ActivityTradePayload } from "../types";

export async function copyTrade(
  client: ClobClient,
  trade: LeaderTrade,
  multiplier: number,
  chainId: number,
  buyAmountLimitInUsd: number = 0
): Promise<{ size: number; price: number } | void> {
  let amountB =
    trade.side === Side.BUY ? Number(trade.size) * Number(trade.price) * multiplier : Number(trade.size) * multiplier;
  let sizeOutB = String(trade.size);

  if (trade.side === Side.BUY && buyAmountLimitInUsd > 0) {
    const amountUsdB = Number(trade.size) * Number(trade.price) * multiplier;
    if (amountUsdB > buyAmountLimitInUsd) {
      amountB = buyAmountLimitInUsd;
      sizeOutB = String(buyAmountLimitInUsd / Number(trade.price));
    }
  }

  if (amountB <= 0) return;

  const amount = amountB;
  const order = {
    tokenID: trade.asset_id,
    amount,
    side: trade.side as Side,
    orderType: OrderType.FOK as OrderType.FOK,
  };

  const tickSize = await client.getTickSize(trade.asset_id);
  const negRisk = await client.getNegRisk(trade.asset_id);
  await client.createAndPostMarketOrder(order, { tickSize, negRisk }, OrderType.FOK);

  if (trade.side === Side.BUY) {
    return { size: Number(sizeOutB), price: Number(trade.price) };
  }
}

export function activityPayloadToLeaderTrade(p: ActivityTradePayload): LeaderTrade | null {
  if (!p.asset || p.side == null || p.size == null || p.price == null) return null;
  const id = (p.transactionHash ?? "") + (p.timestamp ?? 0);
  return {
    id,
    asset_id: p.asset,
    market: p.conditionId ?? "",
    side: p.side,
    size: String(p.size),
    price: String(p.price),
    match_time: String(p.timestamp ?? 0),
    slug: p.slug,
    eventSlug: p.eventSlug,
    outcome: p.outcome,
    title: p.title,
  };
}
