import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { emit, type Rarity } from './bus';
import { bumpActivity, today } from './db';

// ---------------- Levels ----------------
export const xpForLevel = (l: number) => 50 * l * (l - 1); // cumulative XP to reach level l
export function levelFromXp(xp: number) {
  let l = 1;
  while (xpForLevel(l + 1) <= xp) l++;
  return l;
}
const TITLES: [number, string][] = [
  [1, 'Pawn'], [3, 'Pawn Storm'], [5, 'Knight Errant'], [8, 'Bishop Pair'], [12, 'Rook Lift'],
  [16, 'Queen Hunter'], [20, 'Candidate Master'], [25, 'Master'], [30, 'Grandmaster'], [40, 'Engine Mode'],
];
export const titleFor = (l: number) => [...TITLES].reverse().find(([n]) => l >= n)![1];

// ---------------- Quests ----------------
export type QuestKind = 'solve' | 'combo' | 'review' | 'retry' | 'rush' | 'theme' | 'perfect';
export interface Quest {
  id: string;
  kind: QuestKind;
  label: string;
  target: number;
  progress: number;
  reward: number;
  done: boolean;
}

const QUEST_POOL: Omit<Quest, 'id' | 'progress' | 'done'>[] = [
  { kind: 'solve', label: 'Solve 5 drills from your games', target: 5, reward: 40 },
  { kind: 'solve', label: 'Solve 10 drills', target: 10, reward: 70 },
  { kind: 'combo', label: 'Hit a 4× combo', target: 4, reward: 50 },
  { kind: 'combo', label: 'Hit a 7× combo', target: 7, reward: 90 },
  { kind: 'review', label: 'Review a game', target: 1, reward: 40 },
  { kind: 'retry', label: 'Fix 3 mistakes in Learn mode', target: 3, reward: 60 },
  { kind: 'rush', label: 'Score 8 in Blunder Rush', target: 8, reward: 70 },
  { kind: 'theme', label: 'Solve 3 weakness puzzles', target: 3, reward: 60 },
  { kind: 'perfect', label: 'Finish a session with 85%+ accuracy', target: 1, reward: 60 },
];

function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

function rollQuests(day: string): Quest[] {
  const rnd = seeded(day);
  const pool = [...QUEST_POOL];
  const picked: Quest[] = [];
  const kinds = new Set<QuestKind>();
  while (picked.length < 3 && pool.length) {
    const q = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    if (kinds.has(q.kind)) continue;
    kinds.add(q.kind);
    picked.push({ ...q, id: `${day}:${q.kind}`, progress: 0, done: false });
  }
  return picked;
}

// ---------------- Achievements ----------------
export const ACHIEVEMENTS: { id: string; label: string; desc: string; emoji: string }[] = [
  { id: 'first-review', label: 'Self-Aware', desc: 'Review your first game', emoji: '🔍' },
  { id: 'brilliant', label: 'Brilliancy', desc: 'Play a Brilliant move in a real game', emoji: '💎' },
  { id: 'great', label: 'Only Move', desc: 'Play a Great move in a real game', emoji: '⚡' },
  { id: 'solve-10', label: 'Pattern Spotter', desc: 'Solve 10 drills', emoji: '🧩' },
  { id: 'solve-100', label: 'Tactician', desc: 'Solve 100 drills', emoji: '🗡️' },
  { id: 'combo-10', label: 'On Fire', desc: 'Reach a 10× combo', emoji: '🔥' },
  { id: 'streak-7', label: 'Week Warrior', desc: '7-day streak', emoji: '📅' },
  { id: 'streak-30', label: 'Unstoppable', desc: '30-day streak', emoji: '🏔️' },
  { id: 'master-10', label: 'Never Again', desc: 'Master 10 of your mistakes', emoji: '🧠' },
  { id: 'rush-15', label: 'Speed Demon', desc: 'Score 15 in Blunder Rush', emoji: '🏎️' },
  { id: 'accuracy-90', label: 'Surgical', desc: '90%+ accuracy in a real game', emoji: '🎯' },
  { id: 'legendary', label: 'Jackpot', desc: 'Open a Legendary chest', emoji: '👑' },
];

