import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { bestMovePlan, explainMove, hints, replaySan, positionFeatures, threatsAfter } from '../coach';
import { describeMove } from '../narrate';
import type { AnalysedMove } from '../types';

function fixture(fen: string, played: string, best: string[], reply: string[] = []): AnalysedMove {
  const c = new Chess(fen), b = new Chess(fen);
  const move = c.move(played), bestMove = b.move(best[0]);
  return { ply: 1, color: move.color, san: move.san, uci: move.from + move.to + (move.promotion ?? ''), from: move.from, to: move.to, fenBefore: fen, fenAfter: c.fen(), scoreBefore: { cp: 0 }, scoreAfter: { cp: -400 }, winBefore: 50, winAfter: 15, epLoss: .35, accuracy: 20, bestUci: bestMove.from + bestMove.to + (bestMove.promotion ?? ''), bestSan: bestMove.san, bestLineSan: best, replyLineSan: reply, cls: 'blunder', comment: '', motifs: [] };
}

const fork = () => fixture('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'Na3', ['Nc7+', 'Kd7', 'Nxa8']);
const queen = () => fixture('3r2k1/8/8/8/3Q4/8/7P/6K1 w - - 0 1', 'h3', ['Qxd8+'], ['Rxd4']);
const mate = () => fixture('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', 'Re2', ['Re8#']);
const words = (s: string) => s.trim().split(/\s+/).length;
const sentences = (s: string) => s.split(/[.!?]+/).map(x => x.trim()).filter(Boolean);

function expectNatural(m: AnalysedMove) {
  const e = explainMove(m), plan = bestMovePlan(m);
  expect(e.headline).toBe(plan.line.length ? `Better: ${describeMove(m.fenBefore, plan.san, { perspective: m.color }).toLowerCase()}.` : 'Better: recheck the saved position.');
  expect(words(e.rule)).toBeLessThanOrEqual(12);
  expect(e.rule).not.toMatch(/\b[a-h][1-8]\b/);
  expect(words(e.headline)).toBeLessThanOrEqual(12);
  expect(words(e.detail)).toBeLessThanOrEqual(60);
  expect(sentences(e.detail).length).toBeGreaterThanOrEqual(1);
  expect(sentences(e.detail).length).toBeLessThanOrEqual(2);
  expect(new Set(sentences(e.detail)).size).toBe(sentences(e.detail).length);
  expect(e.headline + ' ' + e.detail).toMatch(/\b(you|your)\b/i);
  expect(e.detail).not.toMatch(/allows\s+\S+\s+captures/i);
  expect(e.detail).not.toMatch(/\b(White|Black)\b|pawns? worth/);
  expect(words(plan.idea)).toBeLessThanOrEqual(25);
  expect(sentences(plan.idea)).toHaveLength(1);
  expect(plan.idea).toMatch(/\b(you|your)\b/i);
  expect(sentences(e.detail)).not.toContain(plan.idea.replace(/[.!?]$/, ''));
  for (const { note } of plan.lineExplained) {
    if (note) expect(words(note)).toBeLessThanOrEqual(14);
  }
}

describe('human coaching from legal engine lines', () => {
  it.each([['knight fork', fork], ['hanging queen', queen], ['back-rank mate', mate]])('keeps %s coaching concise and personal', (_, make) => {
    expectNatural(make());
  });

  it('names both fork targets and only annotates the meaningful moves', () => {
    const m = fork(), plan = bestMovePlan(m);
    expect(plan.idea).toContain('king on e8 and rook on a8');
    expect(explainMove(m).tags).toContain('fork');
    expect(plan.lineExplained[1]).toEqual({ san: 'Kd7' });
    expect(plan.lineExplained[2].note).toContain('rook on a8');
  });

  it('explains a queen loss once in plain material terms', () => {
    const e = explainMove(queen());
    expect(e.headline).toBe('Better: your queen takes the rook on d8, check.');
    expect(e.detail).toContain('their rook takes the queen on d4');
    expect(e.detail).toContain('You lose your queen');
    expect(e.detail).toMatch(/^It takes the rook on d8 with check\./);
    expect(e.tags).toEqual(expect.arrayContaining(['hanging-piece', 'material']));
  });

  it('describes mate naturally for either player colour', () => {
    expect(bestMovePlan(mate()).lineExplained[0].note).toBe('Delivers checkmate.');
    const black = fixture('4r1k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', 'Re7', ['Re1#']);
    expectNatural(black);
    expect(bestMovePlan(black).idea).toContain('their king');
    const allowed = fixture('6k1/5ppp/8/8/8/8/4r3/R5K1 b - - 0 1', 'Rh2', ['Re1+'], ['Ra8#']);
    expect(explainMove(allowed).detail).toContain('Your opponent forces checkmate: their rook moves to a8, checkmate');
    expectNatural(allowed);
  });

  it('handles a mate score when the saved reply stops before mate', () => {
    const m = queen();
    m.replyLineSan = [];
    m.scoreAfter = { mate: -3 };
    expect(explainMove(m).detail).toContain('force mate in 3');
    expect(explainMove(m).tags).toContain('mate');
    expectNatural(m);
  });

  it('counts recaptures before claiming a material loss', () => {
    const m = fixture('3q2k1/8/8/3p4/8/8/8/3R2K1 w - - 0 1', 'Rxd5', ['Rd2'], ['Qxd5']);
    expect(explainMove(m).detail).toContain('You lose your rook');
    const trade = fixture('3r2k1/8/8/8/3R4/4P3/7P/6K1 w - - 0 1', 'h3', ['Rxd8+'], ['Rxd4', 'exd4']);
    expect(explainMove(trade).detail).not.toContain('You lose');
    const uneven = fixture('3r2k1/8/8/8/3Q4/4P3/7P/6K1 w - - 0 1', 'h3', ['Qxd8+'], ['Rxd4', 'exd4']);
    expect(explainMove(uneven).detail).toContain('You lose your queen for too little in return');
    expectNatural(uneven);
    expectNatural(m);
  });

  it('does not count unrelated captures after two quiet plies', () => {
    const m = fixture(new Chess().fen(), 'e4', ['d4'], ['d5', 'Nf3', 'dxe4']);
    expect(explainMove(m).detail).not.toContain('You lose');
    expect(bestMovePlan(m).lineExplained).toEqual([{ san: 'd4' }]);
  });

  it('provides three progressive hints without SAN', () => {
    const hs = hints(fork());
    expect(hs.map(h => h.level)).toEqual([1, 2, 3]);
    expect(hs[1].text).toContain('forks the king on e8 and rook on a8');
    expect(hs[0].text).toContain('your knight on b5');
    expect(hs[0].highlight?.squares).toEqual(['b5']);
    expect(hs[2].highlight?.arrow).toEqual(['b5', 'c7']);
    for (const h of hs) expect(h.text).not.toContain('Nc7');
  });

  it('keeps hints deterministic and hides SAN for every motif', () => {
    for (const m of [fork(), queen(), mate()]) {
      const first = hints(m);
      expect(hints(structuredClone(m))).toEqual(first);
      expect(first[0].highlight?.squares).toEqual([m.bestUci.slice(0, 2)]);
      expect(first[0].highlight?.arrow).toBeUndefined();
      expect(first[1].highlight?.arrow).toBeUndefined();
      expect(first[2].highlight?.arrow).toEqual([m.bestUci.slice(0, 2), m.bestUci.slice(2, 4)]);
      for (const hint of first) for (const san of m.bestLineSan) expect(hint.text).not.toContain(san);
    }
    expect(hints(queen())[1].text).toBe('Consider your highlighted queen. Take the rook on d8 with check.');
  });

  it('derives transferable rules from the tactic', () => {
    expect(explainMove(fork()).rule).toContain('two valuable targets');
    expect(explainMove(mate()).rule).toContain('forcing checks');
    expect(explainMove(queen()).rule).toContain('guarding');
  });

  it('handles promotions and stale PVs without inventing moves', () => {
    const m = fixture('8/P6k/8/8/8/8/8/6K1 w - - 0 1', 'Kf1', ['a8=Q', 'nonsense']);
    expect(bestMovePlan(m).line).toEqual(['a8=Q']);
    expect(explainMove(m).tags).toContain('promotion');
    expect(bestMovePlan(m).idea).toContain('passed pawn into a queen');
    expect(replaySan(m.fenBefore, ['invalid'])).toEqual([]);
    m.bestLineSan = ['invalid'];
    expect(bestMovePlan(m).line).toEqual(['a8=Q']);
    m.bestUci = 'a7b6';
    expect(bestMovePlan(m).line).toEqual([]);
    expectNatural(m);
  });

  it('explains pins with concrete squares and short notes', () => {
    const m = fixture('4k3/4n3/8/8/8/8/8/R5K1 w - - 0 1', 'Ra2', ['Re1']);
    expect(bestMovePlan(m).idea).toContain('pin their knight on e7 to the king on e8');
    expectNatural(m);
  });

  it('summarises preparation before the key tactic rather than every capture', () => {
    const m = fixture('6k1/8/b4n2/1B6/1q6/2N5/2QB4/4K3 b - - 0 1', 'Nh5', ['Bxb5', 'Nxb5', 'Qe4+', 'Qxe4']);
    expect(bestMovePlan(m).line).toEqual(['Bxb5', 'Nxb5', 'Qe4+', 'Qxe4']);
    expect(explainMove(m).headline).toBe('Better: your bishop takes the bishop on b5.');
    expect(explainMove(m).detail).toContain('prepares a later queen move that forks');
    expect(bestMovePlan(m).idea).toContain('king on e1 and queen on c2');
    expect(hints(m)[1].text).toContain('Take the bishop on b5 first');
    expectNatural(m);
  });

  it('teaches the preparatory bishop capture before the later queen fork', () => {
    const m = fixture('rn3rk1/3pppbp/b4np1/1BpPP3/Pq6/2N5/1PQB1PPP/R3K1NR b KQ - 0 12',
      'Nh5', ['Bxb5', 'Nxb5', 'Qe4+', 'Qxe4']);
    const hs = hints(m);
    expect(hs[0].text).toBe('Look at your bishop on a6.');
    expect(hs[0].highlight?.squares).toEqual(['a6']);
    expect(hs[1].text).toBe('Consider your highlighted bishop. Take the bishop on b5 first, so a later queen check can fork the king on e1 and queen on c2.');
    expect(hs[1].text).not.toContain('it was guarding the e4 square');
    expect(hs[1].text).not.toMatch(/Look for a check|Give check|Check their king|Bxb5|Qe4/);
    expect(hs[2].highlight?.arrow).toEqual(['a6', 'b5']);
  });
});

describe('position features and quiet-move reasoning', () => {
  it('explains a weakened king shield with highlight squares', () => {
    const m = fixture('6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 12', 'g4', ['Kf1']);
    const e = explainMove(m);
    expect(e.points).toContainEqual({ kind: 'bad', text: 'This weakens the pawn shield around your king.', squares: ['g1', 'g2'] });
    expect(e.detail).toContain('pawn shield');
    expect(e.tags).toContain('king-safety');
  });

  it('finds an undefended bishop when its defender moves away', () => {
    const m = fixture('6k1/5ppp/8/8/2B5/3P4/5PPP/6K1 w - - 0 12', 'd4', ['Kf1']);
    const e = explainMove(m);
    expect(e.points).toContainEqual({ kind: 'bad', text: 'This leaves your bishop on c4 undefended.', squares: ['c4'] });
    expect(positionFeatures(m.fenAfter, 'w').undefended).toContain('c4');
  });

  it('recognises passed pawns and explains creating one', () => {
    const m = fixture('6k1/8/3p4/4P3/8/8/7P/6K1 w - - 0 20', 'h3', ['exd6']);
    expect(positionFeatures(new Chess(m.fenBefore).fen(), 'w').pawns.passed).not.toContain('e5');
    expect(explainMove(m).points).toContainEqual({ kind: 'good', text: 'Your pawn on d6 is passed: no enemy pawn can block or capture it from ahead.', squares: ['d6'] });
    expect(explainMove(m).tags).toContain('passed-pawn');
  });

  it('compares opening development and highlights the piece to develop', () => {
    const m = fixture(new Chess().fen(), 'a3', ['Nf3']);
    const start = positionFeatures(m.fenBefore, 'w');
    expect(start.development).toEqual({ opening: true, undeveloped: ['b1', 'c1', 'f1', 'g1'], developed: 0 });
    expect(explainMove(m).points).toContainEqual({ kind: 'good', text: 'This develops your piece and brings it into play.', squares: ['g1'] });
    expect(explainMove(m).tags).toContain('development');
  });

  it('detects open king files, loose attacked pieces and legal capture threats', () => {
    const f = positionFeatures(queen().fenAfter, 'w');
    expect(f.kingSafety.openFiles).toContain('f');
    expect(f.looseAttacked).toContain('d4');
    expect(f.hanging).toContain('d4');
    expect(f.mobility).toBeGreaterThan(0);
    expect(threatsAfter(queen())).toEqual(['Your opponent can play: their rook takes the queen on d4.']);
    for (const text of threatsAfter(queen())) expect(text).not.toContain('Rxd4');
  });

  it('detects isolated and doubled pawns without treating blocked pawns as passed', () => {
    const f = positionFeatures('6k1/8/2p5/8/2P5/P7/P7/6K1 w - - 0 20', 'w');
    expect(f.pawns.doubled).toEqual(['a3', 'a2']);
    expect(f.pawns.isolated).toEqual(['c4', 'a3', 'a2']);
    expect(f.pawns.passed).not.toContain('c4');
  });
});


describe('progressive board hints', () => {
  it.each([
    ['quiet', () => fixture(new Chess().fen(), 'e4', ['Nf3'])],
    ['capture', queen], ['check', mate], ['fork', fork],
    ['en passant', () => fixture('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'Kf1', ['exd6'])],
  ])('highlights every level for %s', (_, make) => {
    const m = make(), hs = hints(m), from = m.bestUci.slice(0, 2), to = m.bestUci.slice(2, 4);
    for (const h of hs) expect(h.highlight?.squares).toContain(from);
    expect(hs[0].highlight?.squares).toEqual([from]);
    expect(hs[1].text).toContain('highlighted');
    for (const square of hs[1].text.match(/\b[a-h][1-8]\b/g) ?? []) expect(hs[1].highlight?.squares).toContain(square);
    expect(hs[2].highlight).toEqual({ squares: [from, to], arrow: [from, to] });
  });
  it('lights both fork targets and the en passant victim', () => {
    expect(hints(fork())[1].highlight?.squares).toEqual(expect.arrayContaining(['b5', 'e8', 'a8']));
    expect(hints(fixture('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'Kf1', ['exd6']))[1].highlight?.squares).toContain('d5');
  });
});
