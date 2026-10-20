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
assert.equal(await page.getByRole('group', { name: 'People on the lifelines' }).count(), 1, 'the chips should be a named group');
assert.equal(await page.textContent('.ro-year'), '2001');
assert.ok(await page.isVisible('#starter'), 'the examples should say they are examples');
const starterHeights = await page.$$eval('#s-year, #s-state, #starter-form .btn', els => els.map(e => Math.round(e.getBoundingClientRect().height)));
assert.ok(starterHeights.every(h => h === starterHeights[0]), 'the starter\'s box, menu and button should be one height: ' + starterHeights);
const starterLabels = await page.$$eval('#starter-form label', els => els.map(e => Math.round(e.getBoundingClientRect().top)));
assert.equal(starterLabels[0], starterLabels[1], 'the starter\'s labels should line up');

// The bars are dark in the light palette and pale in the dark one, so the heading doesn't call them dark.
assert.equal(await page.textContent('#lifelines .sec-h p'), 'Each bar is a rule that held in the US. Where it thins, states were changing it one by one.');

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
// The open group stays open when the list is filtered.
await page.click('.fchip[data-cat="culture"]');
assert.equal(await page.$eval('#years details.before', el => el.open), true, 'the Before group folded shut when filtered');
await page.click('.fchip[data-cat="*"]');

// Add someone to compare with. Saving too early says what's missing, in the page's own words, one thing at a time.
await page.click('#add');
assert.equal(await page.getByRole('dialog', { name: /add a person/i }).count(), 1, 'a screen reader should hear the dialog\'s name');
const fieldWidths = await page.$$eval('#e-name, #e-year, #e-state', els => els.map(e => Math.round(e.getBoundingClientRect().width)));
assert.ok(fieldWidths.every(w => w === fieldWidths[2]), 'the dialog\'s fields should all be full width: ' + fieldWidths);
await page.waitForFunction(() => document.activeElement?.id === 'e-name');   // the dialog opens on the name box
await page.click('#e-save');
assert.equal(await page.textContent('#e-err'), 'Give this person a name or a label, like "Grandpa".');
// As with the browser's own checks, Save goes back to the box that needs fixing, and a screen reader reads the message out.
assert.equal(await page.evaluate(() => document.activeElement.id), 'e-name', 'Save should go back to the name box');
assert.equal(await page.getByRole('alert').count(), 1, 'a screen reader should hear the message');
await page.fill('#e-name', 'Mom');
assert.equal(await page.textContent('#e-err'), '', 'the name message stays after the name is in');
await page.fill('#e-year', '1850');
await page.click('#e-save');
assert.match(await page.textContent('#e-err'), /^Enter a birth year between 1900 and \d{4}\.$/);
assert.equal(await page.evaluate(() => document.activeElement.id), 'e-year', 'Save should go to the year box');
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

// The tools at junkdrawer.works/... share one address, so they share one store of offline copies.
// Setting up this one's copy clears out its own older copies and leaves other tools' alone, even one whose name starts with this one's.
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  // Two other tools on the same address made their copies first, one of them called not-so-long-ago-x, and so did an older version of this one.
  await c.route(base + 'another-tool/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Another tool</title>' }));
  await p.goto(base + 'another-tool/');
  await p.evaluate(async () => {
    await (await caches.open('another-tool-v1')).put('/another-tool/', new Response('another tool'));
    await (await caches.open('not-so-long-ago-x-v1')).put('/not-so-long-ago-x/', new Response('a tool whose name starts with this one\'s'));
    await (await caches.open('not-so-long-ago-v0')).put('/', new Response('an older version'));
  });
  await c.unroute(base + 'another-tool/');
  await p.goto(base);
  await p.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 30000 });
  const kept = await p.evaluate(async () => ({
    keys: await caches.keys(), other: await caches.has('another-tool-v1'), longer: await caches.has('not-so-long-ago-x-v1'), old: await caches.has('not-so-long-ago-v0'),
  }));
  assert.equal(kept.other, true, 'another tool\'s offline copy was deleted; left: ' + kept.keys);
  assert.equal(kept.longer, true, 'the offline copy of a tool whose name starts with this one\'s was deleted; left: ' + kept.keys);
  assert.equal(kept.old, false, 'an older version\'s offline copy was kept; left: ' + kept.keys);
  await c.close();
}

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

