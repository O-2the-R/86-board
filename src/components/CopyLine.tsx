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
