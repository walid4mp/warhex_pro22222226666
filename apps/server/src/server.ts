import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { ChessAI, ChessEngine, STANDARD_START_FEN } from '../../../packages/shared/src/index';
import { db, initDb } from './db.js';
import { hashPassword, requireAuth, signToken, verifyPassword, verifyToken, type AuthedRequest } from './auth.js';

const PORT = Number(process.env.PORT || 4200);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const ai = new ChessAI();

initDb();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(rateLimit({ windowMs: 60_000, max: 180 }));

const sanitize = (value: string) => value.trim().replace(/[<>]/g, '');
const now = () => new Date().toISOString();

const registerSchema = z.object({
  username: z.string().min(3).max(24),
  email: z.string().email(),
  password: z.string().min(8).max(64),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(64) });
const roomSchema = z.object({
  name: z.string().min(3).max(50),
  visibility: z.enum(['public', 'private', 'password']),
  password: z.string().min(4).max(32).optional(),
  maxPlayers: z.number().min(2).max(16).default(2),
  timeControl: z.string().default('blitz'),
  incrementSeconds: z.number().min(0).max(60).default(0),
});
const moveSchema = z.object({
  from: z.string().length(2),
  to: z.string().length(2),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});

function getUserByEmail(email: string) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
}
function getUserById(id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
}
function getSettings(userId: string) {
  return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) as any;
}
function ensureWallet(userId: string) {
  db.prepare('INSERT OR IGNORE INTO wallets (user_id, updated_at) VALUES (?, ?)').run(userId, now());
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'royal-square-server' });
});

app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const username = sanitize(parsed.data.username);
  const email = sanitize(parsed.data.email.toLowerCase());
  if (getUserByEmail(email)) return res.status(409).json({ message: 'Email already in use' });
  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) return res.status(409).json({ message: 'Username already in use' });

  const id = uuid();
  const timestamp = now();
  const passwordHash = await hashPassword(parsed.data.password);
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, username, email, passwordHash, timestamp, timestamp, timestamp);
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(id);
  ensureWallet(id);

  const token = signToken({ sub: id, username });
  res.status(201).json({ token, user: getUserById(id), settings: getSettings(id) });
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const email = sanitize(parsed.data.email.toLowerCase());
  const user = getUserByEmail(email);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const valid = await verifyPassword(parsed.data.password, user.password_hash);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
  db.prepare('UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), user.id);
  res.json({ token: signToken({ sub: user.id, username: user.username }), user: getUserById(user.id), settings: getSettings(user.id) });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const user = getUserById(req.auth!.sub);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user, settings: getSettings(user.id), wallet: db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(user.id) });
});

app.patch('/api/profile', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({ username: z.string().min(3).max(24).optional(), bio: z.string().max(280).optional(), avatarUrl: z.string().url().optional(), language: z.enum(['ar', 'en', 'fr']).optional(), theme: z.enum(['light', 'dark']).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const user = getUserById(req.auth!.sub);
  const username = parsed.data.username ? sanitize(parsed.data.username) : user.username;
  const bio = parsed.data.bio ? sanitize(parsed.data.bio) : user.bio;
  const avatarUrl = parsed.data.avatarUrl ?? user.avatar_url;
  const language = parsed.data.language ?? user.language;
  const theme = parsed.data.theme ?? user.theme;
  db.prepare('UPDATE users SET username = ?, bio = ?, avatar_url = ?, language = ?, theme = ?, updated_at = ? WHERE id = ?').run(username, bio, avatarUrl, language, theme, now(), user.id);
  res.json({ user: getUserById(user.id) });
});

app.get('/api/leaderboard', (_req, res) => {
  const rows = db.prepare('SELECT id, username, avatar_url, rating, wins, losses, draws, max_streak FROM users ORDER BY rating DESC, wins DESC LIMIT 100').all();
  res.json({ players: rows });
});

app.get('/api/history', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT g.*, wu.username AS white_username, bu.username AS black_username
    FROM games g
    LEFT JOIN users wu ON wu.id = g.white_user_id
    LEFT JOIN users bu ON bu.id = g.black_user_id
    WHERE white_user_id = ? OR black_user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.auth!.sub, req.auth!.sub);
  res.json({ games: rows });
});

app.get('/api/rooms', (_req, res) => {
  const rooms = db.prepare(`
    SELECT r.*, u.username AS host_username,
      (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) AS member_count
    FROM rooms r
    JOIN users u ON u.id = r.host_user_id
    ORDER BY r.created_at DESC
  `).all();
  res.json({ rooms });
});

