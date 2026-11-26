/* Building blocks for the new dashboard. Styles are in dash.css (on top of landing.css and site.css). */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { headUrl } from '../offline.ts';

/** Pick one of a few, e.g. Today / 7 days / All time. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className="px" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** On/off switch. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" disabled={disabled} onClick={() => onChange(!on)}>
      <span className="toggle-knob" aria-hidden="true" />
    </button>
  );
}

/**
 * The custom dropdown (same look and keys as the public pages' one): a button with a list.
 * Up/Down/Home/End move, Enter/Space pick, Escape closes, letters jump.
 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  label,
  small,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const index = Math.max(0, options.findIndex(([v]) => v === value));
  const current = options[index];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = (at = index) => {
    setActive(at);
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (o && o[0] !== value) onChange(o[0]);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        show(e.key === 'Home' ? 0 : last);
      }
      return;
    }
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive(Math.min(last, active + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive(Math.max(0, active - 1)));
    else if (e.key === 'Home') (e.preventDefault(), setActive(0));
    else if (e.key === 'End') (e.preventDefault(), setActive(last));
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), pick(active));
    else if (e.key === 'Escape') (e.preventDefault(), setOpen(false));
    else if (e.key === 'Tab') pick(active);
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      for (let n = 1; n <= options.length; n++) {
        const i = (active + n) % options.length;
        if (options[i]![1].toLowerCase().startsWith(k)) return setActive(i);
      }
    }
  };

  return (
    <div className={`select dd${small ? ' select-small' : ''}`} ref={wrap}>
      <button
        type="button"
        className="dd-button px"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        onBlur={(e) => !wrap.current?.contains(e.relatedTarget as Node | null) && setOpen(false)}
      >
        <span className="dd-value">
          <span className="dd-text">{current?.[1] ?? ''}</span>
        </span>
      </button>
      {open && (
        <ul className="dd-list" role="listbox" id={`${id}-list`} aria-label={label} ref={list} onMouseDown={(e) => e.preventDefault()}>
          {options.map(([v, text], i) => (
            <li
              key={String(v)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={v === value}
              className={`dd-option${i === active ? ' dd-active' : ''}`}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => pick(i)}
            >
              <span className="dd-text">{text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Card({ title, side, children, className = '', id }: { title?: ReactNode; side?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel card ${className}`} id={id}>
      {(title || side) && (
        <div className="card-head">
          {title && <h2 className="px card-title">{title}</h2>}
          {side && <div className="card-side">{side}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tile({ label, value, sub, tone, big }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'hot' | 'gain' | 'loss'; big?: boolean }) {
  return (
    <div className="panel tile">
      <span className="tile-label">{label}</span>
      <span className={`px tile-value${tone ? ` ${tone}` : ''}${big ? ' tile-big' : ''}`}>{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

/** A setting row: words on the left, the control on the right. */
export function Setting({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-words">
        <b>{title}</b>
        {note && <div className="muted small">{note}</div>}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  if (error) return <p className="note bad">{error === 'pro_required' ? 'This needs Pro.' : "Couldn't load this. It tries again on its own."}</p>;
  return <p className="empty">Loading…</p>;
}

const COLOURS = ['#ff8a1f', '#3ddc84', '#6aa8ff', '#c08cff', '#facc15', '#f472b6', '#2dd4bf', '#f87171'];
export const colourAt = (i: number) => COLOURS[i % COLOURS.length]!;

/** Discord picture, or a coloured square with the first letter. */
export function Avatar({ name, src, size = 28, colour }: { name: string; src?: string | null; size?: number; colour?: string }) {
  if (src) return <img className="av" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  return (
    <span className="av px" aria-hidden="true" style={{ width: size, height: size, fontSize: size >= 64 ? 48 : 16, background: colour ?? '#ff8a1f' }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** A Minecraft head from mc-heads.net (allowed by the site's CSP); a local stand-in offline. */
export function Head({ uuid, size = 28 }: { uuid: string; size?: number }) {
  return <img className="av head" src={headUrl(uuid, size)} alt="" width={size} height={size} style={{ width: size, height: size }} />;
}

export function ProLock({ children, what }: { children: ReactNode; what: string }) {
  return (
    <div className="pro-wrap">
      <div className="pro-blur" aria-hidden="true" inert>
        {children}
      </div>
      <div className="lock">
        <div className="lock-box">
          <span className="px tag tag-latest">Pro</span>
          <span className="soft">
            {what} The chart behind this is example data.
          </span>
          <a className="btn btn-main" href="/pro">
            Get Pro · $4.99 once
          </a>
        </div>
      </div>
    </div>
  );
}

/** A hover box for bar and cell charts, styled like .tip and placed above the bar or cell under the
    pointer. Put the class "tip-host" on the chart's wrapper, spread on(value) onto each bar or cell,
    call hide on the wrapper's pointer leave and render <FloatTip at={tip}> inside the wrapper. */
export function useHoverTip<T>() {
  const [tip, setTip] = useState<{ x: number; y: number; v: T } | null>(null);
  return {
    tip,
    hide: () => setTip(null),
    on: (v: T) => ({
      onPointerEnter: (e: ReactPointerEvent<Element>) => {
        const host = e.currentTarget.closest('.tip-host');
        if (!host) return;
        const b = host.getBoundingClientRect();
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ x: r.left + r.width / 2 - b.left, y: r.top - b.top, v });
      },
    }),
  };
}

export function FloatTip({ at, children }: { at: { x: number; y: number } | null; children?: ReactNode }) {
  if (!at) return null;
  return (
    <div className="tip ftip" style={{ left: `clamp(100px, ${at.x}px, calc(100% - 100px))`, top: at.y }}>
      {children}
    </div>
  );
}

/** Copy to the clipboard, with a "Copied" moment. */
export function CopyButton({ text, label = 'Copy', main }: { text: string; label?: string; main?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${main ? 'btn-main' : 'btn-ghost'}`}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? 'Copied' : label}
    </button>
  );
}
