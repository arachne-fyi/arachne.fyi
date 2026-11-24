/* Get Pro: $4.99 once, for the lifetime of the service. Apple Pay, Google Pay or crypto.
   Payments are not wired up yet: the buttons say so and nothing is charged. */
import { useState } from 'react';
import { usePlan } from '../components/Locked.tsx';
import { dayLabel } from '../format.ts';
import type { User } from './data.ts';
import type { Go } from './App.tsx';
import { linkTo } from './App.tsx';

export const PRO_PRICE = '$4.99';

type Coin = { code: string; network: string; amount: string };
const COINS: Coin[] = [
  { code: 'USDC', network: '[network]', amount: '4.99 USDC' },
  { code: 'USDT', network: '[network]', amount: '4.99 USDT' },
  { code: 'BTC', network: 'Bitcoin', amount: '[amount] BTC' },
  { code: 'ETH', network: 'Ethereum', amount: '[amount] ETH' },
  { code: 'SOL', network: 'Solana', amount: '[amount] SOL' },
];

const NOT_LIVE = "Payments aren't switched on yet, so nothing was charged. Pro opens for buying soon.";

export function ProPage({ user, go }: { user: User; go: Go }) {
  const plan = usePlan();
  const [step, setStep] = useState<'choose' | 'crypto'>('choose');
  const [msg, setMsg] = useState<string | null>(null);

  if (plan.plan === 'pro') return <Owned user={user} go={go} />;
  if (step === 'crypto') return <Crypto back={() => setStep('choose')} />;

  const pay = () => setMsg(NOT_LIVE);
  return (
    <main className="dpage dpage-narrow">
      <div className="pro-hero">
        <span className="px eyebrow">Arachne.fyi Pro</span>
        <h1 className="px dh1">Pay once. Keep it.</h1>
        <p className="soft">No subscription. One payment unlocks Pro on your account for the lifetime of the service.</p>
      </div>

      <div className="pro-cols">
        <section className="panel card" aria-labelledby="pro-adds">
          <h2 id="pro-adds" className="px dh2">What Pro adds</h2>
          <ul className="pro-list">
            <li>
              <span className="tick" aria-hidden="true" />
              <span>
                <b>HD graphs.</b> <span className="soft">Coins, Soul String and Spider Essence, every member as a line.</span>
              </span>
            </li>
            <li>
              <span className="tick" aria-hidden="true" />
              <span>
                <b>Projections.</b> <span className="soft">Where you and your group land at your current pace.</span>
              </span>
            </li>
            <li>
              <span className="tick" aria-hidden="true" />
              <span>
                <b>Deep stats.</b> <span className="soft">Full breakdowns per member and per drop.</span>
              </span>
            </li>
          </ul>
          <p className="muted small pro-free">Free stays free: the mod, groups, member profiles and totals.</p>
        </section>

        <section className="panel card pro-buy" aria-labelledby="pro-pay">
          <h2 id="pro-pay" className="sr-only">Pay</h2>
          <div className="pro-price">
            <span className="px">{PRO_PRICE}</span>
            <span className="px gold">one time</span>
          </div>
          <div className="pro-for">
            <span className="muted">Unlocks Pro for</span>
            <span>{user.name}</span>
          </div>
          <div className="stack">
            <button type="button" className="paybtn pay-apple" onClick={pay} aria-label="Pay with Apple Pay">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.8-2.3c.9-1.3 1.2-2.5 1.2-2.6 0 0-2.4-.9-2.4-3.6zM14.1 5.5c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z" />
              </svg>
              Pay
            </button>
            <button type="button" className="paybtn pay-google" onClick={pay} aria-label="Pay with Google Pay">
              <b>G</b> Pay
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => (setMsg(null), setStep('crypto'))}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 2l8 5v10l-8 5-8-5V7z" />
                <path d="M12 22V12M20 7l-8 5-8-5" />
              </svg>
              Pay with crypto
            </button>
          </div>
          {msg && (
            <p className="note" role="status">
              {msg}
            </p>
          )}
          <p className="muted small">Apple Pay shows on Safari and Apple devices, Google Pay on Chrome and Android. Arachne.fyi never sees your card.</p>
          <p className="muted small">
            "Lifetime" means for as long as Arachne.fyi runs. <a href="/terms">Terms</a>
          </p>
        </section>
      </div>
    </main>
  );
}

function Crypto({ back }: { back: () => void }) {
  const [coin, setCoin] = useState('USDC');
  const c = COINS.find((x) => x.code === coin) ?? COINS[0]!;
  return (
    <main className="dpage dpage-narrow pro-crypto">
      <div className="dhead">
        <div className="dhead-words">
          <span className="px eyebrow">Pro · {PRO_PRICE} one time</span>
          <h1 className="px dh1">Pay with crypto</h1>
        </div>
        <button type="button" className="btn btn-ghost" onClick={back}>
          Back
        </button>
      </div>

      <p className="note" role="status">
        {NOT_LIVE} The amount and address below are placeholders.
      </p>

      <fieldset className="pro-coins">
        <legend className="px gold">Coin</legend>
        <div className="row-gap">
          {COINS.map((x) => (
            <button key={x.code} type="button" className="coinbtn px" aria-pressed={x.code === coin} onClick={() => setCoin(x.code)}>
              {x.code}
            </button>
          ))}
        </div>
      </fieldset>

      <section className="panel card pro-send" aria-label="Payment details">
        <div className="pro-qr" role="img" aria-label="QR code, shown once payments are on">
          QR code
        </div>
        <div className="stack grow">
          <div>
            <div className="muted small">Send exactly</div>
            <div className="px pro-amount">{c.amount}</div>
            <div className="muted small">Network: {c.network}</div>
          </div>
          <label className="field">
            <span className="muted small">To this address</span>
            <input className="input mono" readOnly value="[address]" />
          </label>
        </div>
      </section>

      <p className="muted small">Send on the network shown or the payment can be lost. The price is fixed for 15 minutes. Crypto payments can't be reversed, so refunds go back as the same coin.</p>
    </main>
  );
}

function Owned({ user, go }: { user: User; go: Go }) {
  const plan = usePlan();
  return (
    <main className="dpage dpage-narrow">
      <div className="pro-hero">
        <h1 className="px dh1">
          Pro is <span className="hot">yours</span>.
        </h1>
        <p className="soft">HD graphs, projections and deep stats are on for {user.name}. No renewals, nothing to cancel.</p>
        {plan.until && <p className="muted small">This Pro time comes from a code and runs until {dayLabel(plan.until)}.</p>}
        <div className="row-gap" style={{ justifyContent: 'center' }}>
          <a href="/graphs" className="btn btn-main" onClick={linkTo(go, '/graphs')}>
            Open graphs
          </a>
          <a href="/" className="btn btn-ghost" onClick={linkTo(go, '/')}>
            Back to group
          </a>
        </div>
      </div>
    </main>
  );
}
