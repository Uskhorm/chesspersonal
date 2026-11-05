import { Chess } from 'chess.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ run: undefined as (() => void | (() => void)) | undefined }));
vi.mock('react', () => ({ useEffect: (run: () => void | (() => void)) => { effects.run = run; } }));
import { parseMoveInput } from '../moveinput';
import { useHotkeys } from '../hotkeys';

const start = new Chess().fen();
function after(...sans: string[]): string {
  const chess = new Chess();
  sans.forEach(san => chess.move(san));
  return chess.fen();
}
function expectMove(fen: string, input: string, uci: string, san?: string) {
  const parsed = parseMoveInput(fen, input);
  expect(parsed).toEqual({ uci, san: san ?? expect.any(String) });
  const chess = new Chess(fen);
  const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  expect(parsed).toEqual({ uci, san: move.san });
}

describe('move input', () => {
  it.each(['Nf3', 'nf3', 'NF3', '  knight to F3  ', 'knight f3', 'N to f3', 'g1f3', 'G1 F3', 'knight from g1 to f3'])('accepts %s', input => {
    expectMove(start, input, 'g1f3', 'Nf3');
  });
  it.each(['e4', 'E4', 'pawn e4', 'pawn to e4', 'e2e4', 'e2 to e4', 'P e4'])('accepts pawn input %s', input => {
    expectMove(start, input, 'e2e4', 'e4');
  });
  it.each(['Nf3?!', 'nf3+', 'knight to f3!'])('tolerates annotations: %s', input => {
    expectMove(start, input, 'g1f3');
  });
  it.each(['exd5', 'E TAKES D5', 'pawn takes on d5', 'takes on d5', 'pawn x d5', 'e4 takes d5', 'e4d5'])('accepts captures: %s', input => {
    expectMove(after('e4', 'd5'), input, 'e4d5', 'exd5');
  });
  it('does not interpret a capture request as a quiet move', () => {
    expect(parseMoveInput(start, 'knight takes f3')).toHaveProperty('error');
  });
  it('accepts en passant', () => {
    expectMove(after('e4', 'a6', 'e5', 'd5'), 'pawn takes on d6', 'e5d6', 'exd6');
  });
  const castles = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  it.each(['O-O', '0-0', 'o-o', 'castle short', 'castle kingside', 'CASTLE KING SIDE', 'castle'])('castles short: %s', input => {
    expectMove(castles, input, 'e1g1', 'O-O');
  });
  it.each(['O-O-O', '0-0-0', 'o-o-o', 'castle long', 'castle queenside', 'CASTLE QUEEN SIDE'])('castles long: %s', input => {
    expectMove(castles, input, 'e1c1', 'O-O-O');
  });
  it('supports black castling', () => {
    expectMove(castles.replace(' w ', ' b '), 'castle long', 'e8c8', 'O-O-O');
  });
  it('rejects blocked castling', () => {
    expect(parseMoveInput(start, 'castle short')).toHaveProperty('error');
  });
  it.each([
    ['knight', 'n', 'b1', 'c3'], ['bishop', 'b', 'c1', 'f4'],
    ['rook', 'r', 'a1', 'a4'], ['queen', 'q', 'd1', 'd4'], ['king', 'k', 'e1', 'f2'],
  ])('accepts the word %s', (word, symbol, from, to) => {
    const chess = new Chess('7k/8/8/8/8/8/8/4K3 w - - 0 1');
    if (symbol !== 'k') chess.put({ type: symbol as 'n' | 'b' | 'r' | 'q', color: 'w' }, from as 'a1');
    expectMove(chess.fen(), `${word} to ${to}`, from + to);
  });
  const promotion = '7k/P7/8/8/8/8/8/4K3 w - - 0 1';
  it.each(['a8=Q', 'a8q', 'a7a8q', 'pawn to a8 promotes to a queen', 'a8 queen'])('accepts promotions: %s', input => {
    expectMove(promotion, input, 'a7a8q', 'a8=Q+');
  });
  it.each(['n', 'b', 'r', 'q'])('supports promotion to %s', piece => {
    expectMove(promotion, `a7a8${piece}`, `a7a8${piece}`);
  });
  it.each(['pawn a8', 'a7a8'])('lists promotion choices for %s instead of silently choosing a queen', input => {
    const parsed = parseMoveInput(promotion, input);
    expect(parsed).toHaveProperty('error');
    if ('error' in parsed) for (const piece of ['queen', 'rook', 'bishop', 'knight']) expect(parsed.error).toContain(piece);
  });
  const ambiguous = '7k/8/8/8/8/8/8/1N2KN2 w - - 0 1';
  it.each(['knight d2', 'nd2', 'to d2'])('lists plain English alternatives for %s', input => {
    const parsed = parseMoveInput(ambiguous, input);
    expect(parsed).toHaveProperty('error');
    if ('error' in parsed) {
      expect(parsed.error).toContain('knight from b1 to d2');
      expect(parsed.error).toContain('knight from f1 to d2');
      expect(parsed.error).not.toContain('Nbd2');
    }
  });
  it.each(['Nbd2', 'nbd2', 'knight b1 to d2', 'b1d2'])('resolves source disambiguation: %s', input => {
    expectMove(ambiguous, input, 'b1d2', 'Nbd2');
  });
  it('excludes pinned pieces from ambiguity', () => {
    expectMove('4r2k/8/8/8/8/8/R3R3/4K3 w - - 0 1', 'rook d2', 'a2d2');
  });
  it('resolves rank disambiguation', () => {
    expectMove('7k/8/8/8/8/R7/8/R3K3 w - - 0 1', 'r1a2', 'a1a2', 'R1a2');
  });
  it('accepts a capture with an underpromotion', () => {
    expectMove('1r5k/P7/8/8/8/8/8/4K3 w - - 0 1', 'pawn takes b8 promotes to a knight', 'a7b8n', 'axb8=N');
  });
  it('rejects a promotion on a non-promotion move', () => {
    expect(parseMoveInput(start, 'e2e4q')).toHaveProperty('error');
  });
  it('accepts checkmate SAN and preserves its canonical suffix', () => {
    expectMove(after('f3', 'e5', 'g4'), 'qh4#', 'd8h4', 'Qh4#');
  });
  it.each(['', '  ', 'hello', 'knight z9', 'e2e5', 'king e4', 'pawn takes e4', 'queen to e4 and then e5'])('returns an error for %j', input => {
    expect(parseMoveInput(start, input)).toHaveProperty('error');
  });
  it('returns an error for an invalid FEN', () => {
    expect(parseMoveInput('invalid', 'e4')).toEqual({ error: 'The board position is invalid.' });
  });
  it('returns errors in a finished game', () => {
    expect(parseMoveInput(after('f3', 'e5', 'g4', 'Qh4#'), 'pawn e4')).toHaveProperty('error');
  });
  it('does not mutate the position across calls', () => {
    expectMove(start, 'e4', 'e2e4');
    expectMove(start, 'd4', 'd2d4');
  });
});

