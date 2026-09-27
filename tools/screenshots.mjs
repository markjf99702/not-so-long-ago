// Renders the README screenshots (docs/*.png):  node tools/screenshots.mjs
// They use the example family (Nana, Mom and Sam), saved as if someone had entered them,
// with the year set to 1994.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const PEOPLE = [{ name: 'Nana', year: 1944, st: 'TX' }, { name: 'Mom', year: 1970, st: 'OH' }, { name: 'Sam', year: 2001, st: 'CA' }];
const YEAR = 1994;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.addInitScript(people => localStorage.setItem('not-so-long-ago.people.v1', JSON.stringify(people)), PEOPLE);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.$eval('#year', (el, y) => { el.value = y; el.dispatchEvent(new Event('input', { bubbles: true })); }, YEAR);
  return page;
}

// Scroll so the element's top sits a little below the top of the screen, then take the screen.
async function shot(page, selector, name, offset = 12) {
  await page.$eval(selector, (el, o) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - o), offset);
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(root, 'docs', name) });
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await shot(page, '#lifelines .sec-h', 'phone-lifelines.png', 20);
  await shot(page, '#readout', 'phone-year.png', 20);
  await shot(page, '#ages-sec .sec-h', 'phone-ages.png', 20);
  await page.context().close();
}

// The chart on a laptop.
{
  const page = await open({ width: 1280, height: 860 }, 1);
  await shot(page, '#lifelines .sec-h', 'lifelines.png', 28);
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
