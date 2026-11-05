import { motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ACHIEVEMENTS, BOARD_THEMES, levelFromXp, titleFor, useStore, type Depth } from '../lib/store';
import { db } from '../lib/db';
import { engine } from '../lib/engine';

export function Profile() {
  const st = useStore();
  const level = levelFromXp(st.xp);
  const activity = useLiveQuery(() => db.activity.toArray(), []) ?? [];
  const byDay = new Map(activity.map((a) => [a.day, a.xp]));
  const days: { day: string; xp: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ day: k, xp: byDay.get(k) ?? 0 });
  }

  return (
    <div className="page profile">
      <section className="card profile-head">
        {st.avatar ? <img className="pf-avatar" src={st.avatar} alt="" /> : <div className="pf-avatar fallback">{st.username?.[0]}</div>}
        <div>
          <h1 className="h1">{st.displayName || st.username}</h1>
          <div className="muted">Level {level} · {titleFor(level)} · {st.xp} XP total</div>
          <div className="pf-stats">
            <span>🔥 {st.streak.count} day streak (best {st.streak.best})</span>
            <span>⚡ {st.trainingRating} training rating</span>
            <span>🧩 {st.stats.drillsSolved} solved</span>
            <span>🔍 {st.stats.gamesReviewed} games reviewed</span>
            <span>⏱️ Rush best {st.stats.rushBest}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Activity</h2><span className="muted">last 12 weeks</span></div>
        <div className="heatmap">
          {days.map((d) => (
            <span key={d.day} title={`${d.day}: ${d.xp} XP`} className="hm" style={{ opacity: d.xp ? 0.25 + Math.min(1, d.xp / 150) * 0.75 : 0.08 }} />
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Achievements</h2><span className="muted">{st.achievements.length}/{ACHIEVEMENTS.length} · each one drops a chest</span></div>
        <div className="ach-grid">
          {ACHIEVEMENTS.map((a, i) => {
            const got = st.achievements.includes(a.id);
            return (
              <motion.div key={a.id} className={`ach ${got ? 'got' : ''}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }} whileHover={{ scale: 1.06, rotate: got ? 2 : 0 }}>
                <span className="ach-emoji">{got ? a.emoji : '🔒'}</span>
                <span className="ach-label">{a.label}</span>
                <span className="muted small">{a.desc}</span>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Board themes</h2><span className="muted">unlock more from Epic & Legendary chests</span></div>
        <div className="theme-grid">
          {BOARD_THEMES.map((t) => {
            const unlocked = st.unlockedThemes.includes(t.id);
            return (
              <button key={t.id} disabled={!unlocked} className={`theme ${st.settings.boardTheme === t.id ? 'on' : ''}`} onClick={() => st.setSetting('boardTheme', t.id)}>
                <span className="theme-swatch" style={{ background: `conic-gradient(${t.dark} 90deg, ${t.light} 90deg 180deg, ${t.dark} 180deg 270deg, ${t.light} 270deg)`, backgroundSize: '50% 50%' }} />
                <span>{unlocked ? t.label : '🔒 ' + t.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card settings">
        <div className="card-head"><h2>Settings</h2></div>
        <label className="setting">
          <span>
            Analysis depth
            <span className="muted small"> · {engine.size} parallel Stockfish workers on this device</span>
          </span>
          <select value={st.settings.depth} onChange={(e) => st.setSetting('depth', Number(e.target.value) as Depth)}>
            <option value={12}>Fast (12)</option>
            <option value={16}>Standard (16)</option>
            <option value={20}>Deep (20)</option>
          </select>
        </label>
        <Toggle label="Auto-review new games as you finish them" v={st.settings.autoAnalyse} on={(v) => st.setSetting('autoAnalyse', v)} />
        <Toggle label="Sound effects" v={st.settings.sound} on={(v) => st.setSetting('sound', v)} />
        <Toggle
          label="Desktop notification when a game is reviewed"
          v={st.settings.notify}
          on={(v) => {
            st.setSetting('notify', v);
            if (v && 'Notification' in window) Notification.requestPermission();
          }}
        />
        <div className="row gap">
          <button
            className="btn ghost"
            onClick={async () => {
              if (!confirm('Re-analyse will clear stored analyses (drills are kept). Continue?')) return;
              await db.analyses.clear();
              await db.games.toCollection().modify({ analysed: false });
            }}
          >
            Clear analyses
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('Disconnect and delete all local data?')) return;
              await db.delete();
              localStorage.clear();
              location.hash = '';
              location.reload();
            }}
          >
            Disconnect & reset
          </button>
        </div>
      </section>

      <section className="card about">
        <h2>About</h2>
        <p className="muted small">
          ChessPersonal is open source (GPL-3.0). It is built on <a className="link" href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noreferrer">Stockfish.js</a> (Stockfish 19 WASM),{' '}
          <a className="link" href="https://github.com/jhlywa/chess.js" target="_blank" rel="noreferrer">chess.js</a>,{' '}
          <a className="link" href="https://github.com/lichess-org/chessground" target="_blank" rel="noreferrer">chessground</a>, the{' '}
          <a className="link" href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noreferrer">lichess opening book</a>, the Lichess cloud-eval & puzzle APIs, the chess.com Published-Data API, and{' '}
          <a className="link" href="https://animejs.com" target="_blank" rel="noreferrer">anime.js</a>. It is not affiliated with chess.com or Lichess.
        </p>
      </section>
    </div>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="setting">
      <span>{label}</span>
      <button className={`toggle ${v ? 'on' : ''}`} onClick={() => on(!v)} aria-pressed={v}>
        <motion.span layout className="knob" transition={{ type: 'spring', stiffness: 600, damping: 30 }} />
      </button>
    </label>
  );
}
