// Shorted by vendor: how often each supplier left this restaurant without an
// item, from the same 30 days of history. The page a manager opens before
// calling the rep. Managers and the owner only, like the vendor notes.
import { useMemo } from 'react';
import type { EightySixEvent, MenuItem } from '../types';
import { fmtDay, fmtDuration } from '../lib/format';
import { itemsLine, vendorReport } from '../../shared/vendor-report';

interface Props {
  events: EightySixEvent[]; // this restaurant's history
  items: MenuItem[]; // this restaurant's menu, which names each item's vendor
}

export function VendorReport({ events, items }: Props) {
  const report = useMemo(() => vendorReport(events, items), [events, items]);
  const most = report.vendors[0]?.times ?? 1;

  return (
    <section className="sec" aria-labelledby="vendors-heading">
      <div className="sec-head">
        <h2 id="vendors-heading" className="sec-title">
          Shorted by vendor
        </h2>
        <span className="caption">Last 30 days</span>
      </div>
      <div className="panel">
        {report.vendors.length === 0 ? (
          <div className="empty">
            <b>No vendor left you short</b>
            <span>Nothing was 86'd for a short or missing delivery in the last 30 days.</span>
          </div>
        ) : (
          <ol className="bars">
            {report.vendors.map((v) => (
              <li key={v.vendor} className="bar-row">
                <div className="bar-label">
                  <span className="bar-name">{v.vendor}</span>
                  <span className="bar-val">
                    {v.times} {v.times === 1 ? 'time' : 'times'}, {fmtDuration(v.ms)}
                  </span>
                </div>
                <div className="bar-track" aria-hidden="true">
                  <div className="bar-fill bar-fill-vendor" style={{ width: `${Math.max(2, Math.round((v.times / most) * 100))}%` }} />
                </div>
                <p className="bar-sub">{itemsLine(v.items)}</p>
                <p className="bar-sub">
                  Last time {fmtDay(v.lastAt)}
                  {v.stillOut > 0 && <b className="bar-flag"> · {v.stillOut} still out</b>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="hint">
        Counts every 86 marked “Didn't come in” or “Vendor short”, or with a note that says the delivery was short, late or missing. The time is how long those items were off the menu.
        {report.noVendor > 0 && ` ${report.noVendor} more had no vendor on the menu item, so ${report.noVendor === 1 ? 'it is' : 'they are'} not counted.`}
      </p>
    </section>
  );
}
