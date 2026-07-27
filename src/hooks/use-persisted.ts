"use client";

import * as React from "react";

/**
 * Read a `localStorage` value as a React external store.
 *
 * `useSyncExternalStore` is the correct primitive here: the browser's storage
 * is genuinely external state, the server snapshot keeps hydration consistent,
 * and it avoids the setState-in-effect cascade that a naive `useEffect` read
 * would cause.
 */
export function usePersisted(key: string, fallback: string): [string, (value: string) => void] {
  const listeners = React.useRef(new Set<() => void>());

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      listeners.current.add(onStoreChange);
      const onStorage = (event: StorageEvent): void => {
        if (event.key === key) onStoreChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.current.delete(onStoreChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );

  const getSnapshot = React.useCallback((): string => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }, [fallback, key]);

  // The server has no storage, so it always renders the fallback; the first
  // client snapshot then reconciles without a flash of the wrong state.
  const getServerSnapshot = React.useCallback(() => fallback, [fallback]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = React.useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage may be unavailable in private modes — ignore */
      }
      for (const listener of listeners.current) listener();
    },
    [key],
  );

  return [value, setValue];
}
