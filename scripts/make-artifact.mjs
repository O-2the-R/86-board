// Turns the built single-file page (dist/index.html) into a page fragment
// (dist/artifact.html) that the Claude artifact host can wrap in its own
// document skeleton: title and meta first, then stylesheets, the app's
// root element, and the bundled script.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('dist/index.html', 'utf8');
const all = (re) => [...src.matchAll(re)].map((m) => m[0]);

const title = all(/<title>[\s\S]*?<\/title>/gi)[0] ?? '<title>86 Board</title>';
const links = all(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi);
const styles = all(/<style\b[^>]*>[\s\S]*?<\/style>/gi);
const scripts = all(/<script\b[^>]*>[\s\S]*?<\/script>/gi);
const body = (src.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .trim();

const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...links,
  ...styles,
  body,
  ...scripts,
].join('\n');

writeFileSync('dist/artifact.html', out);
console.log(`dist/artifact.html written (${Math.round(Buffer.byteLength(out) / 1024)} KB)`);
