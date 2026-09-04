import WebSocket from 'ws';
import { redis } from '../db/redis';
import { prisma } from '../db/prisma';

export function startFinnhubStreamer() {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.error('FINNHUB_API_KEY is not set. Streamer will not start.');
    return;
  }

  console.log('Starting Finnhub WebSocket streamer...');
  const ws = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);

  const subscribe = (symbol: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', symbol }));
      console.log(`Subscribed to Finnhub stream for ${symbol}`);
    }
  };

  ws.on('open', async () => {
    console.log('Connected to Finnhub WebSocket.');
    const symbols = await redis.smembers('tracked_symbols');
    for (const symbol of symbols) {
      subscribe(symbol);
    }
  });

  // Listen for dynamic subscriptions from the API (when a user adds a symbol)
  const subClient = redis.duplicate();
  subClient.subscribe('channel:new_subscription', (err) => {
    if (err) console.error('Error subscribing to new_subscription channel:', err);
  });
  
  subClient.on('message', (channel, message) => {
    if (channel === 'channel:new_subscription') {
      const { symbol } = JSON.parse(message);
      subscribe(symbol);
    }
  });

  ws.on('message', async (data) => {
    try {
      const response = JSON.parse(data.toString());
      if (response.type === 'trade' && response.data) {
        // response.data is an array of trades: [{ p: price, s: symbol, t: timestamp, v: volume }]
        for (const trade of response.data) {
          const symbol = trade.s;
          const price = trade.p;
          const volume = trade.v;
          const ts = new Date(trade.t).toISOString();

          const quote = {
            symbol,
            price,
            volume,
            ts,
            source: 'finnhub_ws'
          };

          // Update Redis
          await redis.set(`quote:${symbol}`, JSON.stringify(quote));

          // Publish to frontend clients
          await redis.publish(`channel:quotes:${symbol}`, JSON.stringify({
            type: 'quote',
            symbol,
            price,
            ts,
            isStale: false
          }));

          // Persist to Postgres conditionally (e.g., if we haven't saved in the last 10s to avoid spam)
          const lastSavedKey = `last_saved:${symbol}`;
          const lastSaved = await redis.get(lastSavedKey);
          const now = Date.now();
          if (!lastSaved || now - parseInt(lastSaved) > 10000) {
            await prisma.priceSnapshot.upsert({
              where: { symbol_ts: { symbol, ts: new Date(ts) } },
              create: { symbol, ts: new Date(ts), price, volume: Math.floor(volume), source: 'finnhub_ws' },
              update: { price, volume: Math.floor(volume), source: 'finnhub_ws' }
            });
            await redis.set(lastSavedKey, now.toString(), 'EX', 60);
            
            // Re-evaluate digest when we persist a new meaningful price
            await redis.publish('channel:digest_update', JSON.stringify({ type: 'digest_update' }));
          }
        }
      } else if (response.type === 'ping') {
        // Finnhub sends pings
      }
    } catch (err) {
      console.error('Error processing Finnhub WS message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('Finnhub WebSocket error:', err);
  });

  ws.on('close', () => {
    console.log('Finnhub WebSocket disconnected. Attempting to reconnect in 5s...');
    setTimeout(startFinnhubStreamer, 5000);
  });
}
