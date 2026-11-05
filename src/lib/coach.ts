import { Chess, type Move, type Square } from 'chess.js';
import { bestCaptureGain, PIECE_NAME, PIECE_VALUE } from './classify';
import type { AnalysedMove, Color } from './types';

export interface Explanation { headline: string; detail: string; tags: string[]; rule: string }
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

const pieceAt = (p: { type: string; square: string }) => `${PIECE_NAME[p.type]} on ${p.square}`;

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
    const hits: { type: string; square: string; color: Color }[] = [];
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
  if (move.captured) { text.push(`captures the ${PIECE_NAME[move.captured]} on ${move.isEnPassant() ? move.to[0] + move.from[1] : move.to}`); tags.push('capture'); }
  if (move.promotion) { text.push(`promotes the pawn on ${move.to} to a ${PIECE_NAME[move.promotion]}`); tags.push('promotion'); }
  const targets = forkTargets(chess, move).filter(p => p !== null);
  if (targets.length >= 2) { text.push(`forks the ${targets.map(p => pieceAt(p!)).join(' and ')}`); tags.push('fork'); }
  const rays = rayMotifs(chess, move);
  text.push(...rays); tags.push(...rays.map(t => t.startsWith('pins') ? 'pin' : 'skewer'));
  // A piece moved out of another slider's ray can uncover a concrete attack.
  const before = new Chess(move.before);
  for (const p of chess.board().flat()) {
    if (!p || p.color === move.color || (p.type !== 'k' && PIECE_VALUE[p.type] < 3)) continue;
    const newly = chess.attackers(p.square, move.color).filter(sq => sq !== move.to && !before.attackers(p.square, move.color).includes(sq));
    if (newly.length) { text.push(`uncovers an attack by the ${PIECE_NAME[chess.get(newly[0])!.type]} on ${newly[0]} against the ${pieceAt(p)}`); tags.push('discovered-attack'); break; }
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
  if (move.promotion) return `promotes your pawn to a ${PIECE_NAME[move.promotion]}`;
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
  if (move.captured) return `takes the ${PIECE_NAME[move.captured]} on ${move.isEnPassant() ? move.to[0] + move.from[1] : move.to}${chess.inCheck() ? ' with check' : ''}`;
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
    const setup = key !== first && first.captured ? `Trade off their ${PIECE_NAME[first.captured]} so your ${PIECE_NAME[key!.piece]} can attack` : `Use your ${PIECE_NAME[key!.piece]} to attack`;
    return `${setup} their ${point.slice('forks the '.length)} at once.`;
  }
  if (point?.startsWith('pins')) return `Use your ${PIECE_NAME[key!.piece]} to pin their ${point.slice('pins the '.length)}.`;
  if (point?.startsWith('skewers')) return 'Drive their king away so you can take the piece behind it.';
  if (key?.promotion) return `Turn your passed pawn into a ${PIECE_NAME[key.promotion]} before they can stop it.`;
  if (point?.startsWith('uncovers')) return 'Move your piece out of the way to bring another attacker into play.';
  if (key?.captured) return `Take their ${PIECE_NAME[key.captured]}${key.san.includes('+') ? ' with check to keep your initiative' : ' while keeping your pieces coordinated'}.`;
  if (m.scoreBefore.mate !== undefined && m.scoreBefore.mate * (m.color === 'w' ? 1 : -1) > 0) return 'Keep your attack forcing so their king has no time to escape.';
  return `Give your ${PIECE_NAME[first.piece]} a more active square on ${first.to}.`;
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
  const names = losses.slice(0, 2).map(p => balance[p] === 1 ? `your ${PIECE_NAME[p]}` : `${balance[p]} ${PIECE_NAME[p]}s`);
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
  let consequence: string;
  if (allowedMate) {
    tags.add('mate');
    consequence = mate ? `After ${m.san}, your opponent forces checkmate with ${mate.san}.` : `After ${m.san}, your opponent can force mate in ${Math.abs(m.scoreAfter.mate!)}.`;
  } else if (loss) {
    consequence = `After ${m.san}, ${loss}${reply[0] ? ` in the exchange starting with ${reply[0].san}` : ''}.`;
  } else if (hang.move && hang.gain > 0) {
    consequence = `After ${m.san}, they can take your ${PIECE_NAME[hang.move.captured!]} on ${hang.move.to} with ${hang.move.san}.`;
  } else {
    consequence = `${m.san} gives your opponent ${m.scoreAfter.cp !== undefined && (m.scoreAfter.cp * (m.color === 'w' ? 1 : -1)) < -70 ? 'the advantage' : 'more chances than necessary'}.`;
  }
  const first = best[0], key = keyMove(best, m.color);
  let correction: string;
  if (first && key) {
    const point = keyPoint(key)!;
    const lead = key === first ? 'It' : first.captured
      ? `It takes the ${PIECE_NAME[first.captured]}, and after ${best[best.indexOf(key) - 1].san} your ${key.san}`
      : `After ${best[best.indexOf(key) - 1].san}, your ${key.san}`;
    correction = `${lead} ${point}.`;
  } else if (first) correction = `It gives your ${PIECE_NAME[first.piece]} more scope.`;
  else correction = 'Recheck your saved position before choosing a move.';
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
  return { headline: `Better: ${first?.san ?? m.bestSan}.`, detail: `${correction} ${consequence}`, tags: [...tags], rule };
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
    concept = `Take the ${PIECE_NAME[first.captured]} on ${square}${new Chess(first.after).inCheck() ? ' with check' : ''}`;
    const laterPoint = key && key !== first ? keyPoint(key) : undefined;
    if (key && laterPoint) {
      const guarded = new Chess(first.before).attackers(key.to, first.color === 'w' ? 'b' : 'w').includes(square as Square);
      concept += guarded
        ? ` first — it was guarding the ${key.to} square your ${PIECE_NAME[key.piece]} wants`
        : ' first';
      if (laterPoint.startsWith('forks')) {
        concept += `, so a later ${PIECE_NAME[key.piece]}${new Chess(key.after).inCheck() ? ' check' : ' move'} can ${laterPoint.replace(/^forks/, 'fork')}`;
      }
    }
    concept += '.';
  } else if (first && !point) {
    const before = new Chess(first.before), after = new Chess(first.after);
    if (before.inCheck()) concept = first.piece === 'k'
      ? 'Move your king out of check.' : `Block the check with your ${PIECE_NAME[first.piece]}.`;
    else if (after.inCheck()) concept = 'Give check to their king.';
  }
  return [
    { level: 1, text: `Look at your ${PIECE_NAME[p]} on ${from}.`, highlight: { squares: [from] } },
    { level: 2, text: concept },
    { level: 3, text: `Try your ${PIECE_NAME[p]} on ${to}${first?.promotion ? ` and promote to a ${PIECE_NAME[first.promotion]}` : ''}.`, highlight: { squares: [to], arrow: [from, to] } },
  ];
}
