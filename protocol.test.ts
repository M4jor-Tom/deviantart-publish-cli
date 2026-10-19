import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareRequest, scheduleParts, validateRequest } from './protocol.ts';

const job = {
  id: 'one', imagePath: '/tmp/a.png', title: 'Title', description: 'Description', tags: ['art'],
  schedule: { timestamp: 1800000000, timezone: 'Europe/Paris' },
};

test('rejects a duplicate id before browser execution', () => {
  assert.throws(() => validateRequest({ jobs: [job, job] }), /duplicate/i);
});

test('rejects unknown fields and WebP', () => {
  assert.throws(() => validateRequest({ jobs: [{ ...job, surprise: true }] }), /unknown/i);
  assert.throws(() => validateRequest({ jobs: [{ ...job, imagePath: '/tmp/a.webp' }] }), /WebP/i);
});

test('reads a real image into an isolated file payload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'da-protocol-'));
  const imagePath = join(dir, 'art.png');
  await writeFile(imagePath, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
  const [prepared] = await prepareRequest(validateRequest({ jobs: [{ ...job, imagePath }] }));
  assert.equal(prepared.file.name, 'art.png');
  assert.equal(prepared.file.mimeType, 'image/png');
  assert.equal(Buffer.from(prepared.file.buffer, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('maps a timestamp through its explicit IANA timezone', () => {
  assert.deepEqual(scheduleParts({ timestamp: 1800000000, timezone: 'Europe/Paris' }), {
    year: 2027, month: 1, day: 15, hour: 9,
  });
  assert.throws(() => scheduleParts({ timestamp: 1800000000, timezone: 'Not/AZone' }), /timezone/i);
});