app.post('/api/rooms', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const data = parsed.data;
  const roomId = uuid();
  const timestamp = now();
  const passwordHash = data.password ? await hashPassword(data.password) : null;
  db.prepare(`
    INSERT INTO rooms (id, host_user_id, name, visibility, password_hash, max_players, status, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)
  `).run(roomId, req.auth!.sub, sanitize(data.name), data.visibility, passwordHash, data.maxPlayers, JSON.stringify({ timeControl: data.timeControl, incrementSeconds: data.incrementSeconds }), timestamp, timestamp);
  db.prepare('INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(roomId, req.auth!.sub, 'host', timestamp);
  res.status(201).json({ room: db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) });
});

app.post('/api/rooms/:roomId/join', requireAuth, async (req: AuthedRequest, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.roomId) as any;
  if (!room) return res.status(404).json({ message: 'Room not found' });
  if (room.visibility === 'password') {
    const password = z.string().min(4).parse(req.body.password);
    const ok = await verifyPassword(password, room.password_hash);
    if (!ok) return res.status(403).json({ message: 'Wrong password' });
  }
  const count = Number((db.prepare('SELECT COUNT(*) as total FROM room_members WHERE room_id = ?').get(room.id) as any).total);
  if (count >= room.max_players) return res.status(409).json({ message: 'Room is full' });
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(room.id, req.auth!.sub, 'member', now());
  res.json({ ok: true });
});

app.get('/api/games/:gameId', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ message: 'Game not found' });
  const moves = db.prepare('SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC').all(req.params.gameId);
  res.json({ game, moves });
});

