import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareRequest, validateRequest } from './protocol.ts';
import { submitJob } from './publish.ts';
import { inspectReceipt, saveCommitting, saveScheduled } from './receipt.ts';

const html = `<!doctype html><html><body>
<a href="/studio?new=1" role="link">Submit</a>
<a href="/deviation/unrelated">Previously published artwork</a>
<label><span>Upload Your Art</span><input id="upload" type="file" hidden></label>
<label>Title <input aria-label="Title"></label>
<div contenteditable="true"></div>
<input type="checkbox" name="matureContent"><input type="checkbox" name="isAiGenerated">
<div role="combobox" id="tags"><span role="button" data-tag="old" onclick="this.remove()">old</span><input aria-errormessage="tags-error"></div>
<label>Sell as Premium Download <input type="checkbox"></label><input name="downloadDollarPrice">
<div>Submit to your subscribers</div><div role="combobox" id="tiers">Select tiers</div><button onclick="tiers.textContent = 'Gold'">Gold</button>
<div>Gallery</div><div role="combobox" id="galleries">Featured</div><button onclick="galleries.textContent += ' Landscapes'">Landscapes</button>
<button aria-haspopup="menu">menu</button><div role="menuitem" aria-label="Schedule">Schedule</div>
<div id="schedule-draft-date-picker"><button role="button">date</button></div>
<button aria-label="January 15, 2027">15</button><button aria-label="Go to the Next Month">next</button>
<select id="schedule-draft-time-picker">${Array.from({ length: 24 }, (_, hour) => `<option value="${hour}">${hour}</option>`).join('')}</select>
<button>Confirm Schedule</button><button id="final">Schedule</button>
<div data-testid="scheduled-success" hidden>Scheduled successfully</div>
<script>
window.addedTags = [];
const tagInput = document.querySelector('[aria-errormessage="tags-error"]');
tagInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); window.addedTags.push(tagInput.value); tagInput.value = ''; } });
document.querySelector('#upload').addEventListener('change', event => window.uploadName = event.target.files[0]?.name);
document.querySelector('#final').addEventListener('click', () => { if (!window.fixtureUncertain) document.querySelector('[data-testid="scheduled-success"]').hidden = false; });
</script></body></html>`;

test('disposable Firefox exercises upload, options, schedule, and receipt outcomes', {
  timeout: 45_000,
  skip: !process.env.PLAYWRIGHT_FIREFOX && 'run inside `nix develop` with PLAYWRIGHT_FIREFOX',
}, async () => {
  const { firefox } = await import('playwright-core');
  const root = await mkdtemp(join(tmpdir(), 'da-firefox-fixture-'));
  const profile = join(root, 'profile');
  const imagePath = join(root, 'art.png');
  await writeFile(imagePath, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
  let uncertainMode = false;
  const context = await firefox.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.PLAYWRIGHT_FIREFOX,
    env: { ...process.env, KEYFARM_PROFILE: profile },
  });
  try {
    await context.route('https://www.deviantart.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: html.replace('window.addedTags = [];', `window.fixtureUncertain = ${uncertainMode}; window.addedTags = [];`),
    }));
    const page = context.pages()[0] ?? await context.newPage();
    const [job] = await prepareRequest(validateRequest({ jobs: [{
      id: 'confirmed', imagePath, title: 'Fixture title', description: 'Fixture description', tags: ['one', 'two'],
      schedule: { timestamp: 1800000000, timezone: 'Europe/Paris' }, price: 5, tiers: ['Gold'], galleries: ['Landscapes'],
    }] }));
    const url = await submitJob(page, job, () => saveCommitting(root, job.id, job.fingerprint));
    assert.equal(url, null, 'an unrelated artwork link is not the submitted URL');
    const result = { id: job.id, status: 'scheduled' as const, url };
    await saveScheduled(root, job.id, job.fingerprint, result);
    assert.deepEqual(await inspectReceipt(root, job.id, job.fingerprint), { kind: 'scheduled', result });
    assert.deepEqual(await page.evaluate(() => ({
      upload: (window as unknown as { uploadName: string }).uploadName,
      tags: (window as unknown as { addedTags: string[] }).addedTags,
      title: (document.querySelector('[aria-label="Title"]') as HTMLInputElement).value,
      description: document.querySelector('[contenteditable="true"]')?.textContent,
      mature: (document.querySelector('[name="matureContent"]') as HTMLInputElement).checked,
      ai: (document.querySelector('[name="isAiGenerated"]') as HTMLInputElement).checked,
      price: (document.querySelector('[name="downloadDollarPrice"]') as HTMLInputElement).value,
      tier: document.querySelector('#tiers')?.textContent,
      gallery: document.querySelector('#galleries')?.textContent,
      hour: (document.querySelector('#schedule-draft-time-picker') as HTMLSelectElement).value,
    })), {
      upload: 'art.png', tags: ['one', 'two'], title: 'Fixture title', description: 'Fixture description',
      mature: true, ai: true, price: '5', tier: 'Gold', gallery: 'Featured Landscapes', hour: '9',
    });

    const uncertain = { ...job, id: 'uncertain', fingerprint: `${job.fingerprint}-uncertain` };
    uncertainMode = true;
    await assert.rejects(submitJob(page, uncertain, () => saveCommitting(root, uncertain.id, uncertain.fingerprint)), /Timeout/i);
    assert.equal((await inspectReceipt(root, uncertain.id, uncertain.fingerprint)).kind, 'unknown');
  } finally {
    await context.close();
    await rm(root, { recursive: true, force: true });
  }
});
