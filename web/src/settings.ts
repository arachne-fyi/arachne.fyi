import { useEffect, useState } from 'react';
import type { Currency } from '@arachne/shared';

/**
 * Per-browser preferences, kept in localStorage. Nothing here is sent to the server.
 * A private window, or a browser that blocks storage, just falls back to the defaults.
 */
export interface Settings {
  /** "1.23M" or "1,234,567". */
  numbers: 'short' | 'full';
  currency: Currency;
  /** Daily profit goal in coins; 0 hides the goal bar. */
  dailyGoal: number;
  /** Play a short sound when a rare drop lands. */
  sound: boolean;
  /** Turn off the rare-drop spider and confetti. */
  calm: boolean;
  /** Show times in this computer's time zone, or in UTC (the "today" rule's clock). */
  tz: 'local' | 'utc';
  /** Last range picked on the Graphs page. */
  graphRange: 'session' | '24h' | '7d' | '30d';
  /** Moving panorama, the still picture, or a plain colour. */
  background: 'panorama' | 'still' | 'colour';
}

const DEFAULTS: Settings = { numbers: 'short', currency: 'GBP', dailyGoal: 0, sound: false, calm: false, tz: 'local', graphRange: 'session', background: 'panorama' };
const KEY = 'arachne-settings';
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    // The old currency switch stored its choice on its own.
    if (!raw.currency && localStorage.getItem('currency') === 'USD') raw.currency = 'USD';
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();

export const settings = (): Settings => current;

export function setSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* not remembered, still applied for this visit */
  }
  listeners.forEach((fn) => fn(current));
}

/** The settings, re-rendering the component whenever one changes. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return [s, setSettings];
}

/** Small things remembered between visits that are not settings (last milestone seen, ...). */
export function remembered(key: string): string | null {
  try {
    return localStorage.getItem(`arachne-${key}`);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(`arachne-${key}`, value);
  } catch {
    /* fine */
  }
}