describe('hotkeys', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup(map: Parameters<typeof useHotkeys>[0]) {
    let listener: ((event: KeyboardEvent) => void) | undefined;
    const remove = vi.fn();
    vi.stubGlobal('window', {
      addEventListener: vi.fn((_: string, callback: (event: KeyboardEvent) => void) => { listener = callback; }),
      removeEventListener: remove,
    });
    useHotkeys(map, []);
    const cleanup = effects.run?.();
    const fire = (key: string, extra: object = {}) => {
      const event = { key, composedPath: () => [], preventDefault: vi.fn(), ...extra };
      listener?.(event as unknown as KeyboardEvent);
      return event;
    };
    return { fire, cleanup, remove };
  }
  it.each(['ArrowLeft', 'ArrowRight', ' ', 'h', 'f', 'Escape', '1', '9', '0'])('handles %j and prevents default', key => {
    const handler = vi.fn();
    const { fire } = setup({ [key]: handler });
    const event = fire(key);
    expect(handler).toHaveBeenCalledWith(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it.each([['←', 'ArrowLeft'], ['→', 'ArrowRight'], ['space', ' '], ['esc', 'Escape'], ['h', 'H']])('supports alias %s', (alias, key) => {
    const handler = vi.fn();
    setup({ [alias]: handler }).fire(key);
    expect(handler).toHaveBeenCalledOnce();
  });
  it.each(['ctrlKey', 'metaKey', 'altKey', 'isComposing', 'defaultPrevented'])('ignores %s events', flag => {
    const handler = vi.fn();
    const event = setup({ h: handler }).fire('h', { [flag]: true });
    expect(handler).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('leaves unmapped keys alone and removes the listener on cleanup', () => {
    const { fire, cleanup, remove } = setup({});
    expect(fire('q').preventDefault).not.toHaveBeenCalled();
    if (typeof cleanup === 'function') cleanup();
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
  it.each(['input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]'])('ignores typing in %s', selector => {
    class Element {
      isContentEditable = false;
      closest(selectors: string) { return selectors.split(', ').includes(selector) ? this : null; }
    }
    vi.stubGlobal('HTMLElement', Element);
    const handler = vi.fn();
    setup({ h: handler }).fire('h', { composedPath: () => [new Element()] });
    expect(handler).not.toHaveBeenCalled();
  });
  it('ignores editable descendants in the composed event path', () => {
    class Element { isContentEditable = true; closest() { return null; } }
    vi.stubGlobal('HTMLElement', Element);
    const handler = vi.fn();
    setup({ h: handler }).fire('h', { composedPath: () => [{}, new Element()] });
    expect(handler).not.toHaveBeenCalled();
  });
  it('can run during server rendering without a window', () => {
    vi.stubGlobal('window', undefined);
    useHotkeys({}, []);
    expect(() => effects.run?.()).not.toThrow();
  });
});
