// A label, a value the person will read out or paste somewhere, and a Copy
// button. Used for temporary passwords, usernames, keys and links.
import { useState } from 'react';

export function CopyLine({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the text is selectable; the person can copy it by hand
    }
  }
  return (
    <div className="copy-line">
      <span className="copy-text">
        <span className="caption">{label}</span>
        <span className={big ? 'notice-pass' : 'copy-val'}>{value}</span>
      </span>
      <button type="button" className="btn btn-sm btn-outline" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// The whole note for a new person, shown so the manager can read it first,
// and copied in one tap to paste into a text.
export function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the note is selectable; the person can copy it by hand
    }
  }
  return (
    <div className="copy-message">
      <pre className="copy-message-text">{text}</pre>
      <button type="button" className="btn btn-wide btn-paper" onClick={copy}>
        {copied ? 'Copied. Paste it into a text.' : 'Copy login message'}
      </button>
    </div>
  );
}
