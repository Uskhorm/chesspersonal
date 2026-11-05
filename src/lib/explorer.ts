import { useEffect, useMemo, useReducer, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Key } from '@lichess-org/chessground/types';
import type { Arrow } from '../components/Board';
import type { Color } from './types';
import { createLiveSession, startLive, type LiveLine } from './live';
import { describeMove } from './narrate';

export interface ExplorerNode {
  id: string;
  parent: string | null;
  uci: string | null;
  san: string | null;
  fen: string;
  children: string[];
}
export interface ExplorerState { nodes: Record<string, ExplorerNode>; current: string; nextId: number }
export type ExplorerAction = { type: 'playLine'; ucis: string[] } | { type: 'back' } | { type: 'forward' }
  | { type: 'goto'; id: string } | { type: 'reset'; fen: string };

export function createExplorerState(fen: string): ExplorerState {
  return { nodes: { root: { id: 'root', parent: null, uci: null, san: null, fen: new Chess(fen).fen(), children: [] } }, current: 'root', nextId: 1 };
}

export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  const node = state.nodes[state.current];
  if (action.type === 'reset') return createExplorerState(action.fen);
  if (action.type === 'goto') return state.nodes[action.id] ? { ...state, current: action.id } : state;
  if (action.type === 'back') return node.parent ? { ...state, current: node.parent } : state;
  if (action.type === 'forward') return node.children[0] ? { ...state, current: node.children[0] } : state;
  let result = state;
  for (const uci of action.ucis) {
    const parent = result.nodes[result.current];
    const chess = new Chess(parent.fen);
    try {
      const move = chess.move(uci);
      const existing = parent.children.find(id => result.nodes[id].uci === move.lan);
      if (existing) { result = { ...result, current: existing }; continue; }
      const id = String(result.nextId);
      const child: ExplorerNode = { id, parent: parent.id, uci: move.lan, san: move.san, fen: chess.fen(), children: [] };
      result = { current: id, nextId: result.nextId + 1, nodes: { ...result.nodes,
        [parent.id]: { ...parent, children: [...parent.children, id] }, [id]: child } };
    } catch { break; }
  }
  return result;
}

export function useExplorer(startFen: string, opts?: { perspective: Color; engine?: boolean }) {
  const engineOn = opts?.engine !== false;
  const [state, dispatch] = useReducer(explorerReducer, startFen, createExplorerState);
  const [evaluation, setEvaluation] = useState<{ fen: string; lines: LiveLine[]; depth: number }>({ fen: '', lines: [], depth: 0 });
  const [threatResult, setThreat] = useState({ fen: '', text: '' });
  const threatSearch = useMemo(() => createLiveSession(), []);
  const node = state.nodes[state.current];
  const fen = node.fen;
  useEffect(() => { dispatch({ type: 'reset', fen: startFen }); }, [startFen]);
  // No searches at all when the engine is switched off (saves battery on phones).
  useEffect(() => (engineOn ? startLive(fen, { onUpdate: (lines, depth) => setEvaluation({ fen, lines, depth }) }) : undefined), [fen, engineOn]);
  useEffect(() => {
    if (!engineOn) return;
    const chess = new Chess(fen);
    if (chess.inCheck() || chess.isGameOver()) return;
    const fields = fen.split(' ');
    fields[1] = chess.turn() === 'w' ? 'b' : 'w';
    fields[3] = '-'; // A hypothetical pass expires en passant rights.
    const hypothetical = fields.join(' ');
    return threatSearch(hypothetical, { multipv: 1, onUpdate: lines => {
      if (lines[0]) setThreat({ fen, text: describeMove(hypothetical, lines[0].uci, { perspective: opts?.perspective }) });
    } });
  }, [fen, opts?.perspective, threatSearch, engineOn]);
  const lines = evaluation.fen === fen ? evaluation.lines : [];
  const path: ExplorerNode[] = [];
  for (let current: ExplorerNode | undefined = node; current; current = current.parent ? state.nodes[current.parent] : undefined) path.unshift(current);
  const chess = new Chess(fen);
  const legalDests = new Map<Key, Key[]>();
  for (const move of chess.moves({ verbose: true })) {
    const dests = legalDests.get(move.from) ?? [];
    if (!dests.includes(move.to)) dests.push(move.to);
    legalDests.set(move.from, dests);
  }
  const arrows: Arrow[] = lines.slice(0, 3).map((line, i) => ({ from: line.uci.slice(0, 2), to: line.uci.slice(2, 4), brush: i === 0 ? 'best' : 'alt' }));
  return { fen, lastMove: node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] as [string, string] : undefined,
    turn: chess.turn(), node, path, canBack: node.parent !== null, canForward: node.children.length > 0,
    lines, depth: evaluation.fen === fen ? evaluation.depth : 0, threat: threatResult.fen === fen ? threatResult.text : '', arrows, legalDests,
    actions: {
      play: (from: string, to: string, promo?: string) => {
        const promotion = promo ?? (chess.get(from as Square)?.type === 'p' && /[18]$/.test(to) ? 'q' : '');
        dispatch({ type: 'playLine', ucis: [from + to + promotion] });
      },
      back: () => dispatch({ type: 'back' }), forward: () => dispatch({ type: 'forward' }),
      goto: (id: string) => dispatch({ type: 'goto', id }),
      reset: (nextFen = startFen) => dispatch({ type: 'reset', fen: nextFen }),
      playLine: (ucis: string[]) => dispatch({ type: 'playLine', ucis }),
    } };
}
