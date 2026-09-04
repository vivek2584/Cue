import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import cron from 'node-cron';
import { authRouter } from './modules/auth';
import { watchlistRouter } from './modules/watchlist';
import { instrumentsRouter } from './modules/instruments';
import { aiRouter } from './modules/ai';
import { initWebSocketServer } from './modules/realtime';
import { startFinnhubStreamer } from './jobs/finnhubStreamer';
import { startIngestionWorker } from './jobs/ingestQuotes';
import { computeDailyStats } from './jobs/computeDailyStats';
import { prisma } from './db/prisma';
import { redis } from './db/redis';

import path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 4000;

// CORS locked to frontend origin
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/instruments', instrumentsRouter);
app.use('/api/ai', aiRouter);

// Health check — verifies DB + Redis connectivity
app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks });
});

const server = http.createServer(app);
initWebSocketServer(server);

if (require.main === module) {
  // Start the Finnhub WS streamer (real-time trades)
  startFinnhubStreamer();

  // Start the polling ingestion worker (fallback + bootstrapping)
  startIngestionWorker();

  // Run daily stats on startup (so stats are available immediately)
  console.log('[Server] Running initial computeDailyStats...');
  computeDailyStats().catch(err => console.error('[Server] Initial stats computation failed:', err));

  // Schedule nightly stats computation at midnight
  cron.schedule('0 0 * * *', () => {
    console.log('[Cron] Running nightly computeDailyStats...');
    computeDailyStats().catch(err => console.error('[Cron] Nightly stats error:', err));
  });

  server.listen(PORT, () => {
    console.log(`[Server] API Gateway listening on port ${PORT}`);
  });
}

export { app };
