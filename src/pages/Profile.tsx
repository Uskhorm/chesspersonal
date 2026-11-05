import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, KeyRound, LogOut, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ACHIEVEMENTS, levelFromXp, titleFor, useStore, type Depth } from '../lib/store';
import { db } from '../lib/db';
import { engine } from '../lib/engine';
import { addPasskey, listPasskeys, removePasskey, signOut, useAuth, type Passkey } from '../lib/auth';
import { cloudEnabled } from '../lib/api';
import { syncNow, useCloudSync } from '../lib/cloudsync';
import { useInstallPrompt } from '../lib/pwa';
import { useTheme, type Theme } from '../lib/theme';
import { THEMES } from '../components/themes';
import { Medal } from '../components/Medal';
import { Seg } from '../components/Seg';
import { emit } from '../lib/bus';

function ago(t: number | null | undefined) {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function Profile() {
  const st = useStore();
  const user = useAuth((s) => s.user);
  const sync = useCloudSync();
  const install = useInstallPrompt();
  const { theme, setTheme } = useTheme();
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const level = levelFromXp(st.xp);
  const activity = useLiveQuery(() => db.activity.toArray(), []) ?? [];
  const byDay = new Map(activity.map((a) => [a.day, a.xp]));
  // 18 weeks, aligned so each column is a week starting Sunday.
  const days: { day: string; xp: number }[] = [];
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 7 * 17 - end.getDay());
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    days.push({ day: k, xp: byDay.get(k) ?? 0 });
  }
  const level4 = (xp: number) => (xp <= 0 ? 0 : xp < 20 ? 1 : xp < 60 ? 2 : xp < 120 ? 3 : 4);

  useEffect(() => {
    if (user) listPasskeys().then(setKeys).catch(() => setKeys([]));
  }, [user]);

  const lastSynced = typeof sync.lastSyncedAt === 'string' ? Date.parse(sync.lastSyncedAt) : (sync.lastSyncedAt as number | null);

  return (
    <div className="page">
      <header className="profile-head">
        <span className="avatar">{st.avatar ? <img src={st.avatar} alt="" /> : (st.username?.[0] ?? '?').toUpperCase()}</span>
        <div>
          <h1 className="display t-1">{st.displayName || st.username}</h1>
          <p className="quiet" style={{ marginTop: 6 }}>
            Level {level}, {titleFor(level)}. <span className="num">{st.xp}</span> XP, best streak <span className="num">{st.streak.best}</span> days, training rating <span className="num">{st.trainingRating}</span>.
          </p>
        </div>
      </header>

      <div className="cols-even">
        <section className="card card-pad" aria-labelledby="acct-h">
          <h2 id="acct-h" className="t-3">Account</h2>
          {user ? (
            <>
              <p className="faint t-small" style={{ margin: '4px 0 8px' }}>
                Signed in as {user.username}. Progress follows you to any browser you sign in on.
              </p>
              <div className="set-row">
                <span className="lbl">
                  Sync
                  <small>
                    {sync.status === 'error' ? 'Last sync failed' : sync.status === 'offline' ? 'Paused while offline' : `Last ran ${ago(lastSynced)}`}
                    {sync.pending > 0 ? `, ${sync.pending} changes waiting` : ''}
                  </small>
                </span>
                <button className="btn sm" onClick={() => syncNow().catch(() => {})}>
                  <RefreshCw /> Sync now
                </button>
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <span className="lbl">
                  Passkeys
                  {(keys ?? []).map((k) => (
                    <small key={k.id} className="row" style={{ gap: 8 }}>
                      <KeyRound size={13} /> {k.device_name || 'Passkey'}, added {new Date(k.created_at).toLocaleDateString()}
                      {keys && keys.length > 1 && (
                        <button className="btn ghost sm danger" onClick={() => removePasskey(k.id).then(() => listPasskeys().then(setKeys))} aria-label={`Remove passkey ${k.device_name || ''}`}>
                          Remove
                        </button>
                      )}
                    </small>
                  ))}
                </span>
                <button
                  className="btn sm"
                  onClick={() =>
                    addPasskey(navigator.platform || 'This device')
                      .then(() => listPasskeys().then(setKeys))
                      .then(() => emit({ type: 'toast', text: 'Passkey added.', tone: 'good' }))
                      .catch((e) => emit({ type: 'toast', text: (e as Error).message, tone: 'bad' }))
                  }
                >
                  <Plus /> Add a passkey
                </button>
              </div>
              <div className="set-row">
                <span className="lbl">
                  Sign out
                  <small>This device keeps its copy until you clear it.</small>
                </span>
                <button className="btn sm" onClick={() => signOut()}>
                  <LogOut /> Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="quiet" style={{ margin: '6px 0 14px' }}>
                {cloudEnabled ? 'You are using Hindsight without an account, so progress lives only in this browser.' : 'Cloud sync is not configured for this build.'}
              </p>
              {cloudEnabled && (
                <button className="btn primary" onClick={() => st.disconnect()}>
                  <KeyRound /> Create an account to sync
                </button>
              )}
            </>
          )}
        </section>

        <section className="card card-pad" aria-labelledby="act-h">
          <h2 id="act-h" className="t-3">Activity</h2>
          <p className="faint t-small" style={{ margin: '4px 0 14px' }}>Each square is a day. Greener means more XP.</p>
          <div className="heat" role="img" aria-label={`Activity over the last 18 weeks: ${days.filter((d) => d.xp > 0).length} active days`}>
            {days.map((d) => (
              <i key={d.day} title={`${d.day}: ${d.xp} XP`} data-l={level4(d.xp)} />
            ))}
          </div>
          {install.canInstall && !install.isStandalone && (
            <div className="set-row" style={{ marginTop: 12 }}>
              <span className="lbl">
                Install Hindsight
                <small>One tap to train, works offline.</small>
              </span>
              <button className="btn sm primary" onClick={() => install.promptInstall()}>
                <Download /> Install
              </button>
            </div>
          )}
        </section>
      </div>

      <section className="section" aria-labelledby="look-h">
        <div className="section-head">
          <h2 id="look-h" className="t-2">Appearance</h2>
        </div>
        <div className="card card-pad stack" style={{ gap: 20 }}>
          <div className="stack" style={{ gap: 10 }}>
            <span className="strong">Theme</span>
            <div className="theme-pick" role="group" aria-label="Theme">
              {(
                [
                  ['system', 'Match device'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ] as [Theme, string][]
              ).map(([k, label]) => (
                <button key={k} aria-pressed={theme === k} onClick={() => setTheme(k)}>
                  <span className="prev" aria-hidden="true">
                    {k === 'system' ? (
                      <>
                        <span className="l" />
                        <span className="d" />
                      </>
                    ) : (
                      <span className={k === 'light' ? 'l' : 'd'} style={{ gridColumn: 'span 2' }} />
                    )}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <span className="strong">
              Board <span className="faint t-small" style={{ fontWeight: 500 }}>Epic and Legendary chests unlock more</span>
            </span>
            <div className="themes">
              {THEMES.map((t) => {
                const unlocked = t.free || st.unlockedThemes.includes(t.id);
                return (
                  <button key={t.id} disabled={!unlocked} className="theme" onClick={() => st.setSetting('boardTheme', t.id)} aria-pressed={st.settings.boardTheme === t.id} aria-label={unlocked ? `${t.label} board` : `${t.label} board, locked`}>
                    <span className="sw" style={{ backgroundImage: `conic-gradient(${t.dark} 90deg, ${t.light} 90deg 180deg, ${t.dark} 180deg 270deg, ${t.light} 270deg)` }} />
                    {unlocked ? t.label : `${t.label}, locked`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="set-h">
        <div className="section-head">
          <h2 id="set-h" className="t-2">Settings</h2>
        </div>
        <div className="card card-pad">
          <div className="set-row">
            <span className="lbl">
              Analysis depth
              <small>{engine.size} engine threads on this device</small>
            </span>
            <Seg
              label="Analysis depth"
              value={String(st.settings.depth) as '12' | '16' | '20'}
              options={[
                ['12', 'Fast'],
                ['16', 'Standard'],
                ['20', 'Deep'],
              ]}
              onChange={(v) => st.setSetting('depth', Number(v) as Depth)}
            />
          </div>
          <Toggle label="Review new games automatically" sub="Your last 10 games are reviewed as soon as they sync." v={st.settings.autoAnalyse} on={(v) => st.setSetting('autoAnalyse', v)} />
          <Toggle label="Sounds" sub="Piece moves, captures and answer chimes." v={st.settings.sound} on={(v) => st.setSetting('sound', v)} />
          <Toggle
            label="Notify me when a game is reviewed"
            v={st.settings.notify}
            on={(v) => {
              st.setSetting('notify', v);
              if (v && 'Notification' in window) Notification.requestPermission();
            }}
          />
          <div className="set-row">
            <span className="lbl">
              Clear this device
              <small>Removes games, reviews and drills stored here. Your account copy is kept.</small>
            </span>
            <button
              className="btn sm danger"
              onClick={async () => {
                if (!confirm('Clear all local data on this device?')) return;
                signOut();
                await db.delete();
                localStorage.clear();
                location.hash = '';
                location.reload();
              }}
            >
              <Trash2 /> Clear device
            </button>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="ach-h">
        <div className="section-head">
          <h2 id="ach-h" className="t-2">Achievements</h2>
          <span className="faint t-small num">
            {st.achievements.length} of {ACHIEVEMENTS.length}, each one drops a chest
          </span>
        </div>
        <div className="badges">
          {ACHIEVEMENTS.map((a) => {
            const got = st.achievements.includes(a.id);
            return (
              <div key={a.id} className={`badge-tile ${got ? 'got' : ''}`}>
                <Medal id={a.id} got={got} />
                <span>
                  <span className="t">{a.label}</span>
                  <span className="t-small faint">{a.desc}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <p className="faint t-small measure" style={{ marginTop: 40 }}>
        Hindsight is open source under GPL-3.0 and is not affiliated with chess.com or Lichess. Built on Stockfish, chess.js, chessground, the Lichess opening book, puzzle and cloud APIs, and the chess.com public API.{' '}
        <a className="link" href="https://github.com/Uskhorm/hindsight" target="_blank" rel="noreferrer">
          Source code
        </a>
      </p>
    </div>
  );
}

function Toggle({ label, sub, v, on }: { label: string; sub?: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <div className="set-row">
      <span className="lbl">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      <button className="switch" onClick={() => on(!v)} role="switch" aria-checked={v} aria-label={label}>
        <span className="knob" />
      </button>
    </div>
  );
}