app.post('/api/games/ai', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({ fen: z.string().default(STANDARD_START_FEN), depth: z.number().min(1).max(3).default(2), color: z.enum(['w', 'b']).default('b') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const engine = new ChessEngine(parsed.data.fen);
  const result = ai.search(engine, parsed.data.depth, parsed.data.color);
  res.json(result);
});

app.post('/api/games/import/fen', (req, res) => {
  const schema = z.object({ fen: z.string().min(10) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const engine = new ChessEngine(parsed.data.fen);
  res.json(engine.exportState());
});

app.post('/api/games/import/pgn', (req, res) => {
  const schema = z.object({ pgn: z.string().min(3) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const engine = new ChessEngine();
  engine.loadPGN(parsed.data.pgn);
  res.json(engine.exportState());
});

const liveGames = new Map<string, { engine: ChessEngine; whiteId?: string; blackId?: string; roomId?: string; timeControl: string; incrementSeconds: number }>();

function expectedScore(ratingA: number, ratingB: number) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}
function updateElo(whiteId: string, blackId: string, scoreWhite: number, gameId: string) {
  const white = getUserById(whiteId);
  const black = getUserById(blackId);
  if (!white || !black) return;
  const k = 24;
  const expectedWhite = expectedScore(white.rating, black.rating);
  const expectedBlack = expectedScore(black.rating, white.rating);
  const newWhite = Math.round(white.rating + k * (scoreWhite - expectedWhite));
  const newBlack = Math.round(black.rating + k * ((1 - scoreWhite) - expectedBlack));
  db.prepare('UPDATE users SET rating = ?, updated_at = ? WHERE id = ?').run(newWhite, now(), whiteId);
  db.prepare('UPDATE users SET rating = ?, updated_at = ? WHERE id = ?').run(newBlack, now(), blackId);
  db.prepare('INSERT INTO ratings (user_id, game_id, before_rating, after_rating, delta, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(whiteId, gameId, white.rating, newWhite, newWhite - white.rating, now());
  db.prepare('INSERT INTO ratings (user_id, game_id, before_rating, after_rating, delta, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(blackId, gameId, black.rating, newBlack, newBlack - black.rating, now());
}

function persistFinishedGame(gameId: string, engine: ChessEngine, whiteId?: string, blackId?: string, result = '*') {
  const status = engine.getStatus();
  const pgn = engine.toPGN({ Result: result });
  db.prepare('UPDATE games SET status = ?, result = ?, final_fen = ?, pgn = ?, move_count = ?, finished_at = ? WHERE id = ?').run(status.checkmate || status.draw ? 'finished' : 'active', result, engine.exportFEN(), pgn, engine.history.length, now(), gameId);
  engine.history.forEach((entry, index) => {
    db.prepare('INSERT INTO moves (game_id, ply, san, from_square, to_square, promotion, fen_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(gameId, index + 1, entry.move.san ?? `${entry.move.from}${entry.move.to}`, entry.move.from, entry.move.to, entry.move.promotion ?? null, entry.fenAfter, now());
  });
  if (whiteId && blackId) {
    if (result === '1-0') updateElo(whiteId, blackId, 1, gameId);
    if (result === '0-1') updateElo(whiteId, blackId, 0, gameId);
    if (result === '1/2-1/2') updateElo(whiteId, blackId, 0.5, gameId);
  }
}

io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth.token || '');
    socket.data.user = verifyToken(token);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const auth = socket.data.user as { sub: string; username: string };
  socket.join(`user:${auth.sub}`);
  io.emit('presence:update', { userId: auth.sub, status: 'online' });

  socket.on('room:join', ({ roomId }) => {
    socket.join(`room:${roomId}`);
  });

  socket.on('chat:send', ({ roomId, receiverUserId, content, scope = 'room', messageType = 'text' }, callback) => {
    const message = {
      id: uuid(),
      roomId: roomId ?? null,
      senderUserId: auth.sub,
      receiverUserId: receiverUserId ?? null,
      scope,
      messageType,
      content: sanitize(String(content || '')),
      createdAt: now(),
    };
    db.prepare('INSERT INTO messages (id, room_id, sender_user_id, receiver_user_id, scope, message_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(message.id, message.roomId, message.senderUserId, message.receiverUserId, message.scope, message.messageType, message.content, message.createdAt);
    if (roomId) io.to(`room:${roomId}`).emit('chat:message', message);
    if (receiverUserId) io.to(`user:${receiverUserId}`).emit('chat:message', message);
    callback?.({ ok: true, message });
  });

  socket.on('voice:signal', ({ targetUserId, payload }) => {
    io.to(`user:${targetUserId}`).emit('voice:signal', { fromUserId: auth.sub, payload });
  });

  socket.on('game:create', ({ roomId, whiteId, blackId, timeControl = 'blitz', incrementSeconds = 0 }, callback) => {
    const gameId = uuid();
    const engine = new ChessEngine();
    liveGames.set(gameId, { engine, whiteId, blackId, roomId, timeControl, incrementSeconds });
    db.prepare('INSERT INTO games (id, white_user_id, black_user_id, mode, status, initial_fen, final_fen, time_control, increment_seconds, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(gameId, whiteId ?? null, blackId ?? null, blackId ? 'online' : 'training', 'active', engine.exportFEN(), engine.exportFEN(), timeControl, incrementSeconds, now(), now());
    if (roomId) db.prepare('UPDATE rooms SET current_game_id = ?, status = ?, updated_at = ? WHERE id = ?').run(gameId, 'playing', now(), roomId);
    callback?.({ ok: true, gameId, state: engine.exportState() });
  });

  socket.on('game:join', ({ gameId }) => {
    socket.join(`game:${gameId}`);
    const live = liveGames.get(gameId);
    if (live) socket.emit('game:state', { gameId, state: live.engine.exportState() });
  });

  socket.on('game:move', ({ gameId, move }, callback) => {
    const live = liveGames.get(gameId);
    if (!live) return callback?.({ ok: false, message: 'Game not found' });
    try {
      const parsedMove = moveSchema.parse(move);
      const result = live.engine.makeMove(parsedMove);
      const status = live.engine.getStatus();
      const payload = { gameId, move: result, state: live.engine.exportState() };
      io.to(`game:${gameId}`).emit('game:update', payload);
      if (status.checkmate || status.draw) {
        const finalResult = status.checkmate ? (live.engine.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2';
        persistFinishedGame(gameId, live.engine, live.whiteId, live.blackId, finalResult);
      }
      callback?.({ ok: true, ...payload });
    } catch (error) {
      callback?.({ ok: false, message: (error as Error).message });
    }
  });

  socket.on('game:resign', ({ gameId }, callback) => {
    const live = liveGames.get(gameId);
    if (!live) return callback?.({ ok: false });
    const result = auth.sub === live.whiteId ? '0-1' : '1-0';
    persistFinishedGame(gameId, live.engine, live.whiteId, live.blackId, result);
    io.to(`game:${gameId}`).emit('game:finished', { gameId, result });
    callback?.({ ok: true, result });
  });

  socket.on('disconnect', () => {
    io.emit('presence:update', { userId: auth.sub, status: 'offline' });
  });
});

if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(PORT, () => {
    console.log(`Royal Square server running on http://localhost:${PORT}`);
  });
}

export { app, httpServer };
