import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../auth/authMiddleware';
import { redis } from '../../db/redis';
import { prisma } from '../../db/prisma';
import { buildWatchlistContext } from './contextBuilder';
import { streamChat, ChatMessage } from './groqService';

const router = Router();
router.use(requireAuth);

const RATE_LIMIT_PER_MIN = parseInt(process.env.AI_RATE_LIMIT_PER_MIN || '10', 10);

// Zod schema for chat request
const chatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000),
  sessionId: z.string().nullable().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
});

/**
 * Rate limit check using Redis counter with 60s TTL.
 * Returns true if the request should be rate-limited.
 */
async function isRateLimited(userId: string): Promise<boolean> {
  const key = `ai_ratelimit:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60);
  }
  return count > RATE_LIMIT_PER_MIN;
}

/**
 * POST /api/ai/chat
 * 
 * Accepts a chat message, enriches with watchlist context,
 * streams response via SSE (Server-Sent Events).
 */
router.post('/chat', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  // Validate input
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { message, sessionId, history } = parsed.data;

  // Rate limiting
  if (await isRateLimited(userId)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // Build watchlist context for the system prompt
    const watchlistContext = await buildWatchlistContext(userId);

    // Build message history
    const messages: ChatMessage[] = [];

    // Include conversation history if provided
    if (history && history.length > 0) {
      // Take the last 10 messages for context
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add the current user message
    messages.push({ role: 'user', content: message });

    // Persist user message if sessionId is provided
    const effectiveSessionId = sessionId || `session_${Date.now()}`;
    await prisma.chatMessage.create({
      data: {
        userId,
        sessionId: effectiveSessionId,
        role: 'user',
        content: message,
      },
    });

    // Handle client disconnect mid-stream
    let isDisconnected = false;
    req.on('close', () => {
      isDisconnected = true;
    });

    // Stream the response
    let fullResponse = '';
    for await (const token of streamChat(watchlistContext, messages)) {
      if (isDisconnected) break;
      fullResponse += token;
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    if (!isDisconnected) {
      // Send the done signal with sessionId
      res.write(`data: ${JSON.stringify({ done: true, sessionId: effectiveSessionId })}\n\n`);
      res.end();
    }

    // Persist assistant response (even partial if they disconnected)
    await prisma.chatMessage.create({
      data: {
        userId,
        sessionId: effectiveSessionId,
        role: 'assistant',
        content: fullResponse,
      },
    });

  } catch (err) {
    console.error('[AI] Chat error:', err);
    res.write(`data: ${JSON.stringify({ error: 'An error occurred processing your request.' })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/ai/history
 * 
 * Returns the user's chat history, grouped by session.
 */
router.get('/history', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const sessionId = req.query.sessionId as string | undefined;

  try {
    const where: any = { userId };
    if (sessionId) {
      where.sessionId = sessionId;
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        sessionId: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    res.json({ messages });
  } catch (err) {
    console.error('[AI] History error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/ai/sessions
 * 
 * Returns a list of the user's chat sessions with the latest message.
 */
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  try {
    const sessions = await prisma.chatMessage.findMany({
      where: { userId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      distinct: ['sessionId'],
      take: 20,
      select: {
        sessionId: true,
        content: true,
        createdAt: true,
      },
    });

    res.json({
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        preview: s.content.slice(0, 100),
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    console.error('[AI] Sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as aiRouter };
