import { Chess, type Move, type Square, type PieceSymbol } from 'chess.js';
import { bestCaptureGain, PIECE_VALUE } from './classify';
import { describeMove, pieceName } from './narrate';
import type { AnalysedMove, Color } from './types';

export interface Explanation { headline: string; detail: string; tags: string[]; rule: string; points?: { kind: 'good' | 'bad'; text: string; squares?: string[] }[] }
export interface Hint {
  level: 1 | 2 | 3;
  text: string;
  highlight?: { squares?: string[]; arrow?: [string, string] };
}
export interface MovePlan {
  san: string;
  idea: string;
  line: string[];
  lineExplained: { san: string; note?: string }[];
}

/** Replay only the legal prefix: older analyses may contain truncated/stale PVs. */
export function replaySan(fen: string, line: string[]): Move[] {
  const chess = new Chess(fen);
  const moves: Move[] = [];
  for (const san of line) {
    try { moves.push(chess.move(san)); } catch { break; }
  }
  return moves;
}

const pieceAt = (p: { type: PieceSymbol; square: string }) => `${pieceName(p.type)} on ${p.square}`;

function forkTargets(chess: Chess, move: Move) {
  return chess.board().flat().filter(p => p && p.color !== move.color &&
    (p.type === 'k' || PIECE_VALUE[p.type] >= PIECE_VALUE[move.promotion ?? move.piece]) &&
    chess.attackers(p.square, move.color).includes(move.to));
}

/** Ray geometry is only used for motifs, never as a substitute for engine verification. */
function rayMotifs(chess: Chess, move: Move): string[] {
  if (!['b', 'r', 'q'].includes(move.promotion ?? move.piece)) return [];
  const kind = move.promotion ?? move.piece;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const out: string[] = [];
  for (const [dx, dy] of dirs) {
    if (kind === 'b' && (!dx || !dy) || kind === 'r' && dx && dy) continue;
    const hits: { type: PieceSymbol; square: string; color: Color }[] = [];
    let x = move.to.charCodeAt(0) - 97 + dx, y = Number(move.to[1]) - 1 + dy;
    while (x >= 0 && x < 8 && y >= 0 && y < 8) {
      const square = `${String.fromCharCode(97 + x)}${y + 1}` as Square;
      const p = chess.get(square);
      if (p) { hits.push({ ...p, square }); if (hits.length === 2) break; }
      x += dx; y += dy;
    }
    const [a, b] = hits;
    if (!a || !b || a.color === move.color || b.color === move.color) continue;
    if (b.type === 'k') out.push(`pins the ${pieceAt(a)} to the king on ${b.square}`);
    else if (a.type === 'k') out.push(`skewers the king on ${a.square} and ${pieceAt(b)}`);
  }
  return out;
}

function notes(move: Move): { text: string[]; tags: string[] } {
  const chess = new Chess(move.after);
  const text: string[] = [], tags: string[] = [];
  if (chess.isCheckmate()) { text.push('delivers checkmate'); tags.push('mate'); }
  if (move.captured) { text.push(`captures the ${pieceName(move.captured)} on ${move.isEnPassant() ? move.to[0] + move.from[1] : move.to}`); tags.push('capture'); }
  if (move.promotion) { text.push(`promotes the pawn on ${move.to} to a ${pieceName(move.promotion)}`); tags.push('promotion'); }
  const targets = forkTargets(chess, move).filter(p => p !== null);
  if (targets.length >= 2) { text.push(`forks the ${targets.map(p => pieceAt(p!)).join(' and ')}`); tags.push('fork'); }
  const rays = rayMotifs(chess, move);
  text.push(...rays); tags.push(...rays.map(t => t.startsWith('pins') ? 'pin' : 'skewer'));
  // A piece moved out of another slider's ray can uncover a concrete attack.
  const before = new Chess(move.before);
  for (const p of chess.board().flat()) {
    if (!p || p.color === move.color || (p.type !== 'k' && PIECE_VALUE[p.type] < 3)) continue;
    const newly = chess.attackers(p.square, move.color).filter(sq => sq !== move.to && !before.attackers(p.square, move.color).includes(sq));
    if (newly.length) { text.push(`uncovers an attack by the ${pieceName(chess.get(newly[0])!.type)} on ${newly[0]} against the ${pieceAt(p)}`); tags.push('discovered-attack'); break; }
  }
  return { text, tags };
}

