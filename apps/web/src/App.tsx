import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChessEngine, STANDARD_START_FEN } from '../../../packages/shared/src/index';
import type { Socket } from 'socket.io-client';
import { ChessBoard } from './components/ChessBoard';
import { VoiceChatPanel } from './components/VoiceChatPanel';
import { api } from './lib/api';
import { getSocket, resetSocket } from './lib/socket';

interface User {
  id: string;
  username: string;
  email: string;
  rating: number;
  bio?: string;
  avatar_url?: string | null;
  theme: 'light' | 'dark';
  language: 'ar' | 'en' | 'fr';
}

interface AuthState {
  token: string | null;
  user: User | null;
}

interface Room {
  id: string;
  name: string;
  visibility: string;
  max_players: number;
  status: string;
  host_username: string;
  member_count: number;
  settings_json: string;
}

function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => ({
    token: localStorage.getItem('royal-token'),
    user: localStorage.getItem('royal-user') ? JSON.parse(localStorage.getItem('royal-user')!) : null,
  }));

  const refresh = async () => {
    if (!auth.token) return;
    const response = await api<{ user: User }>('/api/auth/me', { token: auth.token });
    setAuth((prev) => ({ ...prev, user: response.user }));
    localStorage.setItem('royal-user', JSON.stringify(response.user));
  };

  useEffect(() => {
    if (auth.user?.theme) document.documentElement.dataset.theme = auth.user.theme;
  }, [auth.user?.theme]);

  const login = (token: string, user: User) => {
    localStorage.setItem('royal-token', token);
    localStorage.setItem('royal-user', JSON.stringify(user));
    setAuth({ token, user });
  };

  const logout = () => {
    localStorage.removeItem('royal-token');
    localStorage.removeItem('royal-user');
    resetSocket();
    setAuth({ token: null, user: null });
  };

  return { auth, setAuth, login, logout, refresh };
}

