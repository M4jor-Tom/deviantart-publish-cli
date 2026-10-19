import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScheduledResult } from './protocol.ts';

type Receipt = {
  version: 1;
  id: string;
  fingerprint: string;
  status: 'committing' | 'scheduled';
  result?: ScheduledResult;
};

export type ReceiptState =
  | { kind: 'absent' }
  | { kind: 'unknown'; error: string }
  | { kind: 'scheduled'; result: ScheduledResult };

export function receiptPath(stateDir: string, id: string): string {
  return join(stateDir, 'receipts', `${createHash('sha256').update(id).digest('hex')}.json`);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(join(path, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function saveCommitting(stateDir: string, id: string, fingerprint: string): Promise<void> {
  await atomicJson(receiptPath(stateDir, id), { version: 1, id, fingerprint, status: 'committing' } satisfies Receipt);
}

export async function saveScheduled(stateDir: string, id: string, fingerprint: string, result: ScheduledResult): Promise<void> {
  await atomicJson(receiptPath(stateDir, id), { version: 1, id, fingerprint, status: 'scheduled', result } satisfies Receipt);
}

export async function inspectReceipt(stateDir: string, id: string, fingerprint: string): Promise<ReceiptState> {
  let raw: string;
  try { raw = await readFile(receiptPath(stateDir, id), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
  let receipt: Receipt;
  try { receipt = JSON.parse(raw) as Receipt; }
  catch { throw new Error(`invalid receipt for id ${id}`); }
  if (receipt.version !== 1 || receipt.id !== id || !['committing', 'scheduled'].includes(receipt.status)) {
    throw new Error(`invalid receipt for id ${id}`);
  }
  if (receipt.fingerprint !== fingerprint) throw new Error(`id ${id} already has a receipt for a different payload`);
  if (receipt.status === 'committing') return { kind: 'unknown', error: 'submission may have succeeded; reconcile before retry' };
  if (!receipt.result || receipt.result.id !== id || receipt.result.status !== 'scheduled' || !('url' in receipt.result)) {
    throw new Error(`invalid scheduled receipt for id ${id}`);
  }
  return { kind: 'scheduled', result: receipt.result };
}

export async function withPublisherLock<T>(stateDir: string, action: () => Promise<T>): Promise<T> {
  await mkdir(stateDir, { recursive: true });
  const lock = join(stateDir, '.publisher.lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = await readFile(join(lock, 'owner'), 'utf8').catch(() => 'unknown owner');
    throw new Error(`publisher state is locked (${owner.trim()}); inspect stale lock at ${lock}, which is never removed automatically`);
  }
  try {
    await writeFile(join(lock, 'owner'), `pid=${process.pid} started=${new Date().toISOString()}\n`, { mode: 0o600 });
    return await action();
  } finally {
    await rm(join(lock, 'owner'), { force: true });
    await rmdir(lock);
  }
}
