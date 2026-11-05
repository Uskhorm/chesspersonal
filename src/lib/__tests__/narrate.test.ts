import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { describeLine, describeMove, pieceName, squareName } from '../narrate';

const start = new Chess().fen();
const capture = '4k3/8/4p3/3Q4/8/8/8/4K3 w - - 0 1';
const castles = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

describe('describeMove', () => {
  it('resolves SAN and UCI to identical full prose', () => {
    for (const move of ['Qxe6+', 'd5e6']) {
      expect(describeMove(capture, move, { perspective: 'w' }))
        .toBe('Your queen takes the pawn on e6, check');
    }
  });

  it('uses perspective and side names correctly', () => {
    expect(describeMove(start, 'Nf3', { perspective: 'b' })).toBe('Their knight jumps to f3');
    expect(describeMove(start, 'Nf3')).toBe("White's knight jumps to f3");
    expect(describeMove(start, 'e4', { perspective: 'w' })).toBe('Your pawn moves to e4');
    const chess = new Chess();
    chess.move('e4');
    expect(describeMove(chess.fen(), 'e5')).toBe("Black's pawn moves to e5");
    expect(describeMove(chess.fen(), 'e5', { perspective: 'b' })).toBe('Your pawn moves to e5');
  });

  it.each([
    ['O-O', 'You castle kingside'],
    ['O-O-O', 'You castle queenside'],
    ['e1g1', 'You castle kingside'],
    ['e1c1', 'You castle queenside'],
  ])('describes castling %s', (move, expected) => {
    expect(describeMove(castles, move, { perspective: 'w' })).toBe(expected);
  });

  it('describes black castling with and without perspective', () => {
    const fen = castles.replace(' w ', ' b ');
    expect(describeMove(fen, 'O-O')).toBe('Black castles kingside');
    expect(describeMove(fen, 'O-O-O', { perspective: 'w' })).toBe('They castle queenside');
  });

  it('describes en passant from the actual move flags', () => {
    const chess = new Chess();
    for (const move of ['e4', 'a6', 'e5', 'd5']) chess.move(move);
    expect(describeMove(chess.fen(), 'e5d6', { perspective: 'w' }))
      .toBe('Your pawn takes the pawn en passant on d6');
  });

  it('describes promotion and checkmate', () => {
    const fen = '7k/5P2/6K1/8/8/8/8/8 w - - 0 1';
    expect(describeMove(fen, 'f7f8q', { perspective: 'w' }))
      .toBe('Your pawn promotes to a queen on f8, checkmate');
  });

  it('describes underpromotion without SAN', () => {
    expect(describeMove('7k/4P3/8/8/8/8/8/K7 w - - 0 1', 'e8=N'))
      .toBe("White's pawn promotes to a knight on e8");
  });

  it('describes capture-promotion including captured piece and check', () => {
    const fen = '3r3k/4P3/8/8/8/8/8/K7 w - - 0 1';
    expect(describeMove(fen, 'e7d8q', { perspective: 'w' }))
      .toBe('Your pawn takes the rook on d8 and promotes to a queen, check');
  });

  it('describes a normal mating move', () => {
    const chess = new Chess();
    for (const move of ['f3', 'e5', 'g4']) chess.move(move);
    expect(describeMove(chess.fen(), 'Qh4#', { perspective: 'w' }))
      .toBe('Their queen moves to h4, checkmate');
  });

  it('keeps short style compact with check and mate markers', () => {
    expect(describeMove(capture, 'd5e6', { style: 'short' })).toBe('Queen takes e6+');
    expect(describeMove(start, 'Nf3', { style: 'short' })).toBe('Knight to f3');
    expect(describeMove(castles, 'O-O-O', { style: 'short' })).toBe('Castle queenside');
    expect(describeMove('7k/5P2/6K1/8/8/8/8/8 w - - 0 1', 'f8=Q#', { style: 'short' }))
      .toBe('Pawn to f8, promotes to queen#');
  });

  it('rejects illegal moves and invalid positions', () => {
    expect(() => describeMove(start, 'e2e5')).toThrow();
    expect(() => describeMove(start, 'nonsense')).toThrow();
    expect(() => describeMove('invalid', 'e4')).toThrow();
  });
});

describe('describeLine', () => {
  it('advances the position and retains a fixed perspective', () => {
    expect(describeLine(start, ['e2e4', 'd5', 'exd5'], { perspective: 'w' })).toEqual([
      'Your pawn moves to e4', 'Their pawn moves to d5', 'Your pawn takes the pawn on d5',
    ]);
    expect(new Chess(start).fen()).toBe(start);
  });
  it('supports empty lines and short style', () => {
    expect(describeLine(start, [])).toEqual([]);
    expect(describeLine(start, ['e4', 'e5'], { style: 'short' })).toEqual(['Pawn to e4', 'Pawn to e5']);
  });
  it('rejects an illegal continuation', () => {
    expect(() => describeLine(start, ['e4', 'e4'])).toThrow();
  });
});

describe('names', () => {
  it('names every piece', () => {
    expect(['p', 'n', 'b', 'r', 'q', 'k'].map(type => pieceName(type as Parameters<typeof pieceName>[0])))
      .toEqual(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']);
  });
  it('preserves readable square coordinates and rejects invalid squares', () => {
    expect(squareName('e6')).toBe('e6');
    expect(squareName('a1')).toBe('a1');
    expect(() => squareName('i9')).toThrow('Invalid square');
  });
});
