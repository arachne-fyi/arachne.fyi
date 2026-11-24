import { ProLock, useIsPro } from '../components/Locked.tsx';
import { useState } from 'react';
import { rarityColour } from '@arachne/shared';
import { api } from '../api.ts';
import { Loading, Switch } from '../components/Bits.tsx';
import { coins, dayLabel, duration, int } from '../format.ts';
import { useLive } from '../hooks.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Your year of Arachne, one card at a time. */
export function Wrapped() {
  const now = new Date().getUTCFullYear();
  const [year, setYear] = useState(now);
  const pro = useIsPro();
  const w = useLive(() => (pro ? api.wrapped(year) : Promise.resolve(null)), [year, pro], 300_000);
  const years = [now - 1, now].map((y) => [String(y), String(y)] as const);
  return (
    <main>
      <div className="head">
        <h1>Your {year}</h1>
        <Switch label="Year" value={String(year)} onChange={(y) => setYear(Number(y))} options={years} />
      </div>
      {!pro ? (
        <ProLock what="Your year" preview={<div className="wrapped"><Card big="1.84B" text="profit" /><Card big="6,212" text="kills, on 141 different days" /><Card big="402h 17m" text="spent farming" /><Card big="2,960" text="crystals placed" /></div>} />
      ) : !w.data ? (
        <Loading error={w.error} />
      ) : w.data.totals.kills === 0 ? (
        <p className="empty">No kills in {year}.</p>
      ) : (
        <div className="wrapped">
          <Card big={coins(w.data.totals.profit)} text="profit" />
          <Card big={int(w.data.totals.kills)} text={`kills, on ${int(w.data.days)} different days`} />
          <Card big={duration(w.data.totals.uptimeMs)} text="spent farming" />
          <Card big={int(w.data.totals.crystals)} text="crystals placed" />
          {w.data.bestMonth && <Card big={MONTHS[w.data.bestMonth.month]!} text={`your best month: ${coins(w.data.bestMonth.profit)}`} />}
          {w.data.favouriteHour != null && (
            <Card big={`${String(w.data.favouriteHour).padStart(2, '0')}:00`} text="the hour that paid best (UTC)" />
          )}
          {w.data.bestDrop && (
            <div className="panel wrapped-card">
              <b style={{ color: rarityColour(w.data.bestDrop.item) }}>{w.data.bestDrop.name}</b>
              <span>
                best drop, worth {coins(w.data.bestDrop.value)} on {dayLabel(w.data.bestDrop.ts)}
              </span>
            </div>
          )}
          <Card big={int(w.data.badges)} text="badges earned" />
        </div>
      )}
    </main>
  );
}

function Card({ big, text }: { big: string; text: string }) {
  return (
    <div className="panel wrapped-card">
      <b>{big}</b>
      <span>{text}</span>
    </div>
  );
}
