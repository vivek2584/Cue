import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { redis } from '../../db/redis';
import Redis from 'ioredis';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Dedicated redis connection for subscribing (can't use same connection for pub + sub)
const subRedis = new Redis(REDIS_URL);

interface AuthWebSocket extends WebSocket {
  user?: { id: string; email: string };
  isAlive: boolean;
  subscribedSymbols: Set<string>;
}

export function initWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: AuthWebSocket, req) => {
    ws.isAlive = true;
    ws.subscribedSymbols = new Set();

    // Auth from query string: ?token=...
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Token required');
      return;
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string };
      ws.user = payload;
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }

    // Handle client messages (subscribe/unsubscribe)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
          for (const symbol of msg.symbols) {
            if (typeof symbol === 'string') {
              ws.subscribedSymbols.add(symbol.toUpperCase());
            }
          }
          console.log(`[WS] Client ${ws.user?.email} subscribed to: ${[...ws.subscribedSymbols].join(', ')}`);
        }

        if (msg.type === 'unsubscribe' && Array.isArray(msg.symbols)) {
          for (const symbol of msg.symbols) {
            ws.subscribedSymbols.delete(symbol.toUpperCase());
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Keep-alive ping every 30s
  const interval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const authWs = ws as AuthWebSocket;
      if (authWs.isAlive === false) return authWs.terminate();
      authWs.isAlive = false;
      authWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  // Subscribe to Redis quote channels and forward to interested clients only
  subRedis.psubscribe('channel:quotes:*', (err) => {
    if (err) console.error('[WS] Redis psubscribe error:', err);
  });

  subRedis.subscribe('channel:digest_update', (err) => {
    if (err) console.error('[WS] Redis subscribe error:', err);
  });

  // Handle per-symbol quote messages — only send to clients subscribed to that symbol
  subRedis.on('pmessage', (_pattern, channel, message) => {
    // Channel format: channel:quotes:AAPL
    const symbol = channel.split(':').pop()?.toUpperCase();

    wss.clients.forEach((client) => {
      const authClient = client as AuthWebSocket;
      if (client.readyState !== WebSocket.OPEN) return;

      // Only send to clients that subscribed to this symbol, or all if they subscribed to nothing (backwards compat)
      if (authClient.subscribedSymbols.size === 0 || (symbol && authClient.subscribedSymbols.has(symbol))) {
        client.send(message);
      }
    });
  });

  // Handle digest update — broadcast to all authenticated clients
  subRedis.on('message', (channel, message) => {
    if (channel === 'channel:digest_update') {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  });

  console.log('[WS] WebSocket server initialized on /ws');
}
