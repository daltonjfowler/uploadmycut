// Shared bits for the browser tests (playwright-core driving an installed Chrome), like
// uploadmymodel's test/browser/lib.mjs.
//   CHROME: Chrome binary (env CHROME_PATH, default the usual Windows install)
//   OUT:    folder for screenshots and downloads (gitignored)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const BASE = 'http://127.0.0.1:8791/';
export const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const OUT = fileURLToPath(new URL('./.out/', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
export function check(name, ok, detail = '') {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}
export const failed = () => failures;

/** A Chromebook-sized page with page errors collected. */
export async function openPage({ base = BASE, width = 1366, height = 768, theme = 'light', query = '?debug' } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // Cloudflare injects its Web Analytics beacon on the live site and our CSP blocks it (on all
    // four family sites): no tracking happens, so that one message is not a page error.
    if (m.type() === 'error' && !/cloudflareinsights/.test(m.text())) errors.push(m.text());
  });
  await page.goto(base + query);
  await page.waitForFunction(() => window.umc);
  return { browser, ctx, page, errors };
}

/** True for a dev server on this computer (never the live site). */
export function isLocal(base) {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname);
  } catch {
    return false;
  }
}

/**
 * Tests that change or reset the class setup refuse anything but a local dev server: run
 * against the live site they would wipe the teacher's real setup.
 */
export function refuseUnlessLocal(base, what) {
  if (isLocal(base)) return;
  console.log(`FAIL refused: ${what} changes the class setup, so it runs only against a local dev server (not ${base})`);
  process.exit(1);
}
