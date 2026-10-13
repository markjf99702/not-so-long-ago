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

// The six lifeline colours are Baker's six-stripe flag; his 1978 original had eight.
assert.match(await page.textContent('#about'), /Each lifeline takes a stripe of Gilbert Baker's rainbow flag/);

// Put yourself on instead.
await page.fill('#s-year', '1985');
await page.selectOption('#s-state', 'TX');
await page.click('#starter-form button');
assert.deepEqual(await chips(), ['You 1985 · TX']);
assert.equal(await page.textContent('.ro-cap'), 'The year you were born');
assert.equal((await page.textContent('#headlines')).trim(),
  'You were 18 when gay sex stopped being a crime in Texas, and 30 when same-sex couples could marry there.');
assert.match(await page.textContent('#years details.before summary'), /^Before you were born\d+ events, 1924–1984$/);

// In that group, a year the chart can show jumps the lifelines there; one from before the chart starts (1950 here) is plain text.
await page.click('#years details.before summary');
const beforeYears = await page.$$eval('#years details.before .yr-h .y', els => els.map(e => e.tagName.toLowerCase() + ' ' + e.textContent));
assert.ok(beforeYears.includes('span 1924') && beforeYears.includes('button 1950'), 'years in the Before group: ' + beforeYears);
const plainYear = page.locator('#years .yr-h span.y').first();
const plainColor = await plainYear.evaluate(el => getComputedStyle(el).color);
await plainYear.hover();
assert.deepEqual(await plainYear.evaluate(el => [getComputedStyle(el).cursor, getComputedStyle(el).color]), ['auto', plainColor], 'a plain year should not look clickable');
await page.click('#years button.y[data-year="1969"]');
assert.equal(await page.textContent('.ro-year'), '1969');

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

// The narrower diagnosis that replaced homosexuality in the manual had another name until DSM-III in 1980.
const asYearBegan = async y => {
  await page.$eval('#year', (el, y) => { el.value = y; el.dispatchEvent(new Event('input', { bubbles: true })); }, y);
  return page.textContent('#readout');
};
assert.match(await asYearBegan(1975), /"sexual orientation disturbance," was still in the psychiatric manual/);
assert.match(await asYearBegan(1980), /"sexual orientation disturbance," was still/);
assert.match(await asYearBegan(1981), /"ego-dystonic homosexuality," was still in the psychiatric manual/);
assert.match(await asYearBegan(1987), /"ego-dystonic homosexuality," was still/);
assert.doesNotMatch(await asYearBegan(1988), /psychiatric manual/);

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

// The checks below each start from a fresh phone page with nothing saved.
async function freshPage(hash = '', options = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block', ...options });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.goto(base + hash);
  return p;
}
const chipsOf = p => p.$$eval('#people .chip[data-id]', els => els.map(e => e.textContent.trim()));

// A hand-edited link or saved list can't break the page: a state code that isn't a state is dropped
// (the person stays), and so is anyone whose birth year isn't a whole year.
{
  const p = await freshPage('#p=Bob,1990,constructor;Ann,1990.5,TX;Cy,1960,__proto__');
  assert.deepEqual(await chipsOf(p), ['Cy 1960', 'Bob 1990']);
  assert.equal(await p.textContent('.ro-year'), '1990');
  assert.ok(await p.$$eval('#ages-table tbody tr', els => els.length) > 0, 'the ages table is empty');
  await p.evaluate(() => localStorage.setItem('not-so-long-ago.people.v1', JSON.stringify([{ name: 'Dad', year: 1950, st: 'toString' }, { name: 'Kid', year: 1990.5, st: 'TX' }])));
  await p.goto('about:blank');
  await p.goto(base);
  assert.deepEqual(await chipsOf(p), ['Dad 1950']);
  await p.context().close();
}

// When the clipboard says no, the link is shown instead, and it wraps rather than pushing the page sideways.
{
  const family = [['Grandma Rose', 1931, 'GA'], ['Grandpa Joe', 1929, 'GA'], ['Aunt Maria', 1960, 'FL'], ['Sam', 2001, 'CA']];
  const p = await freshPage('#p=' + family.map(a => a.map(encodeURIComponent).join(',')).join(';'));
  await p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('refused')); });
  await p.click('#share');
  await p.waitForFunction(() => document.querySelector('#share-msg').textContent.startsWith('http'));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'the link pushes the page sideways');
  await p.context().close();
}

// On a phone, a long name on a late lifeline stays inside the chart instead of running off the edge.
{
  const p = await freshPage('#p=Granddaughter%20Emma,2000,CA;Aunt%20Maria-Guadalupe%20Jr.,1990,DC;Grandson%20Alexander,1997,TX');
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  const overflow = await p.$$eval('#svg .c-name', (els, right) => els.filter(e => e.getBoundingClientRect().right > right + 0.5).map(e => e.textContent),
    await p.$eval('#svg', el => el.getBoundingClientRect().right));
  assert.deepEqual(overflow, [], 'names running off the chart');
  await p.context().close();
}

// Opening another share link in the same tab shows its people straight away, and Back goes back.
async function chipsSoon(p, expected) {
  for (let i = 0; i < 30 && JSON.stringify(await chipsOf(p)) !== JSON.stringify(expected); i++) await p.waitForTimeout(100);
  assert.deepEqual(await chipsOf(p), expected);
}
{
  const p = await freshPage();
  await p.goto(base + '#p=Nana,1944,TX');
  await chipsSoon(p, ['Nana 1944 · TX']);
  assert.equal(await p.isVisible('#starter'), false, 'a link\'s people are not the examples');
  await p.goto(base + '#p=Grandpa,1930,GA;Kid,2010,OR');
  await chipsSoon(p, ['Grandpa 1930 · GA', 'Kid 2010 · OR']);
  await p.goBack();
  await chipsSoon(p, ['Nana 1944 · TX']);
  // Adding someone keeps the link's people, as it does when the link is opened fresh.
  await p.click('#add');
  await p.fill('#e-name', 'Ann');
  await p.fill('#e-year', '1980');
  await p.click('#e-save');
  assert.deepEqual(await chipsOf(p), ['Nana 1944 · TX', 'Ann 1980']);
  await p.context().close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
