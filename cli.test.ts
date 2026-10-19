import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'da-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const imagePath = join(root, 'art.png');
  await writeFile(imagePath, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
  const runner = join(root, 'runner.mjs');
  const record = join(root, 'request.json');
  await writeFile(runner, `#!${process.execPath}
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
await writeFile(process.env.FIXTURE_RECORD, JSON.stringify({args: process.argv.slice(2), ...request}));
const job = request.jobs[0];
if (process.env.FIXTURE_CRASH) {
  const dir = join(request.stateDir, 'receipts'); await mkdir(dir, {recursive:true});
  await writeFile(join(dir, createHash('sha256').update(job.id).digest('hex') + '.json'),
    JSON.stringify({version:1,id:job.id,fingerprint:job.fingerprint,status:'committing'}));
  process.exitCode = 1;
} else { for (const item of request.jobs) console.log(JSON.stringify({id:item.id,status:'scheduled',url:null})); }
`, { mode: 0o755 });
  const request = { jobs: [{ id: 'one', imagePath, title: 'Title', description: 'Description', tags: ['art'],
    schedule: { timestamp: 1800000000, timezone: 'Europe/Paris' } }] };
  const run = (args: string[] = [], extraEnv: Record<string, string> = {}) => spawnSync(process.execPath,
    ['--experimental-strip-types', new URL('./cli.ts', import.meta.url).pathname, '--state-dir', join(root, 'state'), ...args],
    { input: JSON.stringify(request), encoding: 'utf8', env: { ...process.env,
      DEVIANTART_RUNNER_HEADED: runner, DEVIANTART_RUNNER_HEADLESS: runner, FIXTURE_RECORD: record, ...extraEnv } });
  return { root, record, run };
}

test('CLI forwards only explicit browser overrides and prepared uploads', async t => {
  const { record, run } = await fixture(t);
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { id: 'one', status: 'scheduled', url: null });
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')).args, []);
  const second = run(['--browser', 'firefox', 'privacy', '--headless']);
  assert.equal(second.status, 0, second.stderr);
  const received = JSON.parse(await readFile(record, 'utf8'));
  assert.deepEqual(received.args, ['--browser', 'firefox', 'privacy']);
  assert.equal(received.jobs[0].file.mimeType, 'image/png');
});

test('runner crash after commit returns unknown and next invocation does not run browser', async t => {
  const { record, run } = await fixture(t);
  const crashed = run([], { FIXTURE_CRASH: '1' });
  assert.equal(crashed.status, 1);
  assert.equal(JSON.parse(crashed.stdout).status, 'unknown');
  await rm(record);
  const retry = run();
  assert.equal(retry.status, 1);
  assert.equal(JSON.parse(retry.stdout).status, 'unknown');
  await assert.rejects(readFile(record), { code: 'ENOENT' });
});
