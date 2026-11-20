// "Ask": the chat, the app's second function. The AI (in the demo, a lookup
// on the sample lists) writes the answer. This screen reads two things out
// of it, the guest's allergies and the items it names, and prints the app's
// own labels around the answer: the warnings above it and the ticket under
// it. Those are worked out again on every change to the guest's allergies or
// to the 86 board, so an old answer never shows an old label.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { MenuItem } from '../types';
import { api } from '../api';
import { ALLERGENS, allergenLabel, boardNow, inOrder, isOut, listWords } from '../../shared/assistant/catalog';
import type { AllergenKey, AssistantCatalog, AssistantItem, BoardNow } from '../../shared/assistant/catalog';
import type { Turn } from '../../shared/assistant/prompt';
import { claimsSafe, detectAllergens, makeResolver, parseReply, splitBody } from '../../shared/assistant/reply';
import { stampReply } from '../../shared/assistant/stamp';
import type { Card, Stamp } from '../../shared/assistant/stamp';

type Msg =
  | { id: number; kind: 'me'; text: string }
  | { id: number; kind: 'sys'; text: string } // "Now checking for egg."
  | { id: number; kind: 'bot'; raw: string; done: boolean; cut: boolean };

interface AskProps {
  restaurantId: string;
  catalog: AssistantCatalog;
  items: MenuItem[]; // the live board: what is 86'd or running low
  visible: boolean; // false while another tab is showing; the chat is kept
  sample: boolean; // sample mode: the answers are looked up, there is no AI
}

type MarkKind = 'no' | 'ask' | 'ok' | 'nodata' | 'checked' | 'none';

// The small drawn marks. Each label has its own shape, so it reads without color.
function Mark({ kind }: { kind: MarkKind }) {
  return (
    <svg className="ask-mark" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'checked' ? (
        <>
          <path d="M12 3l7 2.8v5.4c0 4.4-2.8 7.7-7 9.8-4.2-2.1-7-5.4-7-9.8V5.8z" />
          <path d="M9 12l2.1 2.1 4-4.2" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" strokeDasharray={kind === 'nodata' ? '3.1 3.97' : undefined} />
          {kind === 'no' && <path d="M5.8 5.8l12.4 12.4" />}
          {kind === 'ask' && <path d="M9.7 9.5a2.4 2.4 0 1 1 3.6 2.1c-.8.5-1.3 1-1.3 1.9M12 16.9v.2" />}
        </>
      )}
    </svg>
  );
}

