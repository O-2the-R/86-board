// The owner's wiring to n8n. Paste the n8n webhook address, copy the key and
// the report link into n8n, press Send a test. From then on every 86 goes
// to n8n (which emails it and logs it), and n8n fetches the morning report.
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { IntegrationSettings } from '../api/types';
import { newKey } from '../lib/random';
import { fmtDay, fmtTime } from '../lib/format';
import { CopyLine } from './CopyLine';

export function Automations() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .getIntegration()
      .then((s) => {
        if (!live) return;
        setSettings(s);
        setUrl(s.webhookUrl);
        setKey(s.key);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the automation settings.'));
    return () => {
      live = false;
    };
  }, []);

  const dirty = settings !== null && (url.trim() !== settings.webhookUrl || key !== settings.key);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      const s = await api.saveIntegration(url, key);
      setSettings(s);
      setUrl(s.webhookUrl);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setError(null);
    try {
      await api.testWebhook();
      setSettings(await api.getIntegration());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The test did not run.');
    } finally {
      setBusy(null);
    }
  }

  const reportUrl = settings?.reportUrl;
  const urlLooksRight = /^https:\/\/\S+\/webhook(-test)?\/\S+$/i.test(url.trim());

  return (
    <section className="sec" aria-labelledby="auto-heading">
      <div className="sec-head">
        <h2 id="auto-heading" className="sec-title">
          Automations
        </h2>
        <span className="caption">n8n</span>
      </div>

      <form className="panel form" onSubmit={save}>
        <p className="form-intro">
          On every 86, the board sends a note to your n8n, which emails you and adds a row to the Google Sheet. Every morning n8n pulls the report
          link for yesterday's list.
        </p>

        {settings === null && !error && <p className="caption">Loading…</p>}

        {settings && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="auto-url">
                n8n webhook address
              </label>
              <input
                id="auto-url"
                className="input"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://your-name.app.n8n.cloud/webhook/86-alert"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <span className="hint">
                {url.trim() && !urlLooksRight
                  ? 'n8n webhook addresses look like https://…/webhook/… (the Production URL in the Webhook node).'
                  : 'From the Webhook node in your "86 alert" workflow: the Production URL.'}
              </span>
            </div>

            <CopyLine label="Key (n8n needs it as the x-86-key header)" value={key} />
            <div className="actions actions-left">
              <button type="button" className="btn btn-sm btn-text" onClick={() => setKey(newKey())}>
                Make a new key
              </button>
              <span className="hint">A new key only works after you save here and update it in n8n.</span>
            </div>

            {reportUrl ? (
              <CopyLine label="Report link (n8n calls this every morning)" value={reportUrl} />
            ) : (
              <p className="hint">The report link appears on the real site; the preview has no server.</p>
            )}

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            <div className="actions">
              {settings.lastTestResult && (
                <span className={'caption' + (settings.lastTestResult.startsWith('OK') ? ' ok-text' : ' bad-text')}>
                  Last test: {settings.lastTestResult}
                  {settings.lastTestAt ? `, ${fmtDay(settings.lastTestAt)} ${fmtTime(settings.lastTestAt)}` : ''}
                </span>
              )}
              <button type="button" className="btn btn-outline" disabled={busy !== null || !settings.webhookUrl || dirty} onClick={test} title={dirty ? 'Save first' : ''}>
                {busy === 'test' ? 'Sending…' : 'Send a test'}
              </button>
              <button type="submit" className="btn" disabled={busy !== null || !dirty}>
                {busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}
