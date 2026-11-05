import { Chess, type Move, type PieceSymbol } from 'chess.js';
import type { Color } from './types';

export interface NarrateOptions {
  perspective?: Color;
  style?: 'short' | 'full';
}

const names: Record<PieceSymbol, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

export function pieceName(type: PieceSymbol): string {
  return names[type];
}

/** Algebraic square names are already readable in English prose. */
export function squareName(sq: string): string {
  if (!/^[a-h][1-8]$/.test(sq)) throw new Error(`Invalid square: ${sq}`);
  return sq;
}

function resolve(chess: Chess, move: string): Move {
  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(move.trim());
  return chess.move(uci
    ? { from: uci[1].toLowerCase(), to: uci[2].toLowerCase(), promotion: uci[3]?.toLowerCase() }
    : move.trim());
}

function narrate(move: Move, opts: NarrateOptions): string {
  const mate = move.san.endsWith('#');
  const check = move.san.endsWith('+');
  const kingside = move.isKingsideCastle();
  const queenside = move.isQueensideCastle();
  const castle = kingside || queenside;
  const side = kingside ? 'kingside' : 'queenside';
  const piece = pieceName(move.piece);
  const destination = squareName(move.to);

  if (opts.style === 'short') {
    let text = castle ? `Castle ${side}`
      : `${piece[0].toUpperCase()}${piece.slice(1)} ${move.captured ? 'takes' : 'to'} ${destination}`;
    if (move.isEnPassant()) text += ' en passant';
    if (move.promotion) text += `, promotes to ${pieceName(move.promotion)}`;
    return text + (mate ? '#' : check ? '+' : '');
  }

  const own = opts.perspective === move.color;
  const owner = opts.perspective ? (own ? 'Your' : 'Their') : (move.color === 'w' ? "White's" : "Black's");
  let text: string;
  if (castle) {
    text = opts.perspective
      ? `${own ? 'You' : 'They'} castle ${side}`
      : `${move.color === 'w' ? 'White' : 'Black'} castles ${side}`;
  } else {
    text = `${owner} ${piece}`;
    if (move.isEnPassant()) text += ` takes the pawn en passant on ${destination}`;
    else if (move.captured) text += ` takes the ${pieceName(move.captured)} on ${destination}`;
    else if (!move.promotion) text += ` ${move.piece === 'n' ? 'jumps' : 'moves'} to ${destination}`;
    if (move.promotion) {
      text += `${move.captured ? ' and' : ''} promotes to a ${pieceName(move.promotion)}`;
      if (!move.captured) text += ` on ${destination}`;
    }
  }
  return text + (mate ? ', checkmate' : check ? ', check' : '');
}

/** Describe a legal SAN or UCI move. Invalid FENs and illegal moves throw. */
export function describeMove(fenBefore: string, move: string, opts: NarrateOptions = {}): string {
  return narrate(resolve(new Chess(fenBefore), move), opts);
}

/** Resolve moves sequentially without modifying the caller's position. Throws on an invalid line. */
export function describeLine(fen: string, moves: string[], opts: NarrateOptions = {}): string[] {
  const chess = new Chess(fen);
  return moves.map(move => narrate(resolve(chess, move), opts));
}
