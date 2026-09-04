import request from 'supertest';
import { app } from '../../server';
import { prisma } from '../../db/prisma';

describe('End-to-End Watchlist Flow', () => {
  const email = `e2e_${Date.now()}@example.com`;
  const password = 'securepassword';
  let token: string;
  let watchlistId: string;
  let itemId: string;

  afterAll(async () => {
    // Teardown
    await prisma.user.deleteMany({
      where: { email }
    });
  });

  it('1. User signs up', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
  });

  it('2. Watchlist is automatically created and empty', async () => {
    const res = await request(app)
      .get('/api/watchlist')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('3. User adds a symbol (AAPL) to watchlist', async () => {
    const res = await request(app)
      .post('/api/watchlist/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ symbol: 'AAPL', name: 'Apple Inc.' });
    
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('AAPL');
    itemId = res.body.id;
    watchlistId = res.body.watchlistId;
  });

  it('4. Watchlist now contains AAPL', async () => {
    const res = await request(app)
      .get('/api/watchlist')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].symbol).toBe('AAPL');
  });

  it('5. User requests details and gets reasons computed', async () => {
    const res = await request(app)
      .get(`/api/watchlist/items/${itemId}/detail`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reasons');
    expect(res.body).toHaveProperty('signal');
    expect(res.body.signal).toHaveProperty('bucket');
    expect(res.body.signal).toHaveProperty('score');
  });

  it('6. User acknowledges the item (updates baseline)', async () => {
    const res = await request(app)
      .post(`/api/watchlist/items/${itemId}/ack`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.baselineCapturedAt).toBeDefined();
  });

  it('7. User deletes the item', async () => {
    const res = await request(app)
      .delete(`/api/watchlist/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(204);
  });

  it('8. Watchlist is empty again', async () => {
    const res = await request(app)
      .get('/api/watchlist')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});
