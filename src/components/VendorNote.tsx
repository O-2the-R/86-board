// The vendor note: for an item 86'd three days or more, a ready-to-send email
// to its supplier. The manager reads it, changes anything they like, and taps
// once to open it in their own email app with everything filled in. Nothing
// is sent from here, and the vendor's reply goes to the manager. The board
// remembers who opened it and when, so nobody emails the same vendor twice.
import { useEffect, useMemo, useState } from 'react';
import type { MenuItem } from '../types';
import { api } from '../api';
import { daysOut, draftVendorNote, looksLikeEmail, mailtoLink, sentLine } from '../../shared/vendor-note';

interface Props {
  item: MenuItem; // an item that is 86'd
  restaurantName: string;
  sender: string; // the manager's name, signed at the bottom
  onClose: () => void;
  onSent: () => void; // refresh the board, so the ticket shows who emailed
}

export function VendorNoteSheet({ item, restaurantName, sender, onClose, onSent }: Props) {
  const outSince = item.outSince ?? new Date().toISOString();
  const [vendor, setVendor] = useState(item.vendor ?? '');
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState<string | null>(null); // what the vendor list has, null while loading
  const draft = useMemo(() => draftVendorNote({ vendor: vendor.trim() || 'there', item: item.name, restaurant: restaurantName, outSince, sender }), [vendor, item.name, restaurantName, outSince, sender]);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [edited, setEdited] = useState(false); // once the manager types in the message, the draft stops following the vendor name
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (edited) return;
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft, edited]);

  // The address on file for this vendor at this restaurant, if there is one.
  useEffect(() => {
    let live = true;
    api
      .listVendors(item.restaurantId)
      .then((list) => {
        if (!live) return;
        const match = list.find((v) => v.name.toLowerCase() === (item.vendor ?? '').toLowerCase());
        setSavedEmail(match?.email ?? '');
        if (match) setEmail(match.email);
      })
      .catch(() => live && setSavedEmail(''));
    return () => {
      live = false;
    };
  }, [item.restaurantId, item.vendor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emailOk = looksLikeEmail(email);
  const ready = emailOk && vendor.trim().length > 0 && subject.trim().length > 0 && body.trim().length > 0;
  const days = daysOut(outSince);

  // Hands the email to the phone's mail app right away, inside the tap (some
  // phones refuse to open the mail app later than that). Meanwhile it saves a
  // new or corrected address for next time and records the note on the board.
  function openInMail() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const record = (async () => {
      if (email.trim().toLowerCase() !== (savedEmail ?? '').toLowerCase()) await api.saveVendor(item.restaurantId, vendor.trim(), email.trim());
      await api.logVendorNote(item.id, sender);
    })();
    window.location.href = mailtoLink(email, { subject, body });
    record
      .then(() => {
        onSent();
        onClose();
      })
      .catch((e: unknown) => {
        setError(`Your email app has the note, but the board could not record it: ${e instanceof Error ? e.message : 'try again later'}.`);
      })
      .finally(() => setBusy(false));
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(`To: ${email.trim()}\nSubject: ${subject}\n\n${body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the message is in the box above; the person can select it by hand
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="note-heading" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <h2 id="note-heading" className="sheet-title">
          Vendor note
        </h2>
        <p className="sheet-text">
          {item.name} has been 86'd for {days} {days === 1 ? 'day' : 'days'}.
          {item.vendorNoteAt && item.vendorNoteBy ? ` ${sentLine(item.vendorNoteBy, item.vendorNoteAt)}.` : ''}
        </p>

        {!item.vendor && (
          <div className="field">
            <label className="field-label" htmlFor="note-vendor">
              Vendor
            </label>
            <input id="note-vendor" className="input" type="text" placeholder="Who supplies it" maxLength={80} value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="note-to">
            {item.vendor ? `To ${item.vendor}` : 'Their email'}
          </label>
          <input
            id="note-to"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder={savedEmail === null ? 'Looking up the address…' : 'orders@supplier.com'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {savedEmail === '' && <span className="hint">No address on file yet. It is saved for next time.</span>}
          {email.trim() !== '' && !emailOk && <span className="hint hint-warn">Check the address: it needs an @ and a dot.</span>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="note-subject">
            Subject
          </label>
          <input
            id="note-subject"
            className="input"
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="note-body">
            Message
          </label>
          <textarea
            id="note-body"
            className="input textarea"
            rows={9}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        {error && (
          <p className="error center" role="alert">
            {error}
          </p>
        )}

        <p className="hint center">Opens in your own email app, filled in. Nothing is sent until you press Send there, and the vendor replies to you.</p>
        <button type="button" className="btn btn-wide btn-amber" disabled={!ready || busy} onClick={openInMail}>
          {busy ? 'Opening…' : item.vendorNoteAt ? 'Open it in my email again' : 'Open in my email'}
        </button>
        <button type="button" className="btn btn-wide btn-outline" disabled={!emailOk} onClick={() => void copyAll()}>
          {copied ? 'Copied. Paste it into any email.' : 'Copy the message instead'}
        </button>
        <button type="button" className="btn btn-text btn-wide" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
