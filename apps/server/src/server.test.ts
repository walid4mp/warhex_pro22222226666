import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

let app: any;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'sqlite:///home/user/chess-platform/data/test-suite.sqlite';
  const module = await import('./server');
  app = module.app;
});

describe('server api', () => {
  it('registers and authenticates a user', async () => {
    const email = `user${Date.now()}@example.com`;
    const register = await request(app).post('/api/auth/register').send({
      username: `player${Date.now()}`,
      email,
      password: 'StrongPass123',
    });
    expect(register.status).toBe(201);
    expect(register.body.token).toBeTruthy();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${register.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('creates room and returns leaderboard', async () => {
    const email = `room${Date.now()}@example.com`;
    const register = await request(app).post('/api/auth/register').send({
      username: `captain${Date.now()}`,
      email,
      password: 'StrongPass123',
    });
    const token = register.body.token;

    const room = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rapid Arena', visibility: 'public', maxPlayers: 4, timeControl: 'rapid', incrementSeconds: 2 });
    expect(room.status).toBe(201);

    const rooms = await request(app).get('/api/rooms');
    expect(rooms.status).toBe(200);
    expect(rooms.body.rooms.length).toBeGreaterThan(0);

    const leaderboard = await request(app).get('/api/leaderboard');
    expect(leaderboard.status).toBe(200);
  });
});