// When two people's states changed on the same day, each keeps a dot on that lane: the second moves 4px up,
// the third 4px down, and the moved ones are drawn first so they peek out from behind the dot on the bar.
{
  const p = await freshPage('#p=Nana,1944,TX;Mom,1970,OH;Kid,1995,TX');
  const [dots, bars] = await p.evaluate(() => [
    [...document.querySelectorAll('#svg .c-mark')].map(e => [e.querySelector('title')?.textContent, e.style.fill, +e.getAttribute('cy')]),
    [...document.querySelectorAll('#svg .c-track')].map(e => +e.getAttribute('y') + 0.5)]);
  const bar = cy => bars.reduce((a, b) => Math.abs(b - cy) < Math.abs(a - cy) ? b : a);
  const placed = dots.map(([title, fill, cy]) => [title, fill, cy - bar(cy)]);   // in the order they're drawn
  assert.deepEqual(placed.filter(d => /2003|1974/.test(d[0])),
    [['Texas, June 26, 2003', 'var(--p2)', -4], ['Texas, June 26, 2003', 'var(--p0)', 0], ['Ohio, January 1, 1974', 'var(--p1)', 0]]);
  assert.deepEqual(placed.filter(d => /2015/.test(d[0])),
    [['Ohio, June 26, 2015', 'var(--p1)', -4], ['Texas, June 26, 2015', 'var(--p2)', 4], ['Texas, June 26, 2015', 'var(--p0)', 0]]);
  await p.context().close();
}

// The year line runs under the names and lane labels, whose halo in the page colour stops it short of the text,
// and the year tag stays on top. On a phone a name's halo ends where its lifeline begins, so letters like g and y
// don't nick the bar under them.
{
  const p = await freshPage('#p=Peggy,1950,NY;Jay,1999,WY');
  const got = await p.evaluate(() => {
    const svg = document.querySelector('#svg');
    const line = svg.querySelector('.c-cursor'), tag = svg.querySelector('.c-cursor-pill');
    const labels = [...svg.querySelectorAll('.c-name, .c-lane')];
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const halo = getComputedStyle(labels[0]);
    const lifelines = [...svg.querySelectorAll('rect[rx="2"]')];
    return {
      lineUnderLabels: labels.every(l => after(line, l)),
      tagOnTop: [...svg.querySelectorAll('text, rect, circle')].every(el => tag.parentNode.contains(el) || after(el, tag)),
      halo: [halo.stroke === getComputedStyle(document.body).backgroundColor, halo.strokeWidth, halo.paintOrder],
      haloEndsAtLifeline: [...svg.querySelectorAll('.c-name')].map((n, i) => {
        const clip = (n.getAttribute('clip-path') || '').slice(4, -1), r = clip && svg.querySelector(clip + ' rect');
        return !!r && +r.getAttribute('y') + +r.getAttribute('height') === +lifelines[i].getAttribute('y');
      }),
    };
  });
  assert.deepEqual(got, { lineUnderLabels: true, tagOnTop: true, halo: [true, '4px', 'stroke'], haloEndsAtLifeline: [true, true] });
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

// A shared link opened where people are already saved says plainly that changing anything replaces them.
// Back to mine, and Start over, only drop the link: the saved people come back as they were.
{
  const STORE = 'not-so-long-ago.people.v1';
  const mine = JSON.stringify([{ name: 'Dad', year: 1950, st: 'OH' }]);
  const p = await freshPage();
  const saved = () => p.evaluate(k => localStorage.getItem(k), STORE);
  const openLink = async () => { await p.goto('about:blank'); await p.goto(base + '#p=Nana,1944,TX'); };
  const backToMine = p.getByRole('button', { name: 'Back to mine' });
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE, mine]);
  await openLink();
  assert.deepEqual(await chipsOf(p), ['Nana 1944 · TX']);
  assert.equal(await p.$eval('.people-note', el => el.firstChild.textContent), 'Opened from a shared link. Changing anything replaces the lifelines saved on this device.');
  assert.equal(await backToMine.count(), 1, 'Back to mine should be offered');
  await backToMine.click();
  assert.deepEqual(await chipsOf(p), ['Dad 1950 · OH']);
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Edit Dad', 'the focus should go to the people, not away with the button');
  assert.equal(await p.evaluate(() => location.hash), '', 'Back to mine should drop the link');
  assert.equal(await saved(), mine);
  assert.equal(await p.locator('.people-note').count(), 0);
  await openLink();
  await p.click('#reset');
  assert.deepEqual(await chipsOf(p), ['Dad 1950 · OH'], 'Start over from a link should show what is saved');
  assert.equal(await p.evaluate(() => location.hash), '');
  assert.equal(await saved(), mine, 'Start over from a link deleted the saved people');
  // Away from a link, Start over still clears what's saved.
  await p.click('#reset');
  assert.deepEqual(await chipsOf(p), ['Nana 1944 · TX', 'Mom 1970 · OH', 'Sam 2001 · CA']);
  assert.equal(await saved(), null);
  // With nobody saved there's nothing to go back to, and Start over shows the examples.
  await openLink();
  assert.equal(await backToMine.count(), 0, 'Back to mine with nobody saved');
  await p.click('#reset');
  assert.deepEqual(await chipsOf(p), ['Nana 1944 · TX', 'Mom 1970 · OH', 'Sam 2001 · CA']);
  await p.evaluate(k => localStorage.setItem(k, JSON.stringify([{ name: 'Old', year: 1850 }])), STORE);
  await openLink();
  assert.equal(await backToMine.count(), 0, 'Back to mine when what is saved is nobody the page can show');
  await p.context().close();
}

