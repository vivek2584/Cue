import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { redis } from '../../db/redis';
import { requireAuth, AuthRequest } from '../auth/authMiddleware';
import { buildDigest, WatchlistItemRaw } from '../signal-engine/digest';
import { computeAttentionScore } from '../signal-engine/attentionScore';

const router = Router();
router.use(requireAuth);

// --- Zod Schemas ---
const addItemSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required').max(20).toUpperCase(),
  name: z.string().optional(),
});

// --- Helpers ---

/**
 * Verify that a watchlist item belongs to the authenticated user.
 * Returns the item if authorized, or sends a 403/404 and returns null.
 */
async function authorizeItem(id: string, userId: string, res: Response) {
  const item = await prisma.watchlistItem.findUnique({
    where: { id },
    include: { watchlist: true, instrument: true },
  });

  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return null;
  }

  if (item.watchlist.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return item;
}

/**
 * Compute staleness from a quote timestamp.
 * isStale = age > 120s.  isSeverelyStale = age > 900s (during market hours).
 */
function computeStaleness(ts: string) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  return {
    asOf: ts,
    isStale: ageSeconds > 120,
    ageSeconds,
  };
}

// --- GET /api/watchlist ---
router.get('/', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  try {
    // Check Redis digest cache first
    const watchlist = await prisma.watchlist.findFirst({
      where: { userId },
    });

    if (!watchlist) {
      return res.json({ items: [], digest: { items: [] } });
    }

    // Check digest cache (30s TTL)
    const cachedDigest = await redis.get(`digest:${watchlist.id}`);
    if (cachedDigest) {
      return res.json(JSON.parse(cachedDigest));
    }

    // Fetch items with instruments
    const items = await prisma.watchlistItem.findMany({
      where: { watchlistId: watchlist.id },
      include: { instrument: true },
    });

    if (items.length === 0) {
      const result = { items: [], digest: { items: [] } };
      await redis.set(`digest:${watchlist.id}`, JSON.stringify(result), 'EX', 30);
      return res.json(result);
    }

    const itemsRaw: WatchlistItemRaw[] = [];

    for (const item of items) {
      // Get latest quote from Redis
      const quoteStr = await redis.get(`quote:${item.symbol}`);
      let currentPrice = Number(item.baselinePrice);
      let currentVolume = 0;
      let ts = new Date().toISOString();
      let isStale = true;

      if (quoteStr) {
        const quote = JSON.parse(quoteStr);
        currentPrice = quote.price;
        currentVolume = quote.volume || 0;
        ts = quote.ts;
        const ageSeconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
        isStale = ageSeconds > 120;
      }

      // Get latest stats
      const stats = await prisma.symbolStatsDaily.findFirst({
        where: { symbol: item.symbol },
        orderBy: { date: 'desc' },
      });

      // Get sparkline (last 7 daily prices)
      const snapshots = await prisma.priceSnapshot.findMany({
        where: { symbol: item.symbol },
        orderBy: { ts: 'desc' },
        take: 7,
      });
      const sparkline = snapshots.map(s => Number(s.price)).reverse();

      itemsRaw.push({
        id: item.id,
        symbol: item.symbol,
        name: item.instrument.name,
        baselinePrice: Number(item.baselinePrice),
        addedAt: item.addedAt,
        lastViewedAt: item.lastViewedAt,
        currentPrice,
        currentVolume,
        ts,
        isStale,
        stddevReturn30d: stats ? Number(stats.stddevReturn30d) : 0.01,
        avgVolume30d: stats ? Number(stats.avgVolume30d) : 1,
        high52w: stats ? Number(stats.high52w) : currentPrice * 1.3,
        low52w: stats ? Number(stats.low52w) : currentPrice * 0.7,
        sparkline,
      });
    }

    const result = buildDigest(itemsRaw);

    // Cache for 30s
    await redis.set(`digest:${watchlist.id}`, JSON.stringify(result), 'EX', 30);

    res.json(result);
  } catch (error) {
    console.error('[Watchlist] GET error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- POST /api/watchlist/items ---
router.post('/items', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  // Validate input
  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { symbol, name } = parsed.data;

  try {
    const watchlist = await prisma.watchlist.findFirst({ where: { userId } });
    if (!watchlist) return res.status(404).json({ error: 'Watchlist not found' });

    // Check for duplicate
    const existing = await prisma.watchlistItem.findFirst({
      where: { watchlistId: watchlist.id, symbol },
    });
    if (existing) {
      return res.status(409).json({ error: `${symbol} is already in your watchlist` });
    }

    // Ensure instrument exists
    await prisma.instrument.upsert({
      where: { symbol },
      update: {},
      create: {
        symbol,
        name: name || symbol,
        exchange: 'US',
        sector: null,
      },
    });

    // Track symbol in Redis for ingestion
    await redis.sadd('tracked_symbols', symbol);
    await redis.publish('channel:new_subscription', JSON.stringify({ symbol }));

    // Baseline is latest known price or 0 (will be updated on first quote)
    const quoteStr = await redis.get(`quote:${symbol}`);
    let baselinePrice = 0;
    if (quoteStr) {
      baselinePrice = JSON.parse(quoteStr).price;
    } else {
      const latest = await prisma.priceSnapshot.findFirst({
        where: { symbol },
        orderBy: { ts: 'desc' },
      });
      if (latest) baselinePrice = Number(latest.price);
    }

    const newItem = await prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        symbol,
        baselinePrice,
      },
      include: { instrument: true },
    });

    // Invalidate digest cache
    await redis.del(`digest:${watchlist.id}`);

    res.json(newItem);
  } catch (error) {
    console.error('[Watchlist] Add item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- DELETE /api/watchlist/items/:id ---
router.delete('/items/:id', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.id;

  try {
    // Authorization check
    const item = await authorizeItem(id, userId, res);
    if (!item) return;

    await prisma.watchlistItem.delete({ where: { id } });

    // Invalidate digest cache
    await redis.del(`digest:${item.watchlistId}`);

    res.status(204).send();
  } catch (error) {
    console.error('[Watchlist] Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- POST /api/watchlist/items/:id/ack ---
router.post('/items/:id/ack', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.id;

  try {
    // Authorization check
    const item = await authorizeItem(id, userId, res);
    if (!item) return;

    // Get current price from Redis
    const quoteStr = await redis.get(`quote:${item.symbol}`);
    let currentPrice = Number(item.baselinePrice);
    if (quoteStr) {
      currentPrice = JSON.parse(quoteStr).price;
    }

    const updated = await prisma.watchlistItem.update({
      where: { id },
      data: {
        baselinePrice: currentPrice,
        baselineCapturedAt: new Date(),
        lastViewedAt: new Date(),
      },
      include: { instrument: true },
    });

    // Invalidate digest cache
    await redis.del(`digest:${item.watchlistId}`);

    res.json(updated);
  } catch (error) {
    console.error('[Watchlist] Ack error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- GET /api/watchlist/items/:id/detail ---
router.get('/items/:id/detail', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const userId = req.user!.id;

  try {
    // Authorization check
    const item = await authorizeItem(id, userId, res);
    if (!item) return;

    // Fetch 30 days of history
    const history = await prisma.priceSnapshot.findMany({
      where: { symbol: item.symbol },
      orderBy: { ts: 'asc' },
      take: 30,
    });

    // Fetch latest stats
    const stats = await prisma.symbolStatsDaily.findFirst({
      where: { symbol: item.symbol },
      orderBy: { date: 'desc' },
    });

    // Compute live reasons using the attention engine
    const quoteStr = await redis.get(`quote:${item.symbol}`);
    let currentPrice = Number(item.baselinePrice);
    let currentVolume = 0;
    if (quoteStr) {
      const quote = JSON.parse(quoteStr);
      currentPrice = quote.price;
      currentVolume = quote.volume || 0;
    }

    const scoreResult = computeAttentionScore({
      baselinePrice: Number(item.baselinePrice),
      currentPrice,
      currentVolume,
      stddevReturn30d: stats ? Number(stats.stddevReturn30d) : 0.01,
      avgVolume30d: stats ? Number(stats.avgVolume30d) : 1,
      high52w: stats ? Number(stats.high52w) : currentPrice * 1.3,
      low52w: stats ? Number(stats.low52w) : currentPrice * 0.7,
    });

    // Split combined reason into individual reasons
    const reasons = scoreResult.reason
      .split(' · ')
      .filter(r => r.length > 0);

    res.json({
      history: history.map(h => ({
        date: h.ts.toISOString(),
        close: Number(h.price),
        volume: Number(h.volume),
      })),
      reasons,
      signal: scoreResult,
      stats: stats
        ? {
            stddev30d: Number(stats.stddevReturn30d),
            avgVolume30d: Number(stats.avgVolume30d),
            high52w: Number(stats.high52w),
            low52w: Number(stats.low52w),
          }
        : null,
    });
  } catch (error) {
    console.error('[Watchlist] Detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as watchlistRouter };
