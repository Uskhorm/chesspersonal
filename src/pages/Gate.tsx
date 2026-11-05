import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { AuthError, passkeySupported, signIn, signInConditional, signUp } from '../lib/auth';
import { cloudEnabled } from '../lib/api';
import { fetchProfile } from '../lib/chesscom';
import { useStore } from '../lib/store';
import { shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { usePlayback, type PlaybackStep } from '../lib/playback';
import { Mark } from '../components/Brand';
import { Board } from '../components/Board';
import { ClassIcon } from '../components/ClassIcon';
import { ThemeToggle } from '../components/Topbar';
import { plainLine } from '../components/plain';
import { ease, spring } from '../components/motion';
import { Chess } from 'chess.js';

// Byrne vs Fischer, 1956: 17...Be6!! gives up the queen and wins the game.
const BEFORE = 'r3r1k1/pp3pbp/1qp3p1/2B5/2BP2b1/Q1n2N2/P4PPP/3R1K1R b - - 0 17';
const LINE = ['Be6', 'Bxb6', 'Bxc4+', 'Kg1', 'Ne2+', 'Kf1', 'Nxd4+', 'Kg1', 'Ne2+', 'Kf1', 'Nc3+', 'Kg1', 'axb6'];

function showcaseSteps(): PlaybackStep[] {
  const labels = plainLine(BEFORE, LINE);
  const c = new Chess(BEFORE);
  const steps: PlaybackStep[] = [{ fen: BEFORE, label: 'Black to move. Fischer is 13.' }];
  LINE.forEach((san, i) => {
    const m = c.move(san);
    steps.push({ fen: c.fen(), lastMove: [m.from, m.to], label: labels[i] });
  });
  return steps;
}

export function Gate() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'up' | 'in' | 'local' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  const connect = useStore((s) => s.connect);
  const steps = useMemo(showcaseSteps, []);
  const pb = usePlayback(steps, { interval: 1500, autoplay: true, loop: true });

  useEffect(() => {
    passkeySupported().then(setSupported).catch(() => setSupported(false));
    if (!cloudEnabled) return;
    // Passkey autofill: returning users can just tap the username field.
    const ctrl = new AbortController();
    signInConditional(ctrl.signal).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const fail = (e: unknown) => {
    setErr(e instanceof AuthError ? e.message : (e as Error).message);
    sfx.wrong();
    shake(formRef.current, 6);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!(cloudEnabled && supported)) return localOnly();
    setBusy('up');
    setErr(null);
    try {
      await signUp(name.trim());
      sfx.correct();
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  };

  const login = async () => {
    setBusy('in');
    setErr(null);
    try {
      await signIn();
      sfx.correct();
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  };

  const localOnly = async () => {
    if (!name.trim()) {
      setErr('Type your chess.com username first.');
      return;
    }
    setBusy('local');
    try {
      const p = await fetchProfile(name.trim());
      connect(p.username, p.avatar, p.name);
    } catch (x) {
      fail(x);
    } finally {
      setBusy(null);
    }
  };

  const step = pb.step;
  const showBadge = pb.index === 1;

  return (
    <div className="gate">
      <div className="gate-copy">
        <div className="row between">
          <span className="wordmark">
            <Mark size={32} />
            <span>Hindsight</span>
          </span>
          <ThemeToggle />
        </div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: ease.out }} className="stack" style={{ gap: 16 }}>
          <h1 className="display t-hero" style={{ maxWidth: '12ch' }}>See what you missed.</h1>
          <p className="t-lead quiet measure">
            Every chess.com game you finish gets reviewed by Stockfish on your device. Every mistake becomes a position you replay until you stop making it.
          </p>
        </motion.div>

        <form ref={formRef} className="stack" style={{ gap: 12, maxWidth: 420 }} onSubmit={create}>
          <div className="field">
            <label htmlFor="u">Your chess.com username</label>
            <input
              id="u"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="username webauthn"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. hikaru"
            />
          </div>
          {cloudEnabled && supported ? (
            <>
              <button className="btn primary lg" disabled={!!busy || !name.trim()}>
                {busy === 'up' ? <span className="spinner" /> : <KeyRound />} Create account with a passkey
              </button>
              <div className="or">already have one</div>
              <button type="button" className="btn lg" onClick={login} disabled={!!busy}>
                {busy === 'in' && <span className="spinner" />} Sign in with your passkey
              </button>
            </>
          ) : (
            <button type="submit" className="btn primary lg" disabled={!!busy || !name.trim()}>
              {busy === 'local' ? <span className="spinner" /> : null} Continue <ArrowRight />
            </button>
          )}
          <AnimatePresence>
            {err && (
              <motion.p className="err" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy}>
                {err}
              </motion.p>
            )}
          </AnimatePresence>
        </form>

        <p className="faint t-small measure">
          No password. A passkey is your fingerprint, face or device PIN, and it stays on your device. Your progress syncs to every browser you sign in on.{' '}
          {cloudEnabled && supported && (
            <button type="button" onClick={localOnly} className="link" disabled={!!busy}>
              Use without an account on this device
            </button>
          )}
        </p>
      </div>

      <div className="gate-art" aria-label="Example: Byrne versus Fischer, 1956, playing out on the board">
        <div className="gate-show">
          <div className="player-bar">
            <span className="piece-dot w" /> Donald Byrne
          </div>
          <Board fen={step?.fen ?? BEFORE} orientation="black" lastMove={step?.lastMove} badge={showBadge ? { square: 'e6', cls: 'brilliant' } : null} />
          <div className="player-bar">
            <span className="piece-dot b" /> Bobby Fischer, 13
          </div>
          <div className="card" style={{ padding: '12px 14px', minHeight: 74 }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={pb.index} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring.smooth} className="row nowrap" style={{ gap: 10 }}>
                {showBadge && <ClassIcon cls="brilliant" size={22} />}
                <span className="grow">
                  <span className="strong" style={{ display: 'block' }}>{step?.label}</span>
                  <span className="faint t-small">
                    {showBadge ? 'Brilliant. The queen is left hanging on purpose.' : pb.index === steps.length - 1 ? 'Black ends up with a rook, two bishops and a knight for the queen.' : 'Byrne vs Fischer, 1956'}
                  </span>
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="scrub-track" style={{ height: 3 }} aria-hidden="true">
            <div className="scrub-fill" style={{ transform: `scaleX(${pb.progress})` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
