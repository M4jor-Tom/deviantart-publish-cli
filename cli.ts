import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSteps } from './publish.ts';
import { prepareRequest, validateRequest, type PreparedJob, type Result } from './protocol.ts';
import { inspectReceipt, withPublisherLock } from './receipt.ts';

const HELP = `Usage: deviantart-publish-cli [options] < request.json

Options:
  --headless                 Run Firefox headlessly (headed is the default)
  --browser firefox NAME     Use an existing named Firefox profile
  --state-dir DIR            Receipt/profile state (default: .deviantart-publish in CWD)
  --check-steps              Verify commands/deviantart-publish.md matches task steps
  --help                     Show this help

stdin is one {"jobs":[...]} JSON request. stdout is result NDJSON; diagnostics use stderr.`;

type Options = { headless: boolean; stateDir: string; browser?: ['firefox', string]; mode: 'publish' | 'check' | 'help' };

function options(argv: string[]): Options {
  const parsed: Options = { headless: false, stateDir: resolve('.deviantart-publish'), mode: 'publish' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--headless') parsed.headless = true;
    else if (arg === '--state-dir') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--state-dir requires DIR');
      parsed.stateDir = resolve(value);
    } else if (arg === '--browser') {
      const browser = argv[++index];
      const name = argv[++index];
      if (browser !== 'firefox' || !name || name.startsWith('--')) throw new Error('--browser requires: firefox NAME');
      parsed.browser = ['firefox', name];
    } else if (arg === '--check-steps') parsed.mode = 'check';
    else if (arg === '--help' || arg === '-h') parsed.mode = 'help';
    else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function emit(result: Result): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function publish(jobs: PreparedJob[], opts: Options): Promise<number> {
  if (!jobs.length) return 0;
  return withPublisherLock(opts.stateDir, async () => {
    let firstPending = 0;
    for (; firstPending < jobs.length; firstPending++) {
      const job = jobs[firstPending];
      let receipt;
      try { receipt = await inspectReceipt(opts.stateDir, job.id, job.fingerprint); }
      catch (error) {
        const message = (error as Error).message;
        emit({ id: job.id, status: 'failed', error: message });
        console.error(message);
        return 1;
      }
      if (receipt.kind === 'absent') break;
      if (receipt.kind === 'scheduled') { emit(receipt.result); continue; }
      emit({ id: job.id, status: 'unknown', error: receipt.error });
      console.error(`${job.id}: ${receipt.error}`);
      return 1;
    }
    if (firstPending === jobs.length) return 0;

    const runner = process.env[opts.headless ? 'DEVIANTART_RUNNER_HEADLESS' : 'DEVIANTART_RUNNER_HEADED'];
    if (!runner) {
      emit({ id: jobs[firstPending].id, status: 'failed', error: 'packaged browser runner is not configured' });
      console.error('packaged browser runner is not configured');
      return 1;
    }
    const args = opts.browser ? ['--browser', ...opts.browser] : [];
    const child = spawn(runner, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DEVIANTART_PROFILE: resolve(opts.stateDir, 'profile') },
    });
    let producedResult = false;
    let spawnError: Error | undefined;
    child.stdout.on('data', chunk => {
      if (String(chunk).trim()) producedResult = true;
      process.stdout.write(chunk);
    });
    child.stderr.pipe(process.stderr);
    child.on('error', error => { spawnError = error; });
    child.stdin.on('error', () => { /* A launch failure can close stdin before the prepared batch is written. */ });
    child.stdin.end(JSON.stringify({ stateDir: opts.stateDir, jobs: jobs.slice(firstPending) }));
    const status = await new Promise<number>(resolveStatus => child.on('close', code => resolveStatus(code ?? 1)));
    if (spawnError) console.error(spawnError.message);
    if (!producedResult) {
      const job = jobs[firstPending];
      const receipt = await inspectReceipt(opts.stateDir, job.id, job.fingerprint);
      if (receipt.kind === 'scheduled') emit(receipt.result);
      else emit({ id: job.id, status: receipt.kind === 'unknown' ? 'unknown' : 'failed',
        error: receipt.kind === 'unknown' ? receipt.error : 'browser execution ended without a result or recorded submission' });
      return 1;
    }
    return status;
  });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let opts: Options;
  try { opts = options(argv); }
  catch (error) { console.error((error as Error).message); console.error(HELP); return 2; }
  if (opts.mode === 'help') { console.log(HELP); return 0; }
  if (opts.mode === 'check') return await checkSteps(new URL('./commands/deviantart-publish.md', import.meta.url)) ? 0 : 1;
  try {
    const raw = await readStdin();
    if (!raw.trim()) throw new Error('stdin request is empty');
    return await publish(await prepareRequest(validateRequest(JSON.parse(raw))), opts);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