function AppShell({ auth, logout }: { auth: AuthState; logout: () => void }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();

  return (
    <div className="shell">
      <aside className="sidebar card">
        <div>
          <p className="eyebrow">Chess Platform</p>
          <h1>{t('brand')}</h1>
          <p>منصة لعب، غرف، ذكاء اصطناعي، صوت، ودردشة في واجهة موحدة.</p>
        </div>
        <nav className="nav-list">
          <Link className={location.pathname === '/app' ? 'active' : ''} to="/app">اللوبي</Link>
          <Link className={location.pathname === '/app/game' ? 'active' : ''} to="/app/game">اللعب السريع</Link>
          <Link className={location.pathname === '/app/rooms' ? 'active' : ''} to="/app/rooms">الغرف</Link>
          <Link className={location.pathname === '/app/leaderboard' ? 'active' : ''} to="/app/leaderboard">المتصدرين</Link>
          <Link className={location.pathname === '/app/history' ? 'active' : ''} to="/app/history">السجل</Link>
          <Link className={location.pathname === '/app/replay' ? 'active' : ''} to="/app/replay">إعادة اللعب</Link>
          <Link className={location.pathname === '/app/profile' ? 'active' : ''} to="/app/profile">الملف الشخصي</Link>
          <Link className={location.pathname === '/app/settings' ? 'active' : ''} to="/app/settings">الإعدادات</Link>
        </nav>
        <div className="sidebar-footer">
          <label className="field compact">
            <span>اللغة</span>
            <select value={i18n.language} onChange={(event) => i18n.changeLanguage(event.target.value)}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </label>
          <button className="btn secondary" onClick={logout}>{t('logout')}</button>
        </div>
      </aside>
      <main className="page-content">
        <header className="topbar card">
          <div>
            <h2>مرحبًا، {auth.user?.username}</h2>
            <p>تصنيف Elo الحالي: {auth.user?.rating ?? 1200}</p>
          </div>
          <div className="pill-row">
            <span className="pill">Realtime</span>
            <span className="pill">Voice</span>
            <span className="pill">PGN / FEN</span>
          </div>
        </header>
        <Routes>
          <Route index element={<LobbyPage auth={auth} />} />
          <Route path="game" element={<GamePage auth={auth} />} />
          <Route path="rooms" element={<RoomsPage auth={auth} />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="history" element={<HistoryPage token={auth.token!} />} />
          <Route path="replay" element={<ReplayPage />} />
          <Route path="profile" element={<ProfilePage auth={auth} />} />
          <Route path="settings" element={<SettingsPage auth={auth} />} />
        </Routes>
      </main>
    </div>
  );
}

function LandingPage() {
  const { t } = useTranslation();
  return (
    <div className="landing">
      <section className="hero card glow">
        <p className="eyebrow">Production-ready chess platform</p>
        <h1>{t('brand')}</h1>
        <p>
          لعب محلي، ضد الكمبيوتر، أو أونلاين عبر الغرف، مع دعم الصوت، الدردشة، PGN/FEN، إعادة اللعب، ولوحة متصدرين.
        </p>
        <div className="hero-actions">
          <Link className="btn" to="/register">ابدأ الآن</Link>
          <Link className="btn secondary" to="/login">تسجيل الدخول</Link>
        </div>
      </section>
      <section className="feature-grid">
        {[
          ['قواعد FIDE كاملة', 'كش، مات، تعادل، تبييت، أون باسون، ترقية، وتكرار الموقف.'],
          ['ذكاء اصطناعي', 'Minimax + Alpha-Beta مع تقييم مراكز ومستويات متعددة.'],
          ['محادثة وصوت', 'Socket.IO للدردشة و WebRTC للتواصل الصوتي أثناء الغرف والمباراة.'],
          ['تحليلات وReplay', 'استيراد وتصدير PGN/FEN، سجل مباريات، وتنقل خطوة بخطوة.'],
        ].map(([title, body]) => (
          <article key={title} className="card">
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function AuthPage({ mode, onLogin }: { mode: 'login' | 'register'; onLogin: (token: string, user: User) => void }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', email: '', password: '' });

  return (
    <div className="auth-layout">
      <form
        className="card auth-card"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            setLoading(true);
            setError('');
            const response = await api<{ token: string; user: User }>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
              method: 'POST',
              body: JSON.stringify(mode === 'login' ? { email: form.email, password: form.password } : form),
            });
            onLogin(response.token, response.user);
            navigate('/app');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setLoading(false);
          }
        }}
      >
        <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Create account'}</p>
        <h2>{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</h2>
        {mode === 'register' && (
          <label className="field"><span>اسم المستخدم</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        )}
        <label className="field"><span>البريد الإلكتروني</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="field"><span>كلمة المرور</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" disabled={loading}>{loading ? 'جارٍ التنفيذ...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}</button>
        <Link className="text-link" to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'ليس لديك حساب؟' : 'لديك حساب بالفعل؟'}</Link>
      </form>
    </div>
  );
}

function LobbyPage({ auth }: { auth: AuthState }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api<{ rooms: Room[] }>('/api/rooms').then((response) => setRooms(response.rooms));
  }, []);

  return (
    <div className="dashboard-grid">
      <section className="card hero-panel">
        <div>
          <p className="eyebrow">Quick start</p>
          <h3>ابدأ مباراة خلال ثوانٍ</h3>
          <p>اختر بين اللعب المحلي، ضد الذكاء الاصطناعي، أو من داخل غرفة أونلاين.</p>
        </div>
        <div className="inline-actions wrap">
          <button className="btn" onClick={() => navigate('/app/game?mode=local')}>محلي</button>
          <button className="btn secondary" onClick={() => navigate('/app/game?mode=ai')}>ضد الكمبيوتر</button>
          <button className="btn secondary" onClick={() => navigate('/app/rooms')}>إنشاء غرفة</button>
        </div>
      </section>
      <section className="card">
        <div className="section-header"><h3>الغرف الجارية</h3><Link to="/app/rooms">عرض الكل</Link></div>
        <div className="list-grid">
          {rooms.slice(0, 5).map((room) => (
            <article key={room.id} className="list-item">
              <div>
                <strong>{room.name}</strong>
                <p>{room.host_username} · {room.visibility} · {room.member_count}/{room.max_players}</p>
              </div>
              <Link className="btn secondary" to="/app/rooms">فتح</Link>
            </article>
          ))}
          {rooms.length === 0 && <p>لا توجد غرف بعد. أنشئ أول غرفة الآن.</p>}
        </div>
      </section>
      <section className="card">
        <div className="section-header"><h3>ملخص الحساب</h3></div>
        <div className="stats-grid">
          <div><span>اللاعب</span><strong>{auth.user?.username}</strong></div>
          <div><span>Elo</span><strong>{auth.user?.rating ?? 1200}</strong></div>
          <div><span>الوضع</span><strong>{auth.user?.theme === 'dark' ? 'داكن' : 'فاتح'}</strong></div>
        </div>
      </section>
    </div>
  );
}

