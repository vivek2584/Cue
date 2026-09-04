import request from 'supertest';
import { app } from '../../server';
import { prisma } from '../../db/prisma';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

describe('Watchlist API', () => {
  let token: string;
  let userId: string;
  let watchlistId: string;
  let itemId: string;

  beforeAll(async () => {
    // Create a test user and watchlist
    const user = await prisma.user.create({
      data: {
        email: `test_wl_${Date.now()}@example.com`,
        passwordHash: 'fakehash',
        watchlists: {
          create: [{ name: 'Test Watchlist' }],
        },
      },
      include: { watchlists: true },
    });

    userId = user.id;
    watchlistId = user.watchlists[0].id;
    token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.user.delete({ where: { id: userId } });
  });

  describe('GET /api/watchlist', () => {
    it('should return empty watchlist initially', async () => {
      const res = await request(app)
        .get('/api/watchlist')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
      expect(res.body.digest.items).toHaveLength(0);
    });
  });

  describe('POST /api/watchlist/items', () => {
    it('should add a new item and create the instrument if needed', async () => {
      const res = await request(app)
        .post('/api/watchlist/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ symbol: 'MOCKSYM', name: 'Mock Symbol Corp' });

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('MOCKSYM');
      expect(res.body.instrument.name).toBe('Mock Symbol Corp');
      
      itemId = res.body.id;
    });

    it('should reject a duplicate symbol', async () => {
      const res = await request(app)
        .post('/api/watchlist/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ symbol: 'MOCKSYM' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already in your watchlist');
    });

    it('should validate missing symbol', async () => {
      const res = await request(app)
        .post('/api/watchlist/items')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/watchlist/items/:id/ack', () => {
    it('should update baseline prices on ack', async () => {
      const res = await request(app)
        .post(`/api/watchlist/items/${itemId}/ack`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(itemId);
      // It should have captured the baseline
      expect(res.body.baselineCapturedAt).not.toBeNull();
    });

    it('should prevent acking another users item', async () => {
      // Create a different user
      const otherUser = await prisma.user.create({
        data: { email: `other_${Date.now()}@example.com`, passwordHash: 'x' }
      });
      const otherToken = jwt.sign({ id: otherUser.id, email: otherUser.email }, JWT_SECRET);

      const res = await request(app)
        .post(`/api/watchlist/items/${itemId}/ack`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe('DELETE /api/watchlist/items/:id', () => {
    it('should remove the item', async () => {
      const res = await request(app)
        .delete(`/api/watchlist/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);

      // Verify it's gone
      const check = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
      expect(check).toBeNull();
    });
  });
});
