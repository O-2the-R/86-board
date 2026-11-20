// The owner's setup for Ask, on the Staff screen. One block per restaurant:
// load its lists from a file, choose who can use Ask there, see how many
// questions were asked. The lists go from the file to the server and nowhere
// else; this screen keeps nothing. On top, a test that shows whether AWS lets
// this app call the AI at all.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api';
import type { AskAiTest, AskSetup as Setup } from '../api/types';
import type { Restaurant } from '../types';
import { BadLists, cleanCatalog, countsOf, parseLists } from '../../shared/assistant/load';
import { fmtDay } from '../lib/format';

interface Props {
  restaurants: Restaurant[];
  onChanged: () => void; // the Ask tab may have appeared or gone
}

// A file that passed the check, waiting for the owner to say "load it".
interface Picked {
  restaurantId: string;
  fileName: string;
  text: string;
  name: string;
  items: number;
  notes: number;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function AskSetup({ restaurants, onChanged }: Props) {
  const [rows, setRows] = useState<Setup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "test", or "<restaurant>:<action>"
  const [picked, setPicked] = useState<Picked | null>(null);
  const [confirm, setConfirm] = useState<{ restaurantId: string; what: 'open' | 'remove' } | null>(null);
  const [problem, setProblem] = useState<{ restaurantId: string; text: string } | null>(null);
  const [test, setTest] = useState<AskAiTest | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFor = useRef('');

  useEffect(() => {
    let live = true;
    api.getAskSetup().then(
      (r) => live && setRows(r),
      (e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the Ask setup.'),
    );
    return () => {
      live = false;
    };
  }, []);

  const nameOf = (id: string) => restaurants.find((r) => r.id === id)?.name ?? id;
  const put = (s: Setup) => setRows((now) => (now ? now.map((r) => (r.restaurantId === s.restaurantId ? s : r)) : [s]));

  // One change at one restaurant: run it, show the new state, tell the app.
  async function change(restaurantId: string, action: string, run: () => Promise<Setup>) {
    setBusy(`${restaurantId}:${action}`);
    setProblem(null);
    try {
      put(await run());
      onChanged();
      return true;
    } catch (e) {
      setProblem({ restaurantId, text: e instanceof Error && e.message ? e.message : 'That did not work. Try again.' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function choose(restaurantId: string) {
    pickFor.current = restaurantId;
    setProblem(null);
    setPicked(null);
    setConfirm(null);
    fileInput.current?.click();
  }

  // Check the file here first, so what is wrong shows at once. The server
  // checks it again before storing anything.
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again after a fix
    const restaurantId = pickFor.current;
    if (!file || !restaurantId) return;
    try {
      const text = await file.text();
      const lists = cleanCatalog(restaurantId, parseLists(text), 'today');
      setPicked({ restaurantId, fileName: file.name, text, name: lists.name, ...countsOf(lists) });
    } catch (err) {
      setProblem({ restaurantId, text: err instanceof BadLists ? err.message : 'That file could not be read. Pick it again.' });
    }
  }

  async function load() {
    if (!picked) return;
    if (await change(picked.restaurantId, 'load', () => api.loadAskLists(picked.restaurantId, picked.text))) setPicked(null);
  }

  async function setAudience(restaurantId: string, staffCanUse: boolean) {
    await change(restaurantId, 'audience', () => api.setAskAudience(restaurantId, staffCanUse));
    setConfirm(null);
  }

  async function remove(restaurantId: string) {
    await change(restaurantId, 'remove', () => api.removeAskLists(restaurantId));
    setConfirm(null);
  }

  async function runTest() {
    setBusy('test');
    setTest(null);
    try {
      setTest(await api.testAskAi());
    } catch (e) {
      setTest({ ok: false, summary: e instanceof Error && e.message ? e.message : 'The test did not run.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sec" aria-labelledby="ask-setup-heading">
      <div className="sec-head">
        <h2 id="ask-setup-heading" className="sec-title">
          Ask
        </h2>
        <span className="caption">the chat</span>
      </div>

      <div className="panel form">
        <p className="form-intro">
          Ask answers from lists you load here: your dishes and drinks with their allergy marks, the wine list, and house notes. The lists are private. Staff never read them
          directly. Ask answers from them, and only for the people you allow.
        </p>

        <div className="actions actions-left">
          <button type="button" className="btn btn-sm btn-outline" disabled={busy !== null} onClick={runTest}>
            {busy === 'test' ? 'Asking…' : 'Test the AI'}
          </button>
          {test && <span className={'caption ' + (test.ok ? 'ok-text' : 'bad-text')}>{test.summary}</span>}
        </div>
        {test && !test.ok && (
          <p className="hint">
            To switch it on: in the AWS console open Amazon Bedrock, region US East (Ohio). Under Model catalog pick Claude Haiku 5.5 and send one message in the playground. Wait up to 15
            minutes, then test again.{test.detail ? ` AWS said: ${test.detail}` : ''}
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {rows === null && !error && <p className="caption">Loading…</p>}

        {rows?.map((s) => {
          const id = s.restaurantId;
          const place = nameOf(id);
          const own = s.loaded && !s.sample; // the owner's own lists, not the sample ones
          const working = busy !== null && busy.startsWith(id + ':');
          return (
            <div className="ask-setup-place" key={id}>
              <div className="notice-row">
                <b className="ask-setup-name">{place}</b>
                <span className={'caption' + (s.loaded ? ' ok-text' : '')}>{!s.loaded ? 'Ask is off here' : s.staffCanUse ? 'On for staff' : 'On for you only'}</span>
              </div>

              <span className="caption">
                {!s.loaded
                  ? 'No lists loaded.'
                  : s.sample
                    ? 'Answering from the sample lists, which are made up. The demo staff here can use Ask. Load your own lists to replace them.'
                    : `${s.name ?? 'Ask'}: ${count(s.items, 'item', 'items')}, ${count(s.notes, 'house note', 'house notes')}.${s.loadedAt ? ` Loaded ${fmtDay(s.loadedAt)}${s.loadedBy ? ' by ' + s.loadedBy : ''}.` : ''}`}
              </span>

              {own && (
                <div className="field">
                  <span className="field-label" id={`ask-who-${id}`}>
                    Who can use Ask here
                  </span>
                  <div className="seg" role="radiogroup" aria-labelledby={`ask-who-${id}`}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!s.staffCanUse}
                      className={'seg-btn' + (!s.staffCanUse ? ' is-on' : '')}
                      disabled={busy !== null}
                      onClick={() => s.staffCanUse && void setAudience(id, false)}
                    >
                      Only me
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={s.staffCanUse}
                      className={'seg-btn' + (s.staffCanUse ? ' is-on' : '')}
                      disabled={busy !== null}
                      onClick={() => !s.staffCanUse && setConfirm({ restaurantId: id, what: 'open' })}
                    >
                      Staff here too
                    </button>
                  </div>
                  <span className="hint">
                    {s.staffCanUse ? `Everyone with a login at ${place} sees the Ask tab and gets answers from these lists.` : 'Only your owner login sees the Ask tab here.'}
                  </span>
                </div>
              )}

              {confirm?.restaurantId === id && (
                <div className="notice" role="status">
                  <span>
                    {confirm.what === 'open'
                      ? `Open Ask to the staff at ${place}? Everyone with a login there will get answers from these lists.`
                      : `Remove the lists for ${place}? Ask goes away there until you load lists again.`}
                  </span>
                  <div className="actions">
                    <button type="button" className="btn btn-sm btn-text" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void (confirm.what === 'open' ? setAudience(id, true) : remove(id))}>
                      {working ? 'Saving…' : confirm.what === 'open' ? 'Open to staff' : 'Remove the lists'}
                    </button>
                  </div>
                </div>
              )}

              {picked?.restaurantId === id && (
                <div className="notice" role="status">
                  <span>
                    {picked.fileName}: {picked.name}, {count(picked.items, 'item', 'items')}, {count(picked.notes, 'house note', 'house notes')}.
                    {own ? ` This replaces the lists at ${place}. Who can use Ask stays as it is.` : ' Only you will see Ask here until you open it to staff.'}
                  </span>
                  <div className="actions">
                    <button type="button" className="btn btn-sm btn-text" onClick={() => setPicked(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void load()}>
                      {working ? 'Loading…' : 'Load these lists'}
                    </button>
                  </div>
                </div>
              )}

              {problem?.restaurantId === id && (
                <p className="error" role="alert">
                  {problem.text}
                </p>
              )}

              <div className="actions actions-left">
                <button type="button" className="btn btn-sm btn-outline" disabled={busy !== null} onClick={() => choose(id)}>
                  {own ? 'Load new lists' : 'Load lists'}
                </button>
                {own && (
                  <button type="button" className="btn btn-sm btn-text" disabled={busy !== null} onClick={() => setConfirm({ restaurantId: id, what: 'remove' })}>
                    Remove
                  </button>
                )}
                {s.loaded && (
                  <span className="caption num">
                    Today: {s.questionsToday} of {s.dailyLimit} questions. Last 30 days: {s.questions30}.
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e)} />

        <p className="hint">
          Lists are one file per restaurant.{' '}
          <a href="/ask-lists.example.json" download>
            Download a sample file
          </a>{' '}
          to see the format.
        </p>
      </div>
    </section>
  );
}