function GamePage({ auth }: { auth: AuthState }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'local';
  const [fen, setFen] = useState(STANDARD_START_FEN);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [history, setHistory] = useState<string[]>([STANDARD_START_FEN]);
  const [statusText, setStatusText] = useState('جاهز');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ senderUserId: string; content: string }>>([]);
  const [chatText, setChatText] = useState('');
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const engine = useMemo(() => new ChessEngine(fen), [fen]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!auth.token) return;
    const instance = getSocket(auth.token);
    setSocket(instance);
    instance.on('chat:message', (message) => setMessages((prev) => [...prev, message]));
    instance.on('game:update', ({ state, move }: any) => {
      setFen(state.fen);
      setLastMove({ from: move.from, to: move.to });
      setHistory((prev) => [...prev, state.fen]);
      setStatusText(state.status.checkmate ? 'كش مات' : state.status.draw ? 'تعادل' : state.status.inCheck ? 'كش' : 'نقلة ناجحة');
    });
    return () => {
      instance.off('chat:message');
      instance.off('game:update');
    };
  }, [auth.token]);

  const applyLocalMove = async (move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }) => {
    const local = new ChessEngine(fen);
    const result = local.makeMove(move);
    setFen(local.exportFEN());
    setLastMove({ from: result.from, to: result.to });
    setHistory((prev) => [...prev, local.exportFEN()]);
    const status = local.getStatus();
    setStatusText(status.checkmate ? 'كش مات' : status.draw ? 'تعادل' : status.inCheck ? 'كش' : 'دور الطرف الآخر');

    if (mode === 'ai' && !status.checkmate && !status.draw) {
      const response = await api<{ move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' } | null }>('/api/games/ai', {
        method: 'POST',
        token: auth.token,
        body: JSON.stringify({ fen: local.exportFEN(), depth: 2, color: local.turn }),
      });
      if (response.move) {
        const followUp = new ChessEngine(local.exportFEN());
        const aiMove = followUp.makeMove(response.move);
        setFen(followUp.exportFEN());
        setLastMove({ from: aiMove.from, to: aiMove.to });
        setHistory((prev) => [...prev, followUp.exportFEN()]);
        const nextStatus = followUp.getStatus();
        setStatusText(nextStatus.checkmate ? 'الكمبيوتر أنهى المباراة' : nextStatus.inCheck ? 'أنت تحت كش' : 'دورك');
      }
    }

    if (mode === 'online' && socket && gameId) {
      socket.emit('game:move', { gameId, move });
    }
  };

  const startOnline = () => {
    if (!socket || !auth.user) return;
    socket.emit('game:create', { whiteId: auth.user.id, timeControl: 'rapid', incrementSeconds: 2 }, (response: any) => {
      if (response.ok) {
        setGameId(response.gameId);
        socket.emit('game:join', { gameId: response.gameId });
        setStatusText('تم إنشاء مباراة أونلاين');
      }
    });
  };

  const sendMessage = () => {
    if (!socket || !chatText.trim()) return;
    socket.emit('chat:send', { roomId: gameId, content: chatText, scope: 'room' });
    setChatText('');
  };

  const recordVoiceMessage = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    voiceChunksRef.current = [];
    recorder.ondataavailable = (event) => voiceChunksRef.current.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        socket?.emit('chat:send', { roomId: gameId, content: reader.result, scope: 'room', messageType: 'voice' });
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 5000);
  };

  return (
    <div className="game-layout">
      <section className="card board-panel">
        <div className="section-header">
          <div>
            <h3>ساحة اللعب</h3>
            <p>{mode === 'local' ? 'محلي لاعب ضد لاعب' : mode === 'ai' ? 'لعب ضد الكمبيوتر' : 'مباراة أونلاين'}</p>
          </div>
          <div className="inline-actions wrap">
            {mode === 'online' && <button className="btn secondary" onClick={startOnline}>بدء مباراة أونلاين</button>}
            <button className="btn secondary" onClick={() => navigator.clipboard.writeText(new ChessEngine(fen).toPGN())}>نسخ PGN</button>
            <button className="btn secondary" onClick={() => navigator.clipboard.writeText(fen)}>نسخ FEN</button>
          </div>
        </div>
        <ChessBoard fen={fen} lastMove={lastMove} onMove={applyLocalMove} />
        <div className="stats-grid board-info">
          <div><span>الدور</span><strong>{engine.turn === 'w' ? 'الأبيض' : 'الأسود'}</strong></div>
          <div><span>الوضع</span><strong>{statusText}</strong></div>
          <div><span>عدد النقلات</span><strong>{engine.history.length}</strong></div>
        </div>
      </section>
      <section className="side-stack">
        <section className="card">
          <div className="section-header"><h3>الدردشة</h3><button className="btn secondary" onClick={recordVoiceMessage}>رسالة صوتية</button></div>
          <div className="chat-box">
            {messages.map((message, index) => (
              <div key={`${message.senderUserId}-${index}`} className="chat-item">
                <strong>{message.senderUserId === auth.user?.id ? 'أنت' : 'لاعب'}</strong>
                {String(message.content).startsWith('data:audio') ? <audio controls src={message.content} /> : <p>{message.content}</p>}
              </div>
            ))}
          </div>
          <div className="inline-actions">
            <input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="اكتب رسالة..." />
            <button className="btn" onClick={sendMessage}>إرسال</button>
          </div>
        </section>
        <VoiceChatPanel socket={socket} targetUserId={targetUserId} />
        <section className="card">
          <div className="section-header"><h3>تحكم بالصوت</h3></div>
          <label className="field compact"><span>معرّف اللاعب المستهدف</span><input value={targetUserId ?? ''} onChange={(event) => setTargetUserId(event.target.value)} placeholder="ضع user id" /></label>
          <p>ضع معرف اللاعب الآخر لتفعيل WebRTC بينكما أثناء التجربة المحلية.</p>
        </section>
      </section>
    </div>
  );
}

