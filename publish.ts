import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright-core';
import { scheduleParts, type PreparedJob } from './protocol.ts';

export const STEP_TITLES = [
  'Connect to www.deviantart.com',
  'Click on submit',
  'Click on "upload your art" and pick file <job.imagePath>',
  'Set as title <job.title>',
  'Set as description <job.description>',
  'Tick boxes "Mature" and "Created using AI tools"',
  'Drop all the pre-filled tags in the "Tags" field',
  'Add <job.tags> to the "Tags" field',
  'If the piece has a price, tick "Sell as Premium Download" and set the price',
  'Set the subscription tiers <job.tiers>',
  'Add to galleries <job.galleries>',
  'Schedule publication for <job.schedule>',
] as const;

function normalize(value: string): string {
  return value.replaceAll('`', '').replace(/\s+/g, ' ').trim();
}

export async function checkSteps(path: string | URL): Promise<boolean> {
  let markdown: string;
  try { markdown = await readFile(path, 'utf8'); }
  catch (error) {
    console.error(`check-steps: ${String(path)} not found: ${(error as Error).message}`);
    return false;
  }
  const steps: string[] = [];
  let inSteps = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^###\s+Steps\s*$/i.test(line.trim())) { inSteps = true; continue; }
    if (inSteps && line.startsWith('#')) break;
    const match = inSteps && line.match(/^\s*\d+\.\s+(.*\S)\s*$/);
    if (match) steps.push(normalize(match[1]));
  }
  const expected = STEP_TITLES.map(normalize);
  const ok = steps.length === expected.length && steps.every((step, index) => step === expected[index]);
  if (ok) console.error(`check-steps OK: ${expected.length} steps in sync`);
  else {
    console.error(`check-steps DRIFT: command has ${steps.length} steps, implementation has ${expected.length}`);
    for (let index = 0; index < Math.max(steps.length, expected.length); index++) {
      if (steps[index] !== expected[index]) console.error(`step ${index + 1}: command=${steps[index] ?? '<missing>'} implementation=${expected[index] ?? '<missing>'}`);
    }
  }
  return ok;
}

async function setCheckbox(page: Page, name: string, want = true): Promise<void> {
  const checkbox = page.locator(`input[name="${name}"]`);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await checkbox.isChecked() === want) return;
    await checkbox.evaluate((element: HTMLInputElement) => element.click());
    await page.waitForTimeout(300);
  }
  throw new Error(`checkbox ${name} would not stay ${want}`);
}

function tagInput(page: Page) {
  return page.locator('input[aria-errormessage$="-error"]').last();
}

async function pickInCombo(page: Page, combo: ReturnType<Page['locator']>, text: string): Promise<void> {
  await combo.click();
  await page.waitForTimeout(200);
  await page.getByText(text, { exact: true }).first().click();
  await combo.click();
}

async function chooseSchedule(page: Page, job: PreparedJob): Promise<void> {
  const { year, month, day, hour } = scheduleParts(job.schedule);
  const caret = page.locator('button[aria-haspopup="menu"]').last();
  await caret.scrollIntoViewIfNeeded();
  await caret.click();
  await page.locator('[role="menuitem"][aria-label="Schedule"], [role="menuitem"][label="Schedule"]').first().click({ force: true });
  await page.locator('#schedule-draft-date-picker [role="button"]').click();
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1)));
  const dayLabel = `${monthName} ${day}, ${year}`;
  for (let attempt = 0; attempt < 24; attempt++) {
    if (await page.locator(`button[aria-label*="${dayLabel}"]`).count()) break;
    await page.locator('button[aria-label="Go to the Next Month"]').click();
  }
  const date = page.locator(`button[aria-label*="${dayLabel}"]`).first();
  if (!await date.count()) throw new Error(`schedule date ${dayLabel} is outside the 24-month picker window`);
  await date.click();
  await page.selectOption('#schedule-draft-time-picker', String(hour));
  await page.getByText('Confirm Schedule', { exact: true }).click();
}

async function authenticate(page: Page): Promise<void> {
  await page.goto('https://www.deviantart.com/studio?new=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (new URL(page.url()).pathname.includes('/users/login')) throw new Error('no valid DeviantArt session; use the browser app to log in manually');
}

export async function submitJob(
  page: Page,
  job: PreparedJob,
  beforeFinalClick: () => Promise<void>,
): Promise<string | null> {
  await authenticate(page);

  // step 1: Connect to www.deviantart.com
  await page.goto('https://www.deviantart.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // step 2: Click on submit
  await page.getByRole('link', { name: 'Submit' }).first().click();
  await page.waitForLoadState('domcontentloaded');
  // step 3: Click on "upload your art" and pick file <job.imagePath>
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Upload Your Art', { exact: true }).click();
  await (await chooser).setFiles({ name: job.file.name, mimeType: job.file.mimeType, buffer: Buffer.from(job.file.buffer, 'base64') });
  // step 4: Set as title <job.title>
  await page.getByLabel('Title', { exact: false }).first().fill(job.title);
  // step 5: Set as description <job.description>
  await page.locator('[contenteditable="true"]').first().fill(job.description);
  // step 6: Tick boxes "Mature" and "Created using AI tools"
  await setCheckbox(page, 'matureContent');
  await setCheckbox(page, 'isAiGenerated');
  // step 7: Drop all the pre-filled tags in the "Tags" field
  await tagInput(page).click();
  const chips = page.locator('[role="combobox"] span[role="button"][data-tag]');
  for (let attempt = 0; attempt < 60 && await chips.count(); attempt++) {
    try { await chips.first().click(); } catch { /* Dynamic chips can re-render during removal. */ }
  }
  // step 8: Add <job.tags> to the "Tags" field
  for (const tag of job.tags) {
    await tagInput(page).fill(tag);
    await page.keyboard.press('Enter');
  }
  // step 9: If the piece has a price, tick "Sell as Premium Download" and set the price
  if (job.price !== undefined) {
    await page.getByLabel('Sell as Premium Download').click();
    await page.locator('input[name="downloadDollarPrice"]').fill(String(job.price));
  }
  // step 10: Set the subscription tiers <job.tiers>
  if (job.tiers?.length) {
    const combo = page.getByText('Submit to your subscribers', { exact: false }).locator('xpath=following::*[@role="combobox"][1]');
    await combo.scrollIntoViewIfNeeded();
    for (const tier of job.tiers) await pickInCombo(page, combo, tier);
  }
  // step 11: Add to galleries <job.galleries>
  for (const gallery of job.galleries ?? []) {
    const combo = page.locator('xpath=//*[normalize-space(text())="Gallery"]/following::*[@role="combobox"][1]');
    await combo.scrollIntoViewIfNeeded();
    if (!(await combo.innerText()).includes(gallery)) await pickInCombo(page, combo, gallery);
  }
  // step 12: Schedule publication for <job.schedule>
  await chooseSchedule(page, job);
  await setCheckbox(page, 'matureContent');
  const success = page.getByText(/^(?:your )?deviation (?:has been|was) scheduled\b|^scheduled successfully\b/i).first();
  if (await success.isVisible()) throw new Error('stale scheduling confirmation before submission');
  await beforeFinalClick();
  await page.getByText('Schedule', { exact: true }).last().click();
  await success.waitFor({ state: 'visible', timeout: 15_000 });
  const link = success.locator('a[href]').first();
  const href = await link.count() ? await link.getAttribute('href') : null;
  return href ? new URL(href, page.url()).href : null;
}
