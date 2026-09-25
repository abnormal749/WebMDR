// Checks the production build for the Pages base path, CSP, bundled-only
// scripts and required notices. Run after `vite build`.
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const base = process.env.WEBMDR_BASE ?? '/WebMDR/';
const failures = [];
const check = (ok, message) => ok || failures.push(message);

const html = readFileSync('dist/index.html', 'utf8');
check(/<meta http-equiv="Content-Security-Policy"[^>]*script-src &#39;self&#39;/.test(html) || /<meta http-equiv="Content-Security-Policy"[^>]*script-src 'self'/.test(html),
  'index.html lacks the production CSP meta tag');
check(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'index.html contains an inline script');
check(!/<style[\s>]/.test(html), 'index.html contains an inline style block');

// The owner's deployment may add one counter image (see vite.config.ts); nothing else external.
const counter = process.env.WEBMDR_GOATCOUNTER ? new URL(process.env.WEBMDR_GOATCOUNTER) : undefined;
const counterRef = counter && `${counter.href}?p=${encodeURIComponent(base)}`;
if (counter) {
  check(html.includes(`<img src="${counterRef.replaceAll('&', '&amp;')}"`), 'counter image missing');
  check(new RegExp(`img-src &#39;self&#39; ${counter.origin}[;"]|img-src 'self' ${counter.origin}[;"]`).test(html), 'CSP img-src does not allow the counter origin');
}

const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  if (ref === 'THIRD_PARTY_NOTICES.txt' || ref === counterRef) continue;
  check(!/^(https?:)?\/\//.test(ref), `external reference in index.html: ${ref}`);
  check(ref.startsWith(base), `reference not under base ${base}: ${ref}`);
  const file = `dist/${ref.slice(base.length)}`;
  check(existsSync(file), `referenced file missing: ${file}`);
}
check(refs.some((r) => r.endsWith('.js')), 'no bundled script referenced');

const notices = existsSync('dist/THIRD_PARTY_NOTICES.txt') ? readFileSync('dist/THIRD_PARTY_NOTICES.txt', 'utf8') : '';
check(notices.includes('MIT License') && notices.includes('dea38969b501a4a167f330dff104414531e80eae'), 'third-party notice missing from dist');

const js = readdirSync('dist/assets').filter((f) => f.endsWith('.js')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n');
check(js.includes('Sony Device Center') && js.includes('MIT License'), 'adapted-source notice stripped from bundle');
check(!/\bimport\s*\(\s*["']https?:/.test(js) && !/from\s*["']https?:/.test(js), 'bundle imports a remote module');

if (failures.length) {
  console.error(`dist check failed (base ${base}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`dist check passed (base ${base}, ${refs.length} references)`);
