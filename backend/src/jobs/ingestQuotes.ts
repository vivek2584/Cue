import { redis } from '../db/redis';
import { prisma } from '../db/prisma';
import { MarketDataService } from '../modules/market-data/MarketDataService';

const INGEST_INTERVAL_MS = parseInt(process.env.INGEST_INTERVAL_MS || '15000', 10);

/**
 * Polling ingestion worker — fallback/complement to the Finnhub WS streamer.
 * 
 * Runs at INGEST_INTERVAL_MS intervals:
 * 1. Reads tracked_symbols from Redis
 * 2. Calls FinnhubProvider.getQuotes() for all symbols (fan-in)
 * 3. Writes to Redis with out-of-order rejection
 * 4. Conditionally persists to Postgres (price moved or 60s elapsed)
 * 5. Publishes via Redis pub/sub per symbol
 */
export function startIngestionWorker() {
  const marketData = MarketDataService.getInstance();

  console.log(`[IngestionWorker] Starting polling at ${INGEST_INTERVAL_MS}ms interval`);

  const tick = async () => {
    try {
      const symbols = await redis.smembers('tracked_symbols');
      if (symbols.length === 0) return;

      console.log(`[IngestionWorker] Polling ${symbols.length} symbols: ${symbols.join(', ')}`);

      const quotes = await marketData.getQuotes(symbols);

      for (const quote of quotes) {
        try {
          // Out-of-order rejection: only update if newer
          const existing = await redis.get(`quote:${quote.symbol}`);
          if (existing) {
            const cached = JSON.parse(existing);
            if (new Date(cached.ts).getTime() >= new Date(quote.ts).getTime()) {
              continue; // Cached quote is newer or same, skip
            }
          }

          // Write to Redis
          await redis.set(`quote:${quote.symbol}`, JSON.stringify(quote));

          // Publish to WS clients
          await redis.publish(
            `channel:quotes:${quote.symbol}`,
            JSON.stringify({
              type: 'quote',
              symbol: quote.symbol,
              price: quote.price,
              volume: quote.volume,
              ts: quote.ts,
              isStale: false,
            })
          );

          // Conditional persistence to Postgres
          await conditionalPersist(quote);
        } catch (err) {
          console.error(`[IngestionWorker] Error processing quote for ${quote.symbol}:`, err);
        }
      }
    } catch (err) {
      console.error('[IngestionWorker] Tick error:', err);
    } finally {
      // Schedule next tick only after this one completes
      setTimeout(tick, INGEST_INTERVAL_MS);
    }
  };

  // Run first tick immediately
  tick();
}

/**
 * Only persist to Postgres if:
 * - Price has moved from the last persisted value, OR
 * - More than 60s have elapsed since last persist for this symbol
 */
async function conditionalPersist(quote: { symbol: string; price: number; volume: number; ts: string; source: string }) {
  const lastSavedKey = `last_saved:${quote.symbol}`;
  const lastSavedStr = await redis.get(lastSavedKey);
  const now = Date.now();

  let shouldPersist = false;

  if (!lastSavedStr) {
    shouldPersist = true;
  } else {
    const lastSaved = JSON.parse(lastSavedStr);
    const elapsed = now - lastSaved.time;
    const priceMoved = Math.abs(quote.price - lastSaved.price) > 0.0001;

    if (priceMoved || elapsed > 60000) {
      shouldPersist = true;
    }
  }

  if (shouldPersist) {
    try {
      await prisma.priceSnapshot.upsert({
        where: {
          symbol_ts: { symbol: quote.symbol, ts: new Date(quote.ts) },
        },
        create: {
          symbol: quote.symbol,
          ts: new Date(quote.ts),
          price: quote.price,
          volume: Math.floor(quote.volume),
          source: quote.source,
        },
        update: {
          price: quote.price,
          volume: Math.floor(quote.volume),
          source: quote.source,
        },
      });

      await redis.set(
        lastSavedKey,
        JSON.stringify({ time: now, price: quote.price }),
        'EX',
        120 // Auto-expire after 2 min to ensure we persist at least that often
      );
    } catch (err) {
      console.error(`[IngestionWorker] Persist error for ${quote.symbol}:`, err);
    }
  }
}
