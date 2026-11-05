import { useEffect, useRef, useState } from 'react';
import { AuthError, passkeySupported, signIn, signInConditional, signUp } from '../lib/auth';
import { cloudEnabled } from '../lib/api';
import { fetchProfile } from '../lib/chesscom';
import { useStore } from '../lib/store';
import { shake } from '../lib/fx';
import { sfx } from '../lib/sound';
import { Mark } from '../components/Brand';
import { Board } from '../components/Board';
import { Verdict } from '../components/Verdict';

// A real brilliancy to set the tone: the queen sacrifice from Byrne vs Fischer, 1956 (…Be6!!).
const SHOWCASE_FEN = 'r3r1k1/pp3pbp/1qp1b1p1/2B5/2BP4/Q1n2N2/P4PPP/3R1K1R w - - 1 18';

export function Gate() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'up' | 'in' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  const connect = useStore((s) => s.connect);

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
    shake(formRef.current, 8);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
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
    try {
      const p = await fetchProfile(name.trim());
      connect(p.username, p.avatar, p.name);
    } catch (x) {
      fail(x);
    }
  };

  return (
    <div className="gate">
      <div className="gate-copy">
        <div className="row" style={{ gap: 12 }}>
          <Mark size={40} />
          <span className="wordmark-text" style={{ fontSize: 26 }}>Hindsight</span>
        </div>
        <h1 className="display t-hero">See what you missed.</h1>
        <p className="t-3 quiet measure" style={{ fontWeight: 450 }}>
          Every chess.com game you finish gets reviewed by Stockfish. Every mistake becomes a puzzle you replay until you stop making it.
        </p>

        <form ref={formRef} className="stack" style={{ gap: 14, maxWidth: 440 }} onSubmit={create}>
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
              placeholder="e.g. magnuscarlsen"
            />
          </div>
          {cloudEnabled && supported ? (
            <>
              <button className="key ink big" disabled={!!busy || !name.trim()}>
                {busy === 'up' && <span className="spin" />} Create account with a passkey
              </button>
              <div className="or">already have one</div>
              <button type="button" className="key big" onClick={login} disabled={!!busy}>
                {busy === 'in' && <span className="spin" />} Sign in with your passkey
              </button>
            </>
          ) : (
            <button type="button" className="key ink big" onClick={localOnly}>Continue</button>
          )}
          {err && <p className="err" role="alert">{err}</p>}
        </form>

        <p className="faint t-small measure">
          No password. A passkey is your fingerprint, face or device PIN, and it stays on your device. Your progress syncs to every browser you sign in on.{' '}
          {cloudEnabled && supported && (
            <button type="button" onClick={localOnly} className="link" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', font: 'inherit' }}>
              Use without an account on this device
            </button>
          )}
        </p>
      </div>
      <div className="gate-art" aria-hidden="true">
        <div className="stack" style={{ gap: 16, width: 'min(78%, 520px)' }}>
          <div className="gate-board" style={{ width: '100%' }}>
            <Board fen={SHOWCASE_FEN} orientation="black" lastMove={['g4', 'e6']} badge={{ square: 'e6', cls: 'brilliant' }} />
          </div>
          <Verdict cls="brilliant" san="Be6" moveNo="17…" sub="Byrne vs Fischer, 1956" />
        </div>
      </div>
    </div>
  );
}