export const BOARD_THEMES: { id: string; label: string; light: string; dark: string }[] = [
  { id: 'classic', label: 'Classic', light: '#ebecd0', dark: '#739552' },
  { id: 'ocean', label: 'Ocean', light: '#dee3e6', dark: '#788a94' },
  { id: 'wood', label: 'Walnut', light: '#f0d9b5', dark: '#b58863' },
  { id: 'neon', label: 'Neon', light: '#c9d4ff', dark: '#5b5fd6' },
  { id: 'sakura', label: 'Sakura', light: '#fde7ef', dark: '#d77fa1' },
  { id: 'ember', label: 'Ember', light: '#ffe2c2', dark: '#c4573a' },
  { id: 'void', label: 'Void', light: '#8d8fa8', dark: '#2b2d42' },
  { id: 'gold', label: 'Gold', light: '#fff4c7', dark: '#c9a227' },
];

export type Depth = 12 | 16 | 20;

interface State {
  username: string | null;
  avatar?: string;
  displayName?: string;
  settings: { depth: Depth; sound: boolean; autoAnalyse: boolean; notify: boolean; boardTheme: string };
  xp: number;
  streak: { count: number; best: number; lastDay: string | null; freezes: number };
  quests: { day: string; list: Quest[] };
  achievements: string[];
  unlockedThemes: string[];
  chests: number;
  trainingRating: number;
  stats: { drillsSolved: number; drillsFailed: number; gamesReviewed: number; bestCombo: number; rushBest: number; retriesFixed: number };
  lastSyncAt: number;
  // actions
  connect: (username: string, avatar?: string, displayName?: string) => void;
  disconnect: () => void;
  setSetting: <K extends keyof State['settings']>(k: K, v: State['settings'][K]) => void;
  addXP: (amount: number, at?: { x: number; y: number }) => void;
  ensureDay: () => void;
  progressQuest: (kind: QuestKind, value: number, mode?: 'add' | 'max') => void;
  unlock: (id: string) => void;
  stat: (k: keyof State['stats'], v: number, mode?: 'add' | 'max') => void;
  openChest: () => void;
  rateTraining: (opponent: number, score: 0 | 1) => number;
  setSynced: () => void;
}

