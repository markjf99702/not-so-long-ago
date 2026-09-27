// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);

// Every file the offline copy keeps is really in the repo.
const sw = await readFile(join(root, 'sw.js'), 'utf8');
for (const f of sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1))) {
  if (f !== './') await readFile(join(root, f)).catch(() => assert.fail('sw.js lists a missing file: ' + f));
}

// The fonts come from the site itself.
for (const f of ['900 40px "Big Shoulders Display"', '600 16px "Big Shoulders Text"', '400 16px "Source Serif 4"', '400 13px "IBM Plex Mono"']) {
  assert.ok(await page.evaluate(f => document.fonts.check(f), f), 'font not loaded: ' + f);
}

// It opens on the example family, with the year cursor on the youngest one's birth year.
const chips = () => page.$$eval('#people .chip[data-id]', els => els.map(e => e.textContent.trim()));
assert.deepEqual(await chips(), ['Nana 1944 · TX', 'Mom 1970 · OH', 'Sam 2001 · CA']);
assert.equal(await page.textContent('.ro-year'), '2001');
assert.ok(await page.isVisible('#starter'), 'the examples should say they are examples');

// Put yourself on instead.
await page.fill('#s-year', '1985');
await page.selectOption('#s-state', 'TX');
await page.click('#starter-form button');
assert.deepEqual(await chips(), ['You 1985 · TX']);
assert.equal(await page.textContent('.ro-cap'), 'The year you were born');
assert.equal((await page.textContent('#headlines')).trim(),
  'You were 18 when gay sex stopped being a crime in Texas, and 30 when same-sex couples could marry there.');

// Add someone to compare with.
await page.click('#add');
await page.fill('#e-name', 'Mom');
await page.fill('#e-year', '1958');
await page.selectOption('#e-state', 'NY');
await page.click('#e-save');
assert.deepEqual(await chips(), ['Mom 1958 · NY', 'You 1985 · TX']);
assert.equal(await page.$$eval('#ages-table thead th', els => els.length), 3, 'one column per person');
const stateEvents = await page.$$eval('#years .ev.state .ev-t', els => els.map(e => e.dataset.st + ': ' + e.textContent));
assert.ok(stateEvents.includes('New York: A court strikes down the sodomy law'), 'New York events: ' + stateEvents);

// Move to another year.
await page.$eval('#year', el => { el.value = 1994; el.dispatchEvent(new Event('input', { bubbles: true })); });
assert.equal(await page.textContent('.ro-year'), '1994');
const rules = await page.textContent('#readout');
assert.match(rules, /Gay sex was a crime in \d+ of 50 states/);
assert.match(rules, /Texas \(you\): a crime until 2003/);
assert.match(rules, /Mom 36/);

// Filter the list to one kind of event.
await page.click('.fchip[data-cat="trans"]');
const kinds = await page.$$eval('#years .ev-meta', els => [...new Set(els.map(e => e.textContent.split(' · ').pop()))]);
assert.deepEqual(kinds, ['Trans lives']);
await page.click('.fchip[data-cat="*"]');

// The people are still there after a reload.
await page.reload();
assert.deepEqual(await chips(), ['Mom 1958 · NY', 'You 1985 · TX']);

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
assert.ok(await page.title(), 'the page did not load offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