/** Pick one motif per move; the full set of tags remains available for training. */
function keyPoint(move: Move): string | undefined {
  const chess = new Chess(move.after);
  if (chess.isCheckmate()) return 'delivers checkmate';
  const targets = forkTargets(chess, move).filter(p => p !== null)
    .sort((a, b) => (b.type === 'k' ? 100 : PIECE_VALUE[b.type]) - (a.type === 'k' ? 100 : PIECE_VALUE[a.type]))
    .slice(0, 2);
  if (targets.length === 2) return `forks the ${targets.map(p => pieceAt(p)).join(' and ')}`;
  if (move.promotion) return `promotes your pawn to a ${pieceName(move.promotion)}`;
  const motif = notes(move).text.find(t => /^(pins|skewers)/.test(t));
  if (motif) return motif;
  const discovered = notes(move).tags.includes('discovered-attack');
  if (discovered) {
    const before = new Chess(move.before);
    const target = chess.board().flat().find(p => p && p.color !== move.color &&
      (p.type === 'k' || PIECE_VALUE[p.type] >= 3) &&
      chess.attackers(p.square, move.color).some(sq => sq !== move.to && !before.attackers(p.square, move.color).includes(sq)));
    if (target) return `uncovers an attack on the ${pieceAt(target)}`;
  }
  if (move.captured) return `takes the ${pieceName(move.captured)} on ${move.isEnPassant() ? move.to[0] + move.from[1] : move.to}${chess.inCheck() ? ' with check' : ''}`;
  if (chess.inCheck()) return 'checks the king';
  return undefined;
}

function bestLine(m: AnalysedMove): Move[] {
  const line = replaySan(m.fenBefore, m.bestLineSan);
  if (line.length) return line;
  const c = new Chess(m.fenBefore);
  try { return [c.move({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), promotion: m.bestUci[4] })]; } catch { return []; }
}

// Prefer the decisive tactic to its preparatory capture, or a routine recapture.
function keyMove(line: Move[], color: Color): Move | undefined {
  const own = line.filter(x => x.color === color);
  return own.find(x => x.san.endsWith('#'))
    ?? own.find(x => notes(x).tags.some(t => ['fork', 'pin', 'skewer', 'promotion', 'discovered-attack'].includes(t)))
    ?? own.find(x => x.captured) ?? own.find(x => x.san.includes('+'));
}

function planIdea(m: AnalysedMove, moves: Move[]): string {
  const first = moves[0], key = keyMove(moves, m.color);
  if (!first) return 'Recheck your saved position to find a safe square for your piece.';
  const point = key && keyPoint(key);
  if (key?.san.endsWith('#')) return 'Use your forcing checks to finish the attack on their king.';
  if (point?.startsWith('forks')) {
    const setup = key !== first && first.captured ? `Trade off their ${pieceName(first.captured)} so your ${pieceName(key!.piece)} can attack` : `Use your ${pieceName(key!.piece)} to attack`;
    return `${setup} their ${point.slice('forks the '.length)} at once.`;
  }
  if (point?.startsWith('pins')) return `Use your ${pieceName(key!.piece)} to pin their ${point.slice('pins the '.length)}.`;
  if (point?.startsWith('skewers')) return 'Drive their king away so you can take the piece behind it.';
  if (key?.promotion) return `Turn your passed pawn into a ${pieceName(key.promotion)} before they can stop it.`;
  if (point?.startsWith('uncovers')) return 'Move your piece out of the way to bring another attacker into play.';
  if (key?.captured) return `Take their ${pieceName(key.captured)}${key.san.includes('+') ? ' with check to keep your initiative' : ' while keeping your pieces coordinated'}.`;
  if (m.scoreBefore.mate !== undefined && m.scoreBefore.mate * (m.color === 'w' ? 1 : -1) > 0) return 'Keep your attack forcing so their king has no time to escape.';
  return `Give your ${pieceName(first.piece)} a more active square on ${first.to}.`;
}

