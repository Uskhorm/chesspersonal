import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { fetchProfile, type ChessComProfile } from '../lib/chesscom';
import { useStore } from '../lib/store';
import { confettiBurst, shake, staggerIn } from '../lib/fx';
import { sfx } from '../lib/sound';
import { ClassIcon } from '../components/ClassIcon';
import type { Classification } from '../lib/types';

const SHOWCASE: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export function Connect() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profile, setProfile] = useState<ChessComProfile | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const connect = useStore((s) => s.connect);

  useEffect(() => {
    staggerIn(document.querySelectorAll('.hero-stagger'), 70);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const p = await fetchProfile(name.trim());
      setProfile(p);
      sfx.correct();
      confettiBurst(['#ffd34d', '#1fd1b9', '#5b8def'], 1);
    } catch (e) {
      setErr((e as Error).message);
      sfx.wrong();
      shake(formRef.current);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="connect">
      <div className="connect-bg" />
      <div className="connect-inner">
        <div className="hero-stagger eyebrow">OPEN-SOURCE GAME REVIEW + TRAINING</div>
        <h1 className="hero-stagger hero-title">
          Turn every game you lose
          <br />
          into <span className="grad">Elo you keep.</span>
        </h1>
        <p className="hero-stagger hero-sub">
          Stockfish 19 reviews your chess.com games the moment you finish them. Every mistake becomes a flashcard you drill on
          spaced repetition until you stop making it.
        </p>
        <div className="hero-stagger class-strip">
          {SHOWCASE.map((c, i) => (
            <motion.div key={c} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.5 + i * 0.06, type: 'spring', stiffness: 400, damping: 14 }} whileHover={{ scale: 1.3, rotate: 10 }}>
              <ClassIcon cls={c} size={34} />
            </motion.div>
          ))}
        </div>

        {!profile ? (
          <form ref={formRef} className="hero-stagger connect-form" onSubmit={submit}>
            <input autoFocus placeholder="Your chess.com username" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            <button className="btn primary big" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Connect →'}
            </button>
          </form>
        ) : (
          <motion.div className="profile-card" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }}>
            {profile.avatar ? <img src={profile.avatar} alt="" /> : <div className="avatar-fallback">{profile.username[0]}</div>}
            <div>
              <div className="pc-name">{profile.name || profile.username}</div>
              <div className="muted">@{profile.username}</div>
            </div>
            <button className="btn primary big" onClick={() => connect(profile.username, profile.avatar, profile.name)}>
              That's me — let's go
            </button>
          </motion.div>
        )}
        {err && <div className="err">{err}</div>}
        <p className="hero-stagger fine">
          No password needed. Your games are read from chess.com's public API by username, and everything is analysed and stored
          on your own device.
        </p>
      </div>
    </div>
  );
}
