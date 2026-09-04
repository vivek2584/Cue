import { prisma } from '../../db/prisma';
import { redis } from '../../db/redis';
import { computeAttentionScore } from '../signal-engine/attentionScore';

/**
 * Builds a context-rich text block from the user's current watchlist state
 * that gets injected into the AI system prompt.
 */
export async function buildWatchlistContext(userId: string): Promise<string> {
  const watchlist = await prisma.watchlist.findFirst({
    where: { userId },
    include: {
      items: {
        include: { instrument: true },
      },
    },
  });

  if (!watchlist || watchlist.items.length === 0) {
    return 'The user has an empty watchlist. No stocks are being tracked.';
  }

  const lines: string[] = [
    `User's Watchlist: "${watchlist.name}" (${watchlist.items.length} items)`,
    '',
    'Symbol | Name | Price | Change% | Bucket | Score | Reason | Baseline | 30d StdDev | Avg Vol | 52W High | 52W Low',
    '--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---',
  ];

  for (const item of watchlist.items) {
    // Get current quote from Redis
    const quoteStr = await redis.get(`quote:${item.symbol}`);
    let currentPrice = Number(item.baselinePrice);
    let currentVolume = 0;

    if (quoteStr) {
      const quote = JSON.parse(quoteStr);
      currentPrice = quote.price;
      currentVolume = quote.volume || 0;
    }

    // Get latest stats
    const stats = await prisma.symbolStatsDaily.findFirst({
      where: { symbol: item.symbol },
      orderBy: { date: 'desc' },
    });

    const stddevReturn30d = stats ? Number(stats.stddevReturn30d) : 0.01;
    const avgVolume30d = stats ? Number(stats.avgVolume30d) : 1;
    const high52w = stats ? Number(stats.high52w) : currentPrice * 1.3;
    const low52w = stats ? Number(stats.low52w) : currentPrice * 0.7;

    // Compute attention score
    const scoreResult = computeAttentionScore({
      baselinePrice: Number(item.baselinePrice),
      currentPrice,
      currentVolume,
      stddevReturn30d,
      avgVolume30d,
      high52w,
      low52w,
    });

    const changePct = Number(item.baselinePrice) > 0
      ? ((currentPrice - Number(item.baselinePrice)) / Number(item.baselinePrice) * 100).toFixed(2)
      : '0.00';

    lines.push(
      `${item.symbol} | ${item.instrument.name} | $${currentPrice.toFixed(2)} | ${changePct}% | ${scoreResult.bucket} | ${scoreResult.score.toFixed(2)} | ${scoreResult.reason} | $${Number(item.baselinePrice).toFixed(2)} | ${(stddevReturn30d * 100).toFixed(2)}% | ${avgVolume30d.toLocaleString()} | $${high52w.toFixed(2)} | $${low52w.toFixed(2)}`
    );
  }

  // Add summary
  const needsAttention = watchlist.items.length; // We'll count properly below
  lines.push('');
  lines.push(`Last baseline review dates per item:`);
  for (const item of watchlist.items) {
    const daysSinceReview = Math.floor(
      (Date.now() - new Date(item.lastViewedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    lines.push(`- ${item.symbol}: last reviewed ${daysSinceReview === 0 ? 'today' : `${daysSinceReview} day(s) ago`}`);
  }

  return lines.join('\n');
}
