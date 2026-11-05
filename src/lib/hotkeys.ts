import { useEffect, type DependencyList } from 'react';

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function keyName(key: string): string {
  const aliases: Record<string, string> = {
    '←': 'arrowleft', left: 'arrowleft', '→': 'arrowright', right: 'arrowright',
    space: ' ', spacebar: ' ', esc: 'escape',
  };
  return aliases[key.toLowerCase()] ?? key.toLowerCase();
}

/** Map keys use KeyboardEvent.key, with left/right/space/esc aliases also accepted. */
export function useHotkeys(map: HotkeyMap, deps: DependencyList): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlers = new Map(Object.entries(map).map(([key, handler]) => [keyName(key), handler]));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const typing = event.composedPath().some(target => target instanceof HTMLElement && (
        target.isContentEditable || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
      ));
      if (typing) return;
      const handler = handlers.get(keyName(event.key));
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [map, ...deps]);
}
