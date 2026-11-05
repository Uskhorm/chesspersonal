import { Chess, type Move, type PieceSymbol } from 'chess.js';

export type MoveInputResult = { uci: string; san: string } | { error: string };

const names: Record<PieceSymbol, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
const pieces: Record<string, PieceSymbol> = {
  pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k',
  p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k',
};

function plain(move: Move): string {
  if (move.isKingsideCastle()) return 'castle kingside';
  if (move.isQueensideCastle()) return 'castle queenside';
  return `${names[move.piece]} from ${move.from} ${move.isCapture() || move.isEnPassant() ? 'takes on' : 'to'} ${move.to}${move.promotion ? ` and promotes to a ${names[move.promotion]}` : ''}`;
}

function result(matches: Move[]): MoveInputResult {
  if (matches.length === 1) {
    const move = matches[0];
    return { uci: move.from + move.to + (move.promotion ?? ''), san: move.san };
  }
  if (matches.length > 1) {
    return { error: `That could mean more than one move. Choose: ${matches.map(plain).join('; ')}.` };
  }
  return { error: 'That move is not legal in this position. Try a piece and destination, such as "knight to f3".' };
}

/** Resolve forgiving notation against legal moves only; never changes the supplied position. */
export function parseMoveInput(fen: string, text: string): MoveInputResult {
  let chess: Chess;
  try { chess = new Chess(fen); }
  catch { return { error: 'The board position is invalid.' }; }
  const input = text.trim().toLowerCase().replace(/[+#?!]+$/g, '').trim();
  if (!input) return { error: 'Enter a move, such as "pawn e4" or "knight to f3".' };
  const moves = chess.moves({ verbose: true });
  const castle = input.replace(/0/g, 'o').replace(/\s*-\s*/g, '-');
  if (/^(o-o(?:-o)?|castle(?:\s+(?:short|long|kingside|queenside|king\s*side|queen\s*side))?)$/.test(castle)) {
    const long = castle === 'o-o-o' || /long|queen/.test(castle);
    return result(moves.filter(m => long ? m.isQueensideCastle() : m.isKingsideCastle()));
  }
  const uci = input.replace(/\s+/g, '').match(/^([a-h][1-8])([a-h][1-8])=?([qrbn])?$/);
  if (uci) return result(moves.filter(m => m.from === uci[1] && m.to === uci[2] && (!uci[3] || m.promotion === uci[3])));

  // Matching SAN ourselves keeps lower-case piece letters and ambiguous moves forgiving.
  const compact = input.replace(/\s+/g, '');
  const exact = moves.filter(m => m.san.toLowerCase().replace(/[+#?!]/g, '') === compact);
  if (exact.length) return result(exact);

  let words = input.replace(/\b(takes|take|captures|capture)\b/g, 'x')
    .replace(/\b(from|to|on|the)\b/g, ' ')
    .replace(/\b(promotes?|promotion)\b/g, '=')
    .replace(/\b(?:a|an)\s+(?=queen|rook|bishop|knight)/g, '')
    .replace(/\s+/g, '');
  for (const [word, symbol] of Object.entries(pieces)) {
    if (word.length > 1) words = words.replaceAll(word, symbol);
  }
  const parsed = words.match(/^([pnbrqk])?([a-h][1-8]|[a-h]|[1-8])?(x)?([a-h][1-8])(?:=?([qrbn]))?$/);
  if (!parsed) return { error: 'I could not understand that move. Try "knight to f3", "e2e4", or "castle short".' };
  const [, piece, source, capture, destination, promotion] = parsed;
  return result(moves.filter(m =>
    (!piece || m.piece === piece) &&
    (!source || (source.length === 2 ? m.from === source : m.from.includes(source))) &&
    (!capture || m.isCapture() || m.isEnPassant()) &&
    m.to === destination &&
    (!promotion || m.promotion === promotion),
  ));
}
