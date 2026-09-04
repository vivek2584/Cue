import request from 'supertest';
import { app } from '../../server';
import { prisma } from '../../db/prisma';

describe('Auth API', () => {
  const testEmail = `test_${Date.now()}@example.com`;
  const testPassword = 'password123';

  // Clean up any test users after the suite runs
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: 'test_' } }
    });
  });

  describe('POST /api/auth/signup', () => {
    it('should create a new user and return a token', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: testEmail, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user.email).toBe(testEmail);

      // Verify a watchlist was created for the user
      const watchlists = await prisma.watchlist.findMany({
        where: { userId: res.body.user.id }
      });
      expect(watchlists).toHaveLength(1);
      expect(watchlists[0].name).toBe('My Watchlist');
    });

    it('should reject a duplicate email', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: testEmail, password: testPassword });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('User already exists');
    });

    it('should reject invalid email formats', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'not-an-email', password: testPassword });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid email');
    });

    it('should reject short passwords', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: `test2_${Date.now()}@example.com`, password: '123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('at least 6 characters');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return a token for valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe(testEmail);
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testEmail, password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: testPassword });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });
  });
});
