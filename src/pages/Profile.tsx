import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ACHIEVEMENTS, levelFromXp, titleFor, useStore, type Depth } from '../lib/store';
import { db } from '../lib/db';
import { engine } from '../lib/engine';
import { addPasskey, listPasskeys, removePasskey, signOut, useAuth, type Passkey } from '../lib/auth';
import { cloudEnabled } from '../lib/api';
import { syncNow, useCloudSync } from '../lib/cloudsync';
import { useInstallPrompt } from '../lib/pwa';
import { THEMES } from '../components/themes';
import { emit } from '../lib/bus';

function ago(t: number | null | undefined) {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export function Profile() {
  const st = useStore();
  const user = useAuth((s) => s.user);
  const sync = useCloudSync();
  const install = useInstallPrompt();
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const level = levelFromXp(st.xp);
  const activity = useLiveQuery(() => db.activity.toArray(), []) ?? [];
  const byDay = new Map(activity.map((a) => [a.day, a.xp]));
  const days: { day: string; xp: number }[] = [];
  for (let i = 111; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ day: k, xp: byDay.get(k) ?? 0 });
  }

  useEffect(() => {
    if (user) listPasskeys().then(setKeys).catch(() => setKeys([]));
  }, [user]);

  const lastSynced = typeof sync.lastSyncedAt === 'string' ? Date.parse(sync.lastSyncedAt) : (sync.lastSyncedAt as number | null);

  return (
    <div className="page">
      <header className="row" style={{ gap: 20, marginBottom: 8 }}>
        <span className="avatar" style={{ width: 84, height: 84, borderRadius: 22, fontSize: 34 }}>
          {st.avatar ? <img src={st.avatar} alt="" /> : (st.username?.[0] ?? '?').toUpperCase()}
        </span>
        <div>
          <h1 className="display t-1">{st.displayName || st.username}</h1>
          <p className="quiet">
            Level {level}, {titleFor(level)}. {st.xp} XP, best streak {st.streak.best} days, training rating {st.trainingRating}.
          </p>
        </div>
      </header>

      <section className="section today">
        <div className="panel panel-pad">
          <h2 className="t-3">Account</h2>
          {user ? (
            <>
              <p className="quiet t-small" style={{ margin: '4px 0 12px' }}>
                Signed in as {user.username}. Progress is saved to your account and follows you to any browser.
              </p>
              <div className="set-row">
                <span>
                  Sync {sync.status === 'error' ? <b className="err">failed</b> : sync.status === 'offline' ? 'paused while offline' : `last ran ${ago(lastSynced)}`}
                  {sync.pending > 0 && <span className="faint">, {sync.pending} changes waiting</span>}
                </span>
                <button className="key sm" onClick={() => syncNow().catch(() => {})}>Sync now</button>
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <div className="stack" style={{ gap: 6 }}>
                  <span>Passkeys</span>
                  {(keys ?? []).map((k) => (
                    <span key={k.id} className="row t-small quiet" style={{ gap: 8 }}>
                      {k.device_name || 'Passkey'}, added {new Date(k.created_at).toLocaleDateString()}
                      {keys && keys.length > 1 && (
                        <button className="key flat sm danger" onClick={() => removePasskey(k.id).then(() => listPasskeys().then(setKeys))}>Remove</button>
                      )}
                    </span>
                  ))}
                </div>
                <button
                  className="key sm"
                  onClick={() =>
                    addPasskey(navigator.platform || 'This device')
                      .then(() => listPasskeys().then(setKeys))
                      .then(() => emit({ type: 'toast', text: 'Passkey added.', emoji: '✓', tone: 'good' }))
                      .catch((e) => emit({ type: 'toast', text: (e as Error).message, emoji: '!', tone: 'bad' }))
                  }
                >
                  Add a passkey
                </button>
              </div>
              <div className="set-row">
                <span className="quiet">Signing out keeps this device's copy until you clear it.</span>
                <button className="key sm" onClick={() => signOut()}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <p className="quiet" style={{ margin: '4px 0 12px' }}>
                {cloudEnabled ? 'You are using Hindsight without an account, so progress lives only in this browser.' : 'Cloud sync is not configured for this build.'}
              </p>
              {cloudEnabled && (
                <button className="key ink" onClick={() => st.disconnect()}>Create an account to sync</button>
              )}
            </>
          )}
        </div>

        <div className="panel panel-pad">
          <h2 className="t-3">Activity</h2>
          <p className="quiet t-small" style={{ margin: '4px 0 14px' }}>Each square is a day. Darker means more XP.</p>
          <div className="heat" role="img" aria-label="Activity over the last 16 weeks">
            {days.map((d) => (
              <i key={d.day} title={`${d.day}: ${d.xp} XP`} style={{ opacity: d.xp ? 0.25 + Math.min(1, d.xp / 150) * 0.75 : 0.08 }} />
            ))}
          </div>
          {install.canInstall && !install.isStandalone && (
            <div className="set-row" style={{ marginTop: 16 }}>
              <span>Install Hindsight as an app for one-tap training.</span>
              <button className="key sm ink" onClick={() => install.promptInstall()}>Install</button>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="t-2">Achievements</h2><span className="faint t-small">{st.achievements.length} of {ACHIEVEMENTS.length}, each one drops a chest</span></div>
        <div className="badges">
          {ACHIEVEMENTS.map((a) => {
            const got = st.achievements.includes(a.id);
            return (
              <div key={a.id} className={`badge-tile ${got ? 'got' : ''}`}>
                <span className="medal" aria-hidden="true">{a.label.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700, color: got ? 'var(--ink)' : 'var(--ink-3)' }}>{a.label}</span>
                  <span className="t-small quiet">{a.desc}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="t-2">Board</h2><span className="faint t-small">Epic and Legendary chests unlock more</span></div>
        <div className="themes">
          {THEMES.map((t) => {
            const unlocked = t.free || st.unlockedThemes.includes(t.id);
            return (
              <button key={t.id} disabled={!unlocked} className={`theme ${st.settings.boardTheme === t.id ? 'on' : ''}`} onClick={() => st.setSetting('boardTheme', t.id)} aria-pressed={st.settings.boardTheme === t.id}>
                <span className="sw" style={{ backgroundImage: `conic-gradient(${t.dark} 90deg, ${t.light} 90deg 180deg, ${t.dark} 180deg 270deg, ${t.light} 270deg)` }} />
                {unlocked ? t.label : `${t.label}, locked`}
              </button>
            );
          })}
        </div>
      </section>

      <section className="section panel panel-pad">
        <h2 className="t-3">Settings</h2>
        <label className="set-row">
          <span>
            Analysis depth <span className="faint t-small">, {engine.size} engine threads on this device</span>
          </span>
          <select className="input" value={st.settings.depth} onChange={(e) => st.setSetting('depth', Number(e.target.value) as Depth)}>
            <option value={12}>Fast</option>
            <option value={16}>Standard</option>
            <option value={20}>Deep</option>
          </select>
        </label>
        <Toggle label="Review new games automatically" v={st.settings.autoAnalyse} on={(v) => st.setSetting('autoAnalyse', v)} />
        <Toggle label="Sounds" v={st.settings.sound} on={(v) => st.setSetting('sound', v)} />
        <Toggle
          label="Notify me when a game is reviewed"
          v={st.settings.notify}
          on={(v) => {
            st.setSetting('notify', v);
            if (v && 'Notification' in window) Notification.requestPermission();
          }}
        />
        <div className="set-row">
          <span className="quiet">Clear this device's games, reviews and drills. Your account copy is kept.</span>
          <button
            className="key sm danger"
            onClick={async () => {
              if (!confirm('Clear all local data on this device?')) return;
              signOut();
              await db.delete();
              localStorage.clear();
              location.hash = '';
              location.reload();
            }}
          >
            Clear device
          </button>
        </div>
      </section>

      <p className="faint t-small measure" style={{ marginTop: 28 }}>
        Hindsight is open source under GPL-3.0 and is not affiliated with chess.com or Lichess. Built on Stockfish, chess.js, chessground, the Lichess opening book, puzzle and cloud APIs, and the chess.com public API.{' '}
        <a className="link" href="https://github.com/Uskhorm/hindsight" target="_blank" rel="noreferrer">Source code</a>
      </p>
    </div>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <div className="set-row">
      <span>{label}</span>
      <button className={`toggle ${v ? 'on' : ''}`} onClick={() => on(!v)} role="switch" aria-checked={v} aria-label={label}>
        <span className="knob" />
      </button>
    </div>
  );
}
