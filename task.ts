import type { Page } from 'playwright-core';
import { inspectReceipt, saveCommitting, saveScheduled } from './receipt.ts';
import { submitJob } from './publish.ts';
import type { PreparedJob, Result } from './protocol.ts';

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function emit(result: Result): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export async function run(page: Page): Promise<void> {
  const payload = JSON.parse(await stdin()) as { stateDir: string; jobs: PreparedJob[] };
  for (const job of payload.jobs) {
    try {
      const receipt = await inspectReceipt(payload.stateDir, job.id, job.fingerprint);
      if (receipt.kind === 'scheduled') { emit(receipt.result); continue; }
      if (receipt.kind === 'unknown') {
        emit({ id: job.id, status: 'unknown', error: receipt.error });
        process.exitCode = 1;
        break;
      }
      let committing = false;
      try {
        const url = await submitJob(page, job, async () => {
          await saveCommitting(payload.stateDir, job.id, job.fingerprint);
          committing = true;
        });
        const result = { id: job.id, status: 'scheduled' as const, url };
        await saveScheduled(payload.stateDir, job.id, job.fingerprint, result);
        emit(result);
      } catch (error) {
        const message = (error as Error).message;
        emit(committing
          ? { id: job.id, status: 'unknown', error: `submission may have succeeded; reconcile before retry: ${message}` }
          : { id: job.id, status: 'failed', error: message });
        console.error(`${job.id}: ${message}`);
        process.exitCode = 1;
        break;
      }
    } catch (error) {
      const message = (error as Error).message;
      emit({ id: job.id, status: 'failed', error: message });
      console.error(`${job.id}: ${message}`);
      process.exitCode = 1;
      break;
    }
  }
}
