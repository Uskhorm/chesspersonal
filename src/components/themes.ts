/** Board themes ('classic' is the stored default id, rendered as Slate). Slate is the house board: it lets move-quality colours do the talking. */
export const THEMES: { id: string; label: string; light: string; dark: string; free?: boolean }[] = [
  { id: 'classic', label: 'Slate', light: '#dfe5ec', dark: '#7d8ca3', free: true },
  { id: 'tournament', label: 'Tournament', light: '#eeeed2', dark: '#769656', free: true },
  { id: 'wood', label: 'Walnut', light: '#f0d9b5', dark: '#b58863', free: true },
  { id: 'ocean', label: 'Harbour', light: '#d8e6ee', dark: '#4f7a96' },
  { id: 'sakura', label: 'Blossom', light: '#f6e4e8', dark: '#c27c8e' },
  { id: 'ember', label: 'Ember', light: '#f5dfc8', dark: '#b4593c' },
  { id: 'void', label: 'Midnight', light: '#9aa3b5', dark: '#3a4256' },
  { id: 'gold', label: 'Gilt', light: '#f8edc4', dark: '#b8932a' },
  { id: 'neon', label: 'Ultra', light: '#dad9ff', dark: '#5652d6' },
];

export function themeFor(id: string | undefined) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
