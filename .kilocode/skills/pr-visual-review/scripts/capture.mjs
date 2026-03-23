/**
 * Playwright visual capture script for bulk PR review.
 *
 * Usage:
 *   PREVIEW_URL=<url> PROD_URL=<url> OUT_DIR=<dir> TEST_PKG=<pkg> bun capture.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const PREVIEW_URL = process.env.PREVIEW_URL;
const PROD_URL    = process.env.PROD_URL || 'https://bulk.frustrated.dev';
const OUT_DIR     = process.env.OUT_DIR  || '/tmp/bulk-review';
const TEST_PKG    = process.env.TEST_PKG || 'zustand';

if (!PREVIEW_URL) { console.error('PREVIEW_URL env var required'); process.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });

const SELECTORS = {
  app:             'main',
  header:          'header, [class*="Header"]',
  pkgInput:        '[id="pkg-input"]',
  // PR pivot components
  measurementView: '[class*="measurementView"], [class*="MeasurementView"]',
  discoverResults: '[class*="discoverResults"], [class*="DiscoverResults"]',
  footer:          'footer, [class*="Footer"]',
};

async function capture(baseUrl, label) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const url = `${baseUrl}/?pkg=${encodeURIComponent(TEST_PKG)}`;
  console.log(`[${label}] Navigating to: ${url}`);

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(`PageError: ${err.message}`));

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForSelector('main', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(4_000); // allow SolidJS reactive fetches to settle

  const screenshotPath = join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`[${label}] Screenshot: ${screenshotPath}`);

  const html = {};
  for (const [name, sel] of Object.entries(SELECTORS)) {
    try {
      html[name] = await page.$eval(sel, el => el.innerHTML);
    } catch {
      html[name] = null;
    }
  }

  const pageTitle = await page.title();
  let errorText = null;
  try {
    errorText = await page.$eval('[class*="error"], .error', el => el.textContent);
  } catch { /* no error element */ }

  writeFileSync(
    join(OUT_DIR, `${label}-components.json`),
    JSON.stringify({ url, label, pageTitle, html, consoleErrors, errorText }, null, 2),
  );

  await browser.close();
  return { screenshotPath, html, consoleErrors, pageTitle, errorText };
}

const prod    = await capture(PROD_URL,    'before');
const preview = await capture(PREVIEW_URL, 'after');

// Diff report
const issues = [];
console.log('\n=== COMPONENT DIFF ===');
for (const name of Object.keys(SELECTORS)) {
  const wasPresent = prod.html[name] !== null;
  const isPresent  = preview.html[name] !== null;
  let status;
  if (wasPresent && !isPresent) { status = `MISSING in preview`; issues.push(`${name}: missing in preview`); }
  else if (!wasPresent && isPresent) { status = `NEW in preview`; }
  else if (wasPresent && isPresent) {
    const changed = prod.html[name] !== preview.html[name];
    status = changed ? 'CHANGED' : 'unchanged';
  } else {
    status = 'absent in both';
  }
  console.log(`  ${status.padEnd(22)} ${name}`);
}

console.log(`\nProd page title:    "${prod.pageTitle}"`);
console.log(`Preview page title: "${preview.pageTitle}"`);
if (prod.errorText)    console.log(`\nProd error text:    "${prod.errorText}"`);
if (preview.errorText) console.log(`\nPreview error text: "${preview.errorText}"`);
if (prod.consoleErrors.length)    console.log('\nProd console errors:',    prod.consoleErrors);
if (preview.consoleErrors.length) console.log('\nPreview console errors:', preview.consoleErrors);

writeFileSync(join(OUT_DIR, 'diff-report.json'), JSON.stringify({ issues, prod, preview }, null, 2));

console.log('\n=== SUMMARY ===');
if (issues.length === 0) console.log('No structural issues detected.');
else { console.log('Issues found:'); issues.forEach(i => console.log('  •', i)); }
console.log(`\nScreenshots:\n  Before: ${prod.screenshotPath}\n  After:  ${preview.screenshotPath}`);
