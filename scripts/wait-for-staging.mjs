// Waits until the staging site is serving the commit this workflow is testing
// (Amplify takes a few minutes to deploy after a push), then exits. Gives up
// after 30 minutes, which usually means the Amplify build failed.
const url = (process.env.STAGING_URL ?? '').replace(/\/$/, '');
const want = process.env.GITHUB_SHA;
if (!url || !want) {
  console.error('STAGING_URL and GITHUB_SHA must be set.');
  process.exit(1);
}
const end = Date.now() + 30 * 60_000;
let last = '';
while (Date.now() < end) {
  try {
    const res = await fetch(`${url}/version.json?t=${Date.now()}`);
    if (res.ok) {
      const v = await res.json();
      if (v.commit === want) {
        console.log(`Staging is live on ${want.slice(0, 7)}.`);
        process.exit(0);
      }
      const now = `Staging is on ${String(v.commit).slice(0, 7)}; waiting for ${want.slice(0, 7)}…`;
      if (now !== last) console.log((last = now));
    } else if (`${res.status}` !== last) {
      console.log((last = `${res.status}`), `from ${url}/version.json; waiting…`);
    }
  } catch (e) {
    console.log(`Could not reach ${url} (${e.message}); waiting…`);
  }
  await new Promise((r) => setTimeout(r, 20_000));
}
console.error(`Staging never showed ${want.slice(0, 7)} within 30 minutes. Check the staging branch in the Amplify console.`);
process.exit(1);