const yesterday = () => today(new Date(Date.now() - 86_400_000));

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      username: null,
      settings: { depth: 16, sound: true, autoAnalyse: true, notify: true, boardTheme: 'classic' },
      xp: 0,
      streak: { count: 0, best: 0, lastDay: null, freezes: 1 },
      quests: { day: '', list: [] },
      achievements: [],
      unlockedThemes: ['classic', 'ocean', 'wood'],
      chests: 1,
      trainingRating: 1200,
      stats: { drillsSolved: 0, drillsFailed: 0, gamesReviewed: 0, bestCombo: 0, rushBest: 0, retriesFixed: 0 },
      lastSyncAt: 0,

      connect: (username, avatar, displayName) => set({ username, avatar, displayName }),
      disconnect: () => set({ username: null, avatar: undefined, displayName: undefined, lastSyncAt: 0 }),
      setSetting: (k, v) => set({ settings: { ...get().settings, [k]: v } }),
      setSynced: () => set({ lastSyncAt: Date.now() }),

      ensureDay: () => {
        const d = today();
        if (get().quests.day !== d) set({ quests: { day: d, list: rollQuests(d) } });
        // streak decays silently if a day was missed (freezes are consumed on next activity)
      },

      addXP: (amount, at) => {
        get().ensureDay();
        // Variable-ratio reward: 1 in 8 gains is a "critical" double.
        const crit = amount >= 5 && Math.random() < 0.125;
        const gain = crit ? amount * 2 : amount;
        const before = levelFromXp(get().xp);
        const xp = get().xp + gain;
        // streak update
        const s = { ...get().streak };
        const d = today();
        if (s.lastDay !== d) {
          if (s.lastDay === yesterday()) s.count++;
          else if (s.lastDay && s.freezes > 0 && s.lastDay === today(new Date(Date.now() - 2 * 86_400_000))) {
            s.freezes--;
            s.count++;
            emit({ type: 'toast', text: 'Streak Freeze used — your streak survived!', emoji: '🧊', tone: 'info' });
          } else s.count = 1;
          s.lastDay = d;
          s.best = Math.max(s.best, s.count);
          if (s.count > 1) emit({ type: 'toast', text: `${s.count}-day streak!`, emoji: '🔥', tone: 'good' });
        }
        set({ xp, streak: s });
        bumpActivity({ xp: gain });
        emit({ type: 'xp', amount: gain, x: at?.x, y: at?.y, crit });
        if (s.count >= 7) get().unlock('streak-7');
        if (s.count >= 30) get().unlock('streak-30');
        const after = levelFromXp(xp);
        if (after > before) {
          set({ chests: get().chests + 1 });
          emit({ type: 'levelup', level: after, title: titleFor(after) });
        }
      },

      progressQuest: (kind, value, mode = 'add') => {
        get().ensureDay();
        const q = get().quests;
        let reward = 0;
        const list = q.list.map((x) => {
          if (x.kind !== kind || x.done) return x;
          const progress = mode === 'add' ? x.progress + value : Math.max(x.progress, value);
          const done = progress >= x.target;
          if (done) {
            reward += x.reward;
            emit({ type: 'quest', label: x.label, reward: x.reward });
          }
          return { ...x, progress: Math.min(progress, x.target), done };
        });
        set({ quests: { ...q, list } });
        if (reward) {
          setTimeout(() => get().addXP(reward), 900);
          if (list.every((x) => x.done)) set({ chests: get().chests + 1 });
        }
      },

      unlock: (id) => {
        if (get().achievements.includes(id)) return;
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (!a) return;
        set({ achievements: [...get().achievements, id], chests: get().chests + 1 });
        emit({ type: 'achievement', id, label: a.label, emoji: a.emoji });
      },

      stat: (k, v, mode = 'add') => {
        const stats = { ...get().stats };
        stats[k] = mode === 'add' ? stats[k] + v : Math.max(stats[k], v);
        set({ stats });
        if (stats.drillsSolved >= 10) get().unlock('solve-10');
        if (stats.drillsSolved >= 100) get().unlock('solve-100');
        if (stats.bestCombo >= 10) get().unlock('combo-10');
        if (stats.rushBest >= 15) get().unlock('rush-15');
      },

      openChest: () => {
        if (get().chests <= 0) return;
        const r = Math.random();
        const rarity: Rarity = r < 0.02 ? 'legendary' : r < 0.12 ? 'epic' : r < 0.4 ? 'rare' : 'common';
        const xp = { common: 25 + Math.floor(Math.random() * 30), rare: 90, epic: 200, legendary: 500 }[rarity];
        let extra: string | undefined;
        const locked = BOARD_THEMES.filter((t) => !get().unlockedThemes.includes(t.id));
        const patch: Partial<State> = { chests: get().chests - 1 };
        if ((rarity === 'epic' || rarity === 'legendary') && locked.length) {
          const t = locked[Math.floor(Math.random() * locked.length)];
          patch.unlockedThemes = [...get().unlockedThemes, t.id];
          extra = `Board theme: ${t.label}`;
        } else if (rarity === 'rare' && Math.random() < 0.5) {
          patch.streak = { ...get().streak, freezes: get().streak.freezes + 1 };
          extra = 'Streak Freeze 🧊';
        }
        set(patch);
        emit({ type: 'chest', rarity, xp, extra });
        setTimeout(() => get().addXP(xp), 1600);
        if (rarity === 'legendary') get().unlock('legendary');
      },

      rateTraining: (opp, score) => {
        const r = get().trainingRating;
        const exp = 1 / (1 + 10 ** ((opp - r) / 400));
        const next = Math.round(r + 24 * (score - exp));
        set({ trainingRating: Math.max(100, next) });
        return next - r;
      },
    }),
    { name: 'chesspersonal-progress', version: 1 },
  ),
);