function RoomsPage({ auth }: { auth: AuthState }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [form, setForm] = useState({ name: '', visibility: 'public', password: '', maxPlayers: 2, timeControl: 'blitz', incrementSeconds: 0 });
  const [feedback, setFeedback] = useState('');

  const loadRooms = () => api<{ rooms: Room[] }>('/api/rooms').then((response) => setRooms(response.rooms));
  useEffect(() => { loadRooms(); }, []);

  return (
    <div className="two-column">
      <section className="card">
        <div className="section-header"><h3>إنشاء غرفة</h3></div>
        <div className="form-grid">
          <label className="field"><span>اسم الغرفة</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field"><span>النوع</span><select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}><option value="public">عامة</option><option value="private">خاصة</option><option value="password">بكلمة مرور</option></select></label>
          {form.visibility === 'password' && <label className="field"><span>كلمة المرور</span><input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>}
          <label className="field"><span>عدد اللاعبين</span><input type="number" min={2} max={16} value={form.maxPlayers} onChange={(event) => setForm({ ...form, maxPlayers: Number(event.target.value) })} /></label>
          <label className="field"><span>نوع الوقت</span><select value={form.timeControl} onChange={(event) => setForm({ ...form, timeControl: event.target.value })}><option>bullet</option><option>blitz</option><option>rapid</option><option>classical</option><option>custom</option></select></label>
          <label className="field"><span>Increment</span><input type="number" min={0} max={60} value={form.incrementSeconds} onChange={(event) => setForm({ ...form, incrementSeconds: Number(event.target.value) })} /></label>
        </div>
        <button className="btn" onClick={async () => {
          await api('/api/rooms', { method: 'POST', token: auth.token, body: JSON.stringify(form) });
          setFeedback('تم إنشاء الغرفة');
          loadRooms();
        }}>إنشاء</button>
        {feedback && <p>{feedback}</p>}
      </section>
      <section className="card">
        <div className="section-header"><h3>اللوبي</h3></div>
        <div className="list-grid">
          {rooms.map((room) => (
            <article key={room.id} className="list-item">
              <div>
                <strong>{room.name}</strong>
                <p>{room.host_username} · {room.visibility} · {room.status}</p>
              </div>
              <button className="btn secondary" onClick={async () => {
                await api(`/api/rooms/${room.id}/join`, { method: 'POST', token: auth.token, body: JSON.stringify(room.visibility === 'password' ? { password: prompt('كلمة المرور') || '' } : {}) });
                setFeedback(`تم الانضمام إلى ${room.name}`);
              }}>انضمام</button>
            </article>
          ))}
          {rooms.length === 0 && <p>لا يوجد غرف حالياً.</p>}
        </div>
      </section>
    </div>
  );
}

