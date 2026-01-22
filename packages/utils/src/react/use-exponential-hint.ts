import { useEffect, useState } from 'react';

const STORAGE_KEY = 'exponential-hints';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type HintState = { dismissCount: number; lastDismissedAt: number | null };
type HintsStorage = Record<string, HintState>;
type Options = {
  /** Base interval in days (default: 4) */
  baseDays?: number;
  /** Max dismissals before permanently hidden (default: 3) */
  maxDismissals?: number;
};

function getAllHints(): HintsStorage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as HintsStorage;
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function getHintState(key: string): HintState {
  const hints = getAllHints();
  return hints[key] ?? { dismissCount: 0, lastDismissedAt: null };
}

function saveHintState(key: string, state: HintState): void {
  try {
    const hints = getAllHints();
    hints[key] = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hints));
  } catch {
    // Ignore storage errors
  }
}

function shouldShowHint(key: string, baseDays: number, maxDismissals: number): boolean {
  const state = getHintState(key);

  // Permanently hidden after max dismissals
  if (state.dismissCount >= maxDismissals) return false;

  // First time - show hint
  if (state.lastDismissedAt === null) return true;

  // Handle the case where the system clock is set back in time
  if (Date.now() < state.lastDismissedAt) return false;

  // Calculate required wait time: baseDays^dismissCount days
  const requiredDays = Math.pow(baseDays, state.dismissCount);
  const daysSinceLastDismiss = (Date.now() - state.lastDismissedAt) / MS_PER_DAY;

  return daysSinceLastDismiss >= requiredDays;
}

/**
 * Hook for showing hints with exponential backoff after dismissal.
 *
 * - First dismissal: wait baseDays before showing again
 * - Second dismissal: wait baseDays^2 days
 * - Third dismissal: wait baseDays^3 days
 * - After maxDismissals: permanently hidden
 *
 * All hints are stored in a single localStorage key: "exponential-hints"
 */
export function useExponentialHint(key: Lowercase<string>, options: Options = {}) {
  const { baseDays = 4, maxDismissals = 3 } = options;

  // Start with false to avoid SSR hydration mismatch and check localStorage after
  // mount (client-side only)
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(shouldShowHint(key, baseDays, maxDismissals));
  }, [key, baseDays, maxDismissals]);

  const dismiss = () => {
    const state = getHintState(key);
    saveHintState(key, { dismissCount: state.dismissCount + 1, lastDismissedAt: Date.now() });
    setVisible(false);
  };

  return { visible, dismiss };
}