function Pick({ card }: { card: Card }) {
  const { item } = card;
  const prices = item.prices ? ([['glass', item.prices.glass], ['carafe', item.prices.carafe], ['bottle', item.prices.bottle]] as const).filter((p) => p[1]) : [];
  return (
    <li className={'ask-pick' + (card.tone ? ' is-' + card.tone : '')}>
      <div className="ask-pick-head">
        <span className="ask-pick-name">{item.name}</span>
        {card.label && (
          <span className="ask-label">
            <Mark kind={card.tone === '' ? 'none' : card.tone} />
            {card.label}
          </span>
        )}
      </div>
      {item.kind === 'wine' ? (
        <>
          <p className="ask-pick-meta">{item.section + (item.about ? ', ' + item.about : '')}</p>
          {prices.length > 0 && (
            <p className="ask-prices num">
              {prices.map(([unit, price]) => (
                <span key={unit}>
                  <b>${price}</b> {unit}
                </span>
              ))}
            </p>
          )}
        </>
      ) : (
        <p className="ask-pick-meta">
          <span className="ask-section">{item.section}</span> {item.about}
        </p>
      )}
      {card.reasons.length > 0 && (
        <ul className="ask-reasons">
          {card.reasons.map((r, i) => (
            <li key={i} className={'is-' + r.tone}>
              {r.label && <b>{r.label}: </b>}
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// The ticket under an answer: every item it named, with the app's own label.
function Ticket({ stamp }: { stamp: Stamp }) {
  return (
    <div className="ticket ask-ticket">
      {stamp.cards.length > 0 && (
        <p className="ask-kicker">
          {stamp.checked && <Mark kind="checked" />}
          {stamp.kicker}
        </p>
      )}
      {stamp.cards.length > 0 && (
        <ul className="ask-picks">
          {stamp.cards.map((c) => (
            <Pick key={c.item.name} card={c} />
          ))}
        </ul>
      )}
      {stamp.more > 0 && <p className="ask-ticket-note">And {stamp.more} more. Ask about fewer items at a time to see each label.</p>}
      {stamp.safeNote && <p className="ask-ticket-note">The app never calls anything safe. Go by the labels, and tell the kitchen and the bar.</p>}
    </div>
  );
}

interface ReplyProps {
  msg: Extract<Msg, { kind: 'bot' }>;
  name: string;
  picked: AllergenKey[];
  now: BoardNow;
  resolve: (name: string) => AssistantItem | null;
}

function Reply({ msg, name, picked, now, resolve }: ReplyProps) {
  const parsed = parseReply(msg.raw, msg.done);
  const body = parsed.wait ? null : splitBody(parsed.body, msg.done, resolve);
  const stamp = msg.done && body && !parsed.wait ? stampReply(body.found, picked, now, parsed.other, claimsSafe(parsed.body)) : null;
  const empty = !body || body.paras.length === 0;
  return (
    <div className={'ask-msg ask-bot' + (msg.done ? '' : ' is-live')} data-ask-msg={msg.id}>
      {stamp && stamp.alerts.length > 0 && (
        <div className="ask-alerts">
          {stamp.alerts.map((a) => (
            <p key={a.text} className={'ask-alert is-' + a.tone}>
              <Mark kind={a.tone} />
              <span>{a.text}</span>
            </p>
          ))}
        </div>
      )}
      <div className="ask-text">
        <span className="sr-only">{name === 'Ask' ? 'Answer' : name}: </span>
        {empty ? (
          msg.done ? (
            <p>No answer came back. Ask again in other words.</p>
          ) : (
            <span className="ask-typing" role="img" aria-label="Thinking">
              <i />
              <i />
              <i />
            </span>
          )
        ) : (
          body.paras.map((segs, i) => (
            <p key={i}>
              {segs.map((s, j) =>
                typeof s === 'string' ? (
                  s
                ) : (
                  <b key={j} className="ask-item">
                    {s.name}
                  </b>
                ),
              )}
            </p>
          ))
        )}
        {msg.cut && <p className="ask-note">The answer was cut short.</p>}
      </div>
      {stamp && (stamp.cards.length > 0 || stamp.safeNote) && <Ticket stamp={stamp} />}
    </div>
  );
}

export function Ask({ restaurantId, catalog, items, visible, sample }: AskProps) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [picked, setPicked] = useState<AllergenKey[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const nextId = useRef(1);
  const pickedRef = useRef<AllergenKey[]>([]); // the newest pick, for answers still arriving
  const ctl = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const now = useMemo(() => boardNow(items), [items]);
  const nowRef = useRef(now);
  nowRef.current = now;
  const resolve = useMemo(() => makeResolver(catalog.items), [catalog]);
  const outCount = useMemo(() => catalog.items.filter((i) => isOut(i, now)).length, [catalog, now]);

  const setPick = useCallback((keys: AllergenKey[]) => {
    pickedRef.current = inOrder(keys);
    setPicked(pickedRef.current);
  }, []);

  // An allergy heard in the chat: check for it from now on, and say so in the thread.
  const addAllergens = useCallback(
    (keys: AllergenKey[], beforeId?: number) => {
      const fresh = inOrder(keys.filter((k) => !pickedRef.current.includes(k)));
      if (fresh.length === 0) return;
      setPick([...pickedRef.current, ...fresh]);
      const note: Msg = { id: nextId.current++, kind: 'sys', text: `Now checking for ${listWords(fresh.map((k) => allergenLabel(k).toLowerCase()))}.` };
      setMsgs((m) => {
        const at = beforeId === undefined ? -1 : m.findIndex((x) => x.id === beforeId);
        return at < 0 ? [...m, note] : [...m.slice(0, at), note, ...m.slice(at)];
      });
    },
    [setPick],
  );

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setDraft('');
    setError(null);
    setSheet(false);
    if (input.current) input.current.style.height = '';
    const turns: Turn[] = [
      ...msgs.flatMap((m): Turn[] => (m.kind === 'me' ? [{ role: 'user', content: m.text }] : m.kind === 'bot' && m.done && m.raw ? [{ role: 'assistant', content: m.raw }] : [])),
      { role: 'user', content: q },
    ];
    const meId = nextId.current++;
    setMsgs((m) => [...m, { id: meId, kind: 'me', text: q }]);
    addAllergens(detectAllergens(q));
    const botId = nextId.current++;
    setMsgs((m) => [...m, { id: botId, kind: 'bot', raw: '', done: false, cut: false }]);
    const patch = (change: Partial<Extract<Msg, { kind: 'bot' }>>) => setMsgs((m) => m.map((x) => (x.id === botId && x.kind === 'bot' ? { ...x, ...change } : x)));
    const hear = (raw: string, done: boolean) => {
      const p = parseReply(raw, done);
      if (!p.wait) addAllergens(p.keys, botId);
    };
    setBusy(true);
    const stop = new AbortController();
    ctl.current = stop;
    let soFar = '';
    try {
      const res = await api.askAssistant(restaurantId, { turns, known: pickedRef.current }, nowRef.current, {
        signal: stop.signal,
        onText: (t) => {
          soFar = t;
          hear(t, false);
          patch({ raw: t });
        },
      });
      hear(res.text, true);
      patch({ raw: res.text, done: true, cut: res.truncated });
    } catch (e) {
      // keep what arrived; an answer that never started is taken away again
      const kept = soFar.trim() !== '' && !parseReply(soFar, false).wait;
      if (kept) {
        hear(soFar, true);
        patch({ raw: soFar, done: true, cut: true });
      } else setMsgs((m) => m.filter((x) => x.id !== botId));
      if (!stop.signal.aborted) setError(e instanceof Error && e.message ? e.message : 'Something went wrong. Send it again.');
    } finally {
      ctl.current = null;
      setBusy(false);
    }
  }

  function newGuest() {
    if (busy) return;
    setMsgs([]);
    setPick([]);
    setDraft('');
    setError(null);
    window.scrollTo({ top: 0 });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  // Follow the chat down as it grows. When a finished answer is taller than
  // the screen, show its top instead: the warnings come first.
  useEffect(() => {
    if (!visible || msgs.length === 0) return;
    const last = msgs[msgs.length - 1];
    if (last.kind === 'bot' && last.done) {
      const el = document.querySelector<HTMLElement>(`[data-ask-msg="${last.id}"]`);
      if (el && el.offsetHeight > window.innerHeight - 330) {
        const prev = el.previousElementSibling;
        const first = prev instanceof HTMLElement && prev.classList.contains('ask-sys') ? prev : el;
        window.scrollTo({ top: first.getBoundingClientRect().top + window.scrollY - 84 });
        return;
      }
    }
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [msgs, visible]);

  // Leaving the screen for good (another restaurant, signing out) stops an answer in flight.
  useEffect(() => () => ctl.current?.abort(), []);

  const guest = picked.length ? `Guest cannot have: ${listWords(picked.map((k) => allergenLabel(k).toLowerCase()))}.` : 'No allergy set for this guest.';

  return (
    <div className="ask">
      <section className="ask-guest" aria-label="This guest">
        <p className={'ask-guest-line' + (picked.length ? ' is-on' : '')} role="status">
          <Mark kind={picked.length ? 'no' : 'none'} />
          <span>{guest}</span>
        </p>
        <div className="ask-guest-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setSheet(true)}>
            Allergies{picked.length > 0 && <span className="ask-count num">{picked.length}</span>}
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={newGuest} disabled={busy || (msgs.length === 0 && picked.length === 0)}>
            New guest
          </button>
        </div>
        {outCount > 0 && (
          <p className="caption">
            {outCount === 1 ? "1 item on my lists is 86'd on the board right now. I will not suggest it." : `${outCount} items on my lists are 86'd on the board right now. I will not suggest them.`}
          </p>
        )}
      </section>

      <div className="ask-thread" aria-live="polite">
        <div className="ask-hello">
          <h2 className="ask-hello-title">What does your table need?</h2>
          <p className="ask-lede">Ask about wine, cocktails, food or an allergy. Every allergy answer gets a checked label under it.</p>
          <div className="ask-starters">
            {catalog.starters.map((s) => (
              <button key={s} type="button" className="ask-starter" disabled={busy} onClick={() => void send(s)}>
                {s}
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7.5 16.5l9-9M9 7.5h7.5V15" />
                </svg>
              </button>
            ))}
          </div>
          <p className="caption">
            {catalog.asOf}.{sample && ' This preview has no AI: the answers are looked up on the sample lists. The labels and the 86 marks work the same way in the real app.'}
          </p>
        </div>

        {msgs.map((m) =>
          m.kind === 'me' ? (
            <div key={m.id} className="ask-msg ask-me">
              {m.text}
            </div>
          ) : m.kind === 'sys' ? (
            <div key={m.id} className="ask-msg ask-sys">
              <Mark kind="checked" />
              {m.text}
            </div>
          ) : (
            <Reply key={m.id} msg={m} name={catalog.name} picked={picked} now={now} resolve={resolve} />
          ),
        )}
      </div>

      <div className="ask-dock">
        <div className="ask-dock-inner">
          {error && (
            <p className="ask-status" role="alert">
              {error}
            </p>
          )}
          <form className="ask-composer" onSubmit={onSubmit}>
            <textarea
              ref={input}
              className="ask-input"
              rows={1}
              value={draft}
              placeholder="Ask a question"
              aria-label="Message"
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = '';
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
              }}
              onKeyDown={onKeyDown}
            />
            {busy ? (
              <button type="button" className="ask-send" aria-label="Stop" onClick={() => ctl.current?.abort()}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="7" y="7" width="10" height="10" rx="2.2" />
                </svg>
              </button>
            ) : (
              <button type="submit" className="ask-send" aria-label="Send" disabled={draft.trim() === ''}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            )}
          </form>
          <p className="ask-fine">The allergy labels come from the allergy sheet, not from the AI. Always tell the kitchen and the bar.</p>
        </div>
      </div>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="ask-allergies" onClick={(e) => e.stopPropagation()}>
            <div className="grabber" aria-hidden="true" />
            <h2 id="ask-allergies" className="sheet-title">
              Allergies
            </h2>
            <p className="sheet-text">Tap what the guest cannot have. You can also just say it in the chat.</p>
            <div className="tags">
              {ALLERGENS.map((a) => {
                const on = picked.includes(a.key);
                return (
                  <button key={a.key} type="button" className={'tag' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => setPick(on ? picked.filter((k) => k !== a.key) : [...picked, a.key])}>
                    {a.label}
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn btn-wide" onClick={() => setSheet(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