function LeaderboardPage() {
  const [players, setPlayers] = useState<User[]>([]);
  useEffect(() => {
    api<{ players: User[] }>('/api/leaderboard').then((response) => setPlayers(response.players));
  }, []);
  return (
    <section className="card">
      <div className="section-header"><h3>لوحة المتصدرين</h3></div>
      <div className="table-like">
        {players.map((player, index) => (
          <div key={player.id} className="table-row">
            <span>#{index + 1}</span>
            <strong>{player.username}</strong>
            <span>{player.rating}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryPage({ token }: { token: string }) {
  const [games, setGames] = useState<any[]>([]);
  useEffect(() => {
    api<{ games: any[] }>('/api/history', { token }).then((response) => setGames(response.games));
  }, [token]);
  return (
    <section className="card">
      <div className="section-header"><h3>سجل المباريات</h3></div>
      <div className="list-grid">
        {games.map((game) => (
          <article key={game.id} className="list-item vertical">
            <strong>{game.white_username || 'White'} vs {game.black_username || 'Black'}</strong>
            <p>{game.time_control} · {game.result} · {game.status}</p>
            <code>{game.final_fen}</code>
          </article>
        ))}
        {games.length === 0 && <p>لا توجد مباريات محفوظة بعد.</p>}
      </div>
    </section>
  );
}

function ReplayPage() {
  const [input, setInput] = useState('');
  const [fens, setFens] = useState<string[]>([STANDARD_START_FEN]);
  const [index, setIndex] = useState(0);
  return (
    <div className="two-column">
      <section className="card board-panel">
        <div className="section-header"><h3>إعادة اللعب والتحليل</h3></div>
        <ChessBoard fen={fens[index] ?? STANDARD_START_FEN} interactive={false} />
        <div className="inline-actions wrap">
          <button className="btn secondary" onClick={() => setIndex(0)}>البداية</button>
          <button className="btn secondary" onClick={() => setIndex((value) => Math.max(0, value - 1))}>السابق</button>
          <button className="btn secondary" onClick={() => setIndex((value) => Math.min(fens.length - 1, value + 1))}>التالي</button>
          <button className="btn secondary" onClick={() => setIndex(fens.length - 1)}>النهاية</button>
        </div>
      </section>
      <section className="card">
        <div className="section-header"><h3>استيراد PGN أو FEN</h3></div>
        <textarea rows={12} value={input} onChange={(event) => setInput(event.target.value)} placeholder="ألصق PGN أو FEN هنا" />
        <div className="inline-actions wrap">
          <button className="btn" onClick={() => {
            const text = input.trim();
            if (text.includes('/')) {
              const engine = new ChessEngine(text);
              setFens([engine.exportFEN()]);
              setIndex(0);
              return;
            }
            const engine = new ChessEngine();
            engine.loadPGN(text);
            setFens([STANDARD_START_FEN, ...engine.history.map((entry) => entry.fenAfter)]);
            setIndex(0);
          }}>تحميل</button>
          <button className="btn secondary" onClick={() => navigator.clipboard.writeText(fens[index] ?? STANDARD_START_FEN)}>نسخ FEN الحالي</button>
        </div>
      </section>
    </div>
  );
}

function ProfilePage({ auth }: { auth: AuthState }) {
  const [bio, setBio] = useState(auth.user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(auth.user?.avatar_url ?? '');
  const [message, setMessage] = useState('');
  return (
    <section className="card">
      <div className="section-header"><h3>الملف الشخصي</h3></div>
      <div className="form-grid">
        <label className="field"><span>اسم المستخدم</span><input value={auth.user?.username ?? ''} readOnly /></label>
        <label className="field"><span>الصورة الشخصية</span><input value={avatarUrl ?? ''} onChange={(event) => setAvatarUrl(event.target.value)} /></label>
        <label className="field stretch"><span>النبذة</span><textarea rows={4} value={bio} onChange={(event) => setBio(event.target.value)} /></label>
      </div>
      <button className="btn" onClick={async () => {
        await api('/api/profile', { method: 'PATCH', token: auth.token, body: JSON.stringify({ bio, avatarUrl }) });
        setMessage('تم تحديث الملف الشخصي');
      }}>حفظ</button>
      {message && <p>{message}</p>}
    </section>
  );
}

function SettingsPage({ auth }: { auth: AuthState }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(auth.user?.theme ?? 'dark');
  const [language, setLanguage] = useState<'ar' | 'en' | 'fr'>(auth.user?.language ?? 'ar');
  const [boardTheme, setBoardTheme] = useState('classic');
  const [moveInput, setMoveInput] = useState('drag');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <section className="card">
      <div className="section-header"><h3>الإعدادات</h3></div>
      <div className="form-grid">
        <label className="field"><span>المظهر</span><select value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark')}><option value="dark">داكن</option><option value="light">فاتح</option></select></label>
        <label className="field"><span>اللغة</span><select value={language} onChange={(event) => setLanguage(event.target.value as 'ar' | 'en' | 'fr')}><option value="ar">العربية</option><option value="en">English</option><option value="fr">Français</option></select></label>
        <label className="field"><span>ألوان الرقعة</span><select value={boardTheme} onChange={(event) => setBoardTheme(event.target.value)}><option value="classic">Classic</option><option value="forest">Forest</option><option value="midnight">Midnight</option></select></label>
        <label className="field"><span>طريقة التحريك</span><select value={moveInput} onChange={(event) => setMoveInput(event.target.value)}><option value="drag">سحب وإفلات</option><option value="click">نقر</option></select></label>
      </div>
      <button className="btn" onClick={async () => {
        await api('/api/profile', { method: 'PATCH', token: auth.token, body: JSON.stringify({ theme, language }) });
        setSaved(true);
      }}>حفظ الإعدادات</button>
      {saved && <p>تم حفظ الإعدادات.</p>}
    </section>
  );
}

export default function App() {
  const { auth, login, logout } = useAuth();

  return (
    <Routes>
      <Route path="/" element={auth.token ? <Navigate to="/app" replace /> : <LandingPage />} />
      <Route path="/login" element={auth.token ? <Navigate to="/app" replace /> : <AuthPage mode="login" onLogin={login} />} />
      <Route path="/register" element={auth.token ? <Navigate to="/app" replace /> : <AuthPage mode="register" onLogin={login} />} />
      <Route path="/app/*" element={auth.token ? <AppShell auth={auth} logout={logout} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
