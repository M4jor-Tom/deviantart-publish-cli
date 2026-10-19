import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectReceipt, saveCommitting, saveScheduled } from './receipt.ts';

async function stateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'da-receipt-'));
}

test('unknown receipt blocks submit', async () => {
  const dir = await stateDir();
  await saveCommitting(dir, 'one', 'fingerprint');
  assert.deepEqual(await inspectReceipt(dir, 'one', 'fingerprint'), {
    kind: 'unknown', error: 'submission may have succeeded; reconcile before retry',
  });
});

test('successful receipt replay avoids submit', async () => {
  const dir = await stateDir();
  const result = { id: 'one', status: 'scheduled' as const, url: null };
  await saveScheduled(dir, 'one', 'fingerprint', result);
  assert.deepEqual(await inspectReceipt(dir, 'one', 'fingerprint'), { kind: 'scheduled', result });
});

test('changed payload cannot reuse confirmed or uncertain id', async () => {
  for (const status of ['committing', 'scheduled'] as const) {
    const dir = await stateDir();
    if (status === 'committing') await saveCommitting(dir, 'one', 'old');
    else await saveScheduled(dir, 'one', 'old', { id: 'one', status: 'scheduled', url: null });
    await assert.rejects(inspectReceipt(dir, 'one', 'changed'), /different payload/i);
  }
});
