import { useState, type ReactNode } from 'react';
import { headUrl } from '../format.ts';

/** Pick one of a few, e.g. Today / 7 days / All time. */
export function Switch<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="switch" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Every on/off setting on the site uses this: On on the left, Off on the right, orange for
 * the active side. It is the same control as Switch so the two look alike, but the order and
 * the words are fixed here, so no page can put them the other way round.
 */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <div className="switch toggle" role="group" aria-label={label}>
      <button type="button" aria-pressed={on} disabled={disabled} onClick={() => !on && onChange(true)}>
        On
      </button>
      <button type="button" aria-pressed={!on} disabled={disabled} onClick={() => on && onChange(false)}>
        Off
      </button>
    </div>
  );
}

export const WINDOW_OPTIONS = [
  ['today', 'Today'],
  ['week', '7 days'],
  ['all', 'All time'],
] as const;
export type WindowKey = (typeof WINDOW_OPTIONS)[number][0];

export const SCOPE_OPTIONS = [
  ['group', 'Everyone'],
  ['user', 'Just me'],
] as const;

/** One big number with a short label. `hint` adds a "?" that explains it on hover. */
export function Tile({
  value,
  label,
  extra,
  hint,
  tone,
}: {
  value: string;
  label: string;
  extra?: string;
  hint?: string;
  tone?: 'gain' | 'loss';
}) {
  return (
    <div className="panel tile">
      <div className={`value ${tone ?? ''}`}>{value}</div>
      <div className="label">{label}</div>
      {extra && <div className="extra">{extra}</div>}
      {hint && (
        <span className="hint" tabIndex={0} aria-label={hint}>
          ?<span className="tip">{hint}</span>
        </span>
      )}
    </div>
  );
}

/** A Minecraft head next to the account name. Hidden if the head service is unreachable. */
export function Head({ uuid }: { uuid: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="head-icon" aria-hidden="true" />;
  return <img className="head-icon" src={headUrl(uuid)} alt="" onError={() => setFailed(true)} />;
}

/** Shown while something loads: a tip or a spider fact, so the wait is not empty. */
const TIPS = [
  'A kill needs 10,000 damage on the boss within 5 seconds of it dying.',
  '"Today" starts at midnight UTC, which is midnight in the UK in winter.',
  'Spiders are arachnids, not insects: eight legs, two body parts.',
  'Most spiders have eight eyes.',
  'Not every spider spins a web. Jumping spiders hunt by sight instead.',
  'Many orb-weaver spiders eat their old web before spinning a new one.',
  'Hover any number on the dashboard to see what it means.',
  'Per hour on the Overview counts real time, so two accounts at once do not double it.',
];
export function Loading({ error }: { error: string | null }) {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  return error ? (
    <p className="note bad">
      Could not load this ({error}). It tries again by itself; reload the page if it keeps happening.
    </p>
  ) : (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <i />
      <i />
      <i />
      <p className="faint">{tip}</p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Panel({ title, side, children, className }: { title?: string; side?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className ?? ''}`}>
      {(title || side) && (
        <header>
          {title && <h2>{title}</h2>}
          {side}
        </header>
      )}
      {children}
    </section>
  );
}
