import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkSteps, STEP_TITLES } from './publish.ts';

test('functional command and step registry stay in sync', async () => {
  assert.equal(await checkSteps(new URL('./commands/deviantart-publish.md', import.meta.url)), true);
});

test('step check fails for missing or mismatched commands', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'da-steps-'));
  const mismatch = join(dir, 'mismatch.md');
  await writeFile(mismatch, '### Steps\n1. Not the implemented step\n');
  assert.equal(await checkSteps(mismatch), false);
  assert.equal(await checkSteps(join(dir, 'missing.md')), false);
  assert.equal(STEP_TITLES.length, 12);
});