export function bestMovePlan(m: AnalysedMove): MovePlan {
  const moves = bestLine(m);
  return {
    san: moves[0]?.san ?? m.bestSan,
    idea: planIdea(m, moves),
    line: moves.map(x => x.san),
    lineExplained: moves.map(x => {
      const point = keyPoint(x);
      // Promotion wording must describe either player's move correctly.
      const note = point?.replace('your pawn', x.color === m.color ? 'your pawn' : 'their pawn');
      return { san: x.san, ...(note ? { note: note[0].toUpperCase() + note.slice(1) + '.' } : {}) };
    }),
  };
}

/** Net piece losses in the immediate exchange, stopping once play settles. */
function lostMaterial(line: Move[], color: Color): string | undefined {
  const balance: Record<string, number> = {};
  let quiet = 0, swing = 0;
  for (const move of line) {
    quiet = move.captured || move.promotion || /[+#]/.test(move.san) ? 0 : quiet + 1;
    if (quiet >= 2) break;
    const sign = move.color === color ? -1 : 1;
    if (move.captured) {
      balance[move.captured] = (balance[move.captured] ?? 0) + sign;
      swing += sign * PIECE_VALUE[move.captured];
    }
    if (move.promotion) swing -= sign * (PIECE_VALUE[move.promotion] - 1);
  }
  if (swing <= 0) return undefined;
  const losses = Object.keys(balance).filter(p => balance[p] > 0).sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
  const names = losses.slice(0, 2).map(p => balance[p] === 1 ? `your ${pieceName(p as PieceSymbol)}` : `${balance[p]} ${pieceName(p as PieceSymbol)}s`);
  return names.length ? `you lose ${names.join(' and ')}${Object.values(balance).some(n => n < 0) ? ' for too little in return' : ''}` : undefined;
}

export function explainMove(m: AnalysedMove): Explanation {
  const reply = replaySan(m.fenAfter, m.replyLineSan), best = bestLine(m);
  const tags = new Set([...reply, ...best].flatMap(x => notes(x).tags));
  const hang = bestCaptureGain(m.fenAfter);
  if (hang.gain > 0) tags.add('hanging-piece');
  const mate = reply.find(x => x.san.endsWith('#') && x.color !== m.color);
  const allowedMate = mate || m.scoreAfter.mate !== undefined && m.scoreAfter.mate * (m.color === 'w' ? 1 : -1) < 0;
  const loss = lostMaterial(reply, m.color);
  if (loss) tags.add('material');
  const plain = (move: Move) => describeMove(move.before, move.san, { perspective: m.color, style: 'full' }).replace(/[.!]$/, '');
  const deltas = featureDeltas(m.fenBefore, m.fenAfter, m.color);
  const threat = threatsAfter(m)[0];
  let consequence = deltas[0]?.text ?? 'Your opponent gains more chances than necessary.';
  if (allowedMate) {
    tags.add('mate');
    consequence = mate ? `Your opponent forces checkmate: ${plain(mate).toLowerCase()}.` : `Your opponent can force mate in ${Math.abs(m.scoreAfter.mate!)}.`;
  } else if (loss) consequence = `${loss[0].toUpperCase() + loss.slice(1)}${reply[0] ? ` after ${plain(reply[0]).toLowerCase()}` : ''}.`;
  else if (hang.move && hang.gain > 0) consequence = `${plain(hang.move)}; your ${pieceName(hang.move.captured!)} is lost.`;
  else if (!deltas.length && threat) consequence = threat;
  const first = best[0], key = keyMove(best, m.color);
  const correction = first && key ? key === first ? `It ${keyPoint(key)}.` : `${plain(first)} prepares a later ${pieceName(key.piece)} move that ${keyPoint(key)}.` : first ? `It gives your ${pieceName(first.piece)} more scope.` : 'Recheck your saved position before choosing a move.';
  const motif = key ? notes(key).tags : [];
  const rule = motif.includes('mate') ? 'Use forcing checks when the king has few escape squares.'
    : motif.includes('fork') ? 'Look for one move that attacks two valuable targets.'
    : motif.includes('pin') ? 'Attack pieces pinned to their king before they can escape.'
    : motif.includes('skewer') ? 'Check along lines with valuable pieces behind the king.'
    : motif.includes('promotion') ? 'Look for chances to promote before starting another plan.'
    : motif.includes('discovered-attack') ? 'Before moving a piece, check which attacks it uncovers.'
    : allowedMate ? 'Answer threats against your king before starting an attack.'
    : loss || hang.gain > 0 ? 'Before moving a defender, check what it was guarding.'
    : first?.captured ? 'Count captures and recaptures before choosing an exchange.'
    : 'Check threats before choosing a more active square.';
  const good = first ? featureDeltas(m.fenBefore, first.after, m.color, 'good') : [];
  if (!loss && !allowedMate && hang.gain <= 0 && !deltas.length && good.length) consequence = good[0].text;
  for (const point of deltas) {
    if (/king/.test(point.text)) tags.add('king-safety');
    if (/undefended/.test(point.text)) tags.add('undefended-piece');
  }
  if (good.some(p => /develop/.test(p.text))) tags.add('development');
  if (good.some(p => /passed/.test(p.text))) tags.add('passed-pawn');
  return { headline: first ? `Better: ${plain(first).toLowerCase()}.` : 'Better: recheck the saved position.', detail: `${correction} ${consequence}`, tags: [...tags], rule,
    points: [...deltas, ...good] };
}

export function hints(m: AnalysedMove): Hint[] {
  const moves = bestLine(m), first = moves[0], key = keyMove(moves, m.color);
  const from = first?.from ?? m.bestUci.slice(0, 2), to = first?.to ?? m.bestUci.slice(2, 4);
  const p = first?.piece ?? new Chess(m.fenBefore).get(from as Square)?.type ?? 'p';
  // The instruction always belongs to the first move; later motifs explain why.
  const point = first && keyPoint(first);
  let concept = point ? `Look for a move that ${point}.` : 'Find a safe, active square for this piece.';
  if (first?.captured) {
    const square = first.isEnPassant() ? first.to[0] + first.from[1] : first.to;
    concept = `Take the ${pieceName(first.captured)} on ${square}${new Chess(first.after).inCheck() ? ' with check' : ''}`;
    const laterPoint = key && key !== first ? keyPoint(key) : undefined;
    if (key && laterPoint) {
      const guarded = new Chess(first.before).attackers(key.to, first.color === 'w' ? 'b' : 'w').includes(square as Square);
      concept += guarded
        ? ` first â€” it was guarding the ${key.to} square your ${pieceName(key.piece)} wants`
        : ' first';
      if (laterPoint.startsWith('forks')) {
        concept += `, so a later ${pieceName(key.piece)}${new Chess(key.after).inCheck() ? ' check' : ' move'} can ${laterPoint.replace(/^forks/, 'fork')}`;
      }
    }
    concept += '.';
  } else if (first && !point) {
    const before = new Chess(first.before), after = new Chess(first.after);
    if (before.inCheck()) concept = first.piece === 'k'
      ? 'Move your king out of check.' : `Block the check with your ${pieceName(first.piece)}.`;
    else if (after.inCheck()) concept = 'Give check to their king.';
  }
  return [
    { level: 1, text: `Look at your ${pieceName(p)} on ${from}.`, highlight: { squares: [from] } },
    { level: 2, text: concept },
    { level: 3, text: `Try your ${pieceName(p)} on ${to}${first?.promotion ? ` and promote to a ${pieceName(first.promotion)}` : ''}.`, highlight: { squares: [to], arrow: [from, to] } },
  ];
}

export interface PositionFeatures {
  kingSafety: { king?: string; pawnShield: string[]; openFiles: string[]; halfOpenFiles: string[]; attackers: string[] };
  hanging: string[];
  undefended: string[];
  looseAttacked: string[];
  mobility: number;
  pawns: { isolated: string[]; doubled: string[]; passed: string[] };
  development: { opening: boolean; undeveloped: string[]; developed: number };
}

/** Geometric features, not engine evaluations. Hanging pieces are legally SEE-checked. */
export function positionFeatures(fen: string, color: Color): PositionFeatures {
  const c = new Chess(fen), opponent = color === 'w' ? 'b' : 'w';
  const pieces = c.board().flat().filter(p => p !== null);
  const own = pieces.filter(p => p.color === color), pawns = own.filter(p => p.type === 'p');
  const enemyPawns = pieces.filter(p => p.color === opponent && p.type === 'p');
  const file = (sq: string) => sq.charCodeAt(0);
  const rank = (sq: string) => Number(sq[1]);
  const king = own.find(p => p.type === 'k')?.square;
  const direction = color === 'w' ? 1 : -1;
  const nearbyFiles = king ? [-1, 0, 1].map(d => file(king) + d).filter(f => f >= 97 && f <= 104) : [];
  const openFiles = nearbyFiles.filter(f => !pieces.some(p => p.type === 'p' && file(p.square) === f));
  const halfOpenFiles = nearbyFiles.filter(f => !pawns.some(p => file(p.square) === f) && enemyPawns.some(p => file(p.square) === f));
  const zone = pieces.length && king ? Array.from({ length: 64 }, (_, i) => `${String.fromCharCode(97 + i % 8)}${1 + Math.floor(i / 8)}` as Square).filter(sq => Math.abs(file(sq) - file(king)) <= 1 && Math.abs(rank(sq) - rank(king)) <= 1) : [];
  const undefended = own.filter(p => p.type !== 'k' && !c.attackers(p.square, color).length).map(p => p.square);
  // Set the turn explicitly for legal mobility and capture analysis; stale en-passant rights do not apply.
  const forTurn = (turn: Color) => { const fields = fen.split(' '); if (fields[1] !== turn) fields[3] = '-'; fields[1] = turn; return fields.join(' '); };
  const capture = bestCaptureGain(forTurn(opponent));
  const home = color === 'w' ? '1' : '8';
  const undeveloped = own.filter(p => (p.type === 'n' && ['b', 'g'].includes(p.square[0]) || p.type === 'b' && ['c', 'f'].includes(p.square[0])) && p.square[1] === home).map(p => p.square);
  return {
    kingSafety: { king, pawnShield: pawns.filter(p => king && Math.abs(file(p.square) - file(king)) <= 1 && (rank(p.square) - rank(king)) * direction > 0 && (rank(p.square) - rank(king)) * direction <= 2).map(p => p.square), openFiles: openFiles.map(f => String.fromCharCode(f)), halfOpenFiles: halfOpenFiles.map(f => String.fromCharCode(f)), attackers: [...new Set(zone.flatMap(sq => c.attackers(sq, opponent)))] },
    hanging: capture.gain > 0 && capture.move ? [capture.move.isEnPassant() ? capture.move.to[0] + capture.move.from[1] : capture.move.to] : [],
    undefended, looseAttacked: undefended.filter(sq => c.isAttacked(sq, opponent)),
    mobility: new Chess(forTurn(color)).moves().length,
    pawns: {
      isolated: pawns.filter(p => !pawns.some(q => Math.abs(file(p.square) - file(q.square)) === 1)).map(p => p.square),
      doubled: pawns.filter(p => pawns.some(q => q.square !== p.square && file(p.square) === file(q.square))).map(p => p.square),
      passed: pawns.filter(p => !enemyPawns.some(q => Math.abs(file(p.square) - file(q.square)) <= 1 && (rank(q.square) - rank(p.square)) * direction > 0)).map(p => p.square),
    },
    development: { opening: Number(fen.split(' ')[5]) <= 10, undeveloped, developed: own.filter(p => p.type === 'n' || p.type === 'b').length - undeveloped.length },
  };
}

function featureDeltas(before: string, after: string, color: Color, kind: 'good' | 'bad' = 'bad'): NonNullable<Explanation['points']> {
  const a = positionFeatures(before, color), b = positionFeatures(after, color), c = new Chess(after);
  const out: NonNullable<Explanation['points']> = [];
  const add = (text: string, squares: string[]) => out.push({ kind, text, squares });
  if (kind === 'bad') {
    const files = [...b.kingSafety.openFiles, ...b.kingSafety.halfOpenFiles].filter(f => ![...a.kingSafety.openFiles, ...a.kingSafety.halfOpenFiles].includes(f));
    for (const f of files) add(`This opens the ${f}-file toward your king.`, [b.kingSafety.king!, `${f}${color === 'w' ? '2' : '7'}`]);
    if (!files.length && b.kingSafety.pawnShield.length < a.kingSafety.pawnShield.length) add('This weakens the pawn shield around your king.', [b.kingSafety.king!, ...a.kingSafety.pawnShield.filter(s => !b.kingSafety.pawnShield.includes(s))]);
    for (const sq of b.undefended.filter(s => !a.undefended.includes(s))) {
      const p = c.get(sq as Square);
      if (p && p.type !== 'p') add(`This leaves your ${pieceName(p.type)} on ${sq} undefended.`, [sq]);
    }
    for (const sq of b.looseAttacked.filter(s => !a.looseAttacked.includes(s))) {
      if (!out.some(p => p.squares?.includes(sq))) add(`Your ${pieceName(c.get(sq as Square)!.type)} on ${sq} is attacked and has no defender.`, [sq]);
    }
    if (b.kingSafety.attackers.length > a.kingSafety.attackers.length) add('More enemy pieces now attack squares around your king.', [b.kingSafety.king!, ...b.kingSafety.attackers]);
    for (const [label, values, previous] of [['isolated', b.pawns.isolated, a.pawns.isolated], ['doubled', b.pawns.doubled, a.pawns.doubled]] as const)
      for (const sq of values.filter(s => !previous.includes(s))) add(`Your pawn on ${sq} is now ${label}.`, [sq]);
    if (b.development.opening && b.development.developed < a.development.developed) add('This returns a developed piece to its starting square.', b.development.undeveloped);
    if (b.mobility < a.mobility - 3) add('Your pieces have fewer legal moves after this move.', []);
  } else {
    for (const sq of b.pawns.passed.filter(s => !a.pawns.passed.includes(s))) add(`Your pawn on ${sq} is passed: no enemy pawn can block or capture it from ahead.`, [sq]);
    if (a.development.opening && b.development.developed > a.development.developed) add('This develops your piece and brings it into play.', a.development.undeveloped.filter(s => !b.development.undeveloped.includes(s)));
  }
  return out;
}

/** Concrete legal reply threats only; a saved line is evidence, not a forced-mate proof. */
export function threatsAfter(m: AnalysedMove): string[] {
  const line = replaySan(m.fenAfter, m.replyLineSan), first = line[0];
  const capture = bestCaptureGain(m.fenAfter);
  const moves = [first, capture.gain > 0 ? capture.move : undefined].filter((x): x is Move => !!x);
  return [...new Set(moves.filter(x => x.color !== m.color && (x.captured || new Chess(x.after).inCheck())).map(x => `Your opponent can play: ${describeMove(x.before, x.san, { perspective: m.color, style: 'full' }).replace(/[.!]$/, '').toLowerCase()}.`))];
}