// The dialog's red text (its error line and Remove) is readable on the dialog in both palettes,
// including a dark theme set on the page (as the Artifact viewer does) rather than by the system.
for (const [scheme, theme] of [['light', ''], ['dark', ''], ['light', 'dark']]) {
  const p = await freshPage('', { colorScheme: scheme });
  if (theme) await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
  const ratios = await p.evaluate(() => {
    const lum = c => {
      const v = c.match(/[\d.]+/g).slice(0, 3).map(n => { n /= 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const bg = lum(getComputedStyle(document.querySelector('#edit')).backgroundColor);
    return ['#e-err', '#e-remove'].map(s => {
      const fg = lum(getComputedStyle(document.querySelector(s)).color);
      return +((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)).toFixed(2);
    });
  });
  assert.ok(ratios.every(r => r >= 4.5), `red text on the dialog (${scheme}${theme ? ', data-theme=' + theme : ''}): ${ratios}`);
  await p.context().close();
}

// In a sentence, the District of Columbia takes "the".
{
  const p = await freshPage('#p=Ann,1960,DC');
  assert.equal((await p.textContent('#headlines')).trim(),
    'Ann was 33 when gay sex stopped being a crime in the District of Columbia, and 50 when same-sex couples could marry there.');
  const rows = await p.$$eval('#ages-table tbody th', els => els.map(e => e.firstChild.textContent));
  assert.ok(rows.includes('Gay sex legal in the District of Columbia') && rows.includes('Marriage in the District of Columbia'), 'table rows: ' + rows);
  const blurbs = await p.$$eval('#years .ev.state p', els => els.map(e => e.textContent));
  for (const words of ['The District of Columbia’s legislature takes sex', 'The District of Columbia gives same-sex couples domestic partnerships', 'opens marriage to same-sex couples in the District of Columbia.']) {
    assert.ok(blurbs.some(b => b.includes(words)), 'no event says: ' + words);
  }
  await p.context().close();
}

// On paper: no footer and no buttons, the colour keys that say who is who still print, and the chart labels'
// halo is the paper's white rather than an outline in the screen's page colour.
{
  const p = await freshPage();
  await p.emulateMedia({ media: 'print' });
  const printed = await p.evaluate(() => {
    const cs = s => getComputedStyle(document.querySelector(s));
    return {
      footer: cs('.jd-foot').display, buttons: cs('#share-row').display + ' ' + getComputedStyle(document.querySelector('#reset').parentNode).display,
      starterForm: cs('#starter-form').display, keys: ['.chip .sw', '.age .dot', '.headlines .sw', '.legend i'].map(s => cs(s).printColorAdjust).join(' '),
      halo: cs('#svg .c-name').stroke + ' ' + cs('#svg .c-lane').stroke,
    };
  });
  assert.deepEqual(printed, { footer: 'none', buttons: 'none none', starterForm: 'none', keys: 'exact exact exact exact', halo: 'rgb(255, 255, 255) rgb(255, 255, 255)' });
  await p.context().close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
