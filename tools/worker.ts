#!/usr/bin/env node
/**
 * The explorer's background work in one process: block sync, tokens, internal transactions, the
 * richlist and prices. Which jobs run follows config.json (lib/features.ts), so a
 * part switched off there (the richlist, the DEX, a missing trace source) costs nothing.
 *
 *   npm run worker                    run the enabled jobs (pm2 app `worker`)
 *   npm run worker -- --plan          print which jobs would run and why, then exit
 *   npm run worker -- --only sync     run only these jobs (comma separated), e.g. to debug one
 *
 * Every line a job prints is prefixed with its name. A job whose start fails is started again
 * after a pause (1 minute, doubling up to 10), without stopping the others. One-off maintenance
 * (`npm run sync -- --start`, `tokens -- --rescan`, `internal-txs -- --from`,
 * `richlist -- --from`) still runs through the separate commands.
 */
import '../lib/env'; // .env / .env.local before any other module reads process.env
import { AsyncLocalStorage } from 'node:async_hooks';
import { getFeatures, getTraceSourceUrl, readConfig } from '../lib/config';
import { planJobs, selectJobs, type JobName } from '../lib/features';

// Loaded only when started (a job that is off is never loaded). The tools are CommonJS modules.
const load = {
  sync: () => require('./sync') as typeof import('./sync'),
  tokens: () => require('./tokens') as typeof import('./tokens'),
  internalTxs: () => require('./internal-txs') as typeof import('./internal-txs'),
  richlist: () => require('./richlist') as typeof import('./richlist'),
  price: () => require('./price') as typeof import('./price'),
};

const STARTERS: Record<JobName, () => Promise<unknown>> = {
  sync: async () => load.sync().main(),
  tokens: async () => load.tokens().main([]),
  'internal-transactions': async () => load.internalTxs().main([]),
  richlist: async () => load.richlist().runRichlist(),
  price: async () => load.price().main([]),
};

const FIRST_RETRY_MS = 60_000;
const LAST_RETRY_MS = 10 * 60_000;

const HELP = `Explorer worker: the background jobs, chosen from config.json

  npm run worker                  run the enabled jobs
  npm run worker -- --plan        print the plan (jobs, on or off, why) and exit
  npm run worker -- --only a,b    run only these jobs (${Object.keys(STARTERS).join(', ')})
`;

const job = new AsyncLocalStorage<JobName>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Prefixes what a job prints with its name (timers a job sets keep its name). */
function tagConsole(): void {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const write = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const name = job.getStore();
      if (name) write(`[${name}]`, ...args);
      else write(...args);
    };
  }
}

/** Starts a job; a failed start is retried after a pause without touching the other jobs. */
async function supervise(name: JobName): Promise<void> {
  let delay = FIRST_RETRY_MS;
  for (;;) {
    try {
      // resolves once the job has set up its own timers (or never, for a job that loops)
      await job.run(name, STARTERS[name]);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[worker] ${name} failed to start: ${reason}; starting it again in ${delay / 1000} s`
      );
      await sleep(delay);
      delay = Math.min(delay * 2, LAST_RETRY_MS);
    }
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  const plan = planJobs({ config: readConfig(), traceUrl: getTraceSourceUrl(), env: process.env });
  const only = argValue(args, '--only')
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const selected = selectJobs(plan, only);

  if (args.includes('--plan')) {
    for (const entry of plan) {
      const state = selected.includes(entry.name) ? 'run' : 'off';
      console.log(`${state.padEnd(4)} ${entry.name.padEnd(22)} ${entry.reason}`);
    }
    return;
  }

  tagConsole();
  let stopping = false;
  const exit = process.exit.bind(process);
  process.exit = ((code?: number | string | null) => {
    const name = job.getStore();
    if (name && !stopping && code !== 0 && code !== undefined) {
      console.error(`[worker] the ${name} job stopped the worker (exit ${code}); pm2 restarts it`);
    }
    return exit(stopping ? 0 : (code ?? undefined));
  }) as typeof process.exit;

  // The buffered blocks are written, then the process ends with the jobs where they are: closing
  // the database first made every job in the middle of a write fail and report it. The jobs resume
  // from their stored positions, and their writes are upserts.
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal}: stopping`);
    if (selected.includes('sync')) {
      try {
        await load.sync().flushPendingWrites();
      } catch (error) {
        console.error('[worker] could not write the buffered blocks:', (error as Error).message);
      }
    }
    exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  // started by the web server (lib/worker-process.ts): stop with it, also if it was killed
  process.on('disconnect', () => void stop('the explorer stopped'));

  // DEX settings config.json leaves out come from the chain (lib/dex/cache-service.ts)
  if (getFeatures().dex) {
    const { loadDexSettingsFromChain } =
      require('../lib/dex/cache-service') as typeof import('../lib/dex/cache-service');
    const readDex = () =>
      loadDexSettingsFromChain().catch((error: Error) =>
        console.error(`[worker] DEX settings not read from the chain: ${error.message}`)
      );
    await readDex();
    setInterval(readDex, 10 * 60_000).unref();
  }

  console.log(`[worker] starting ${selected.join(', ')}`);
  for (const entry of plan.filter((entry) => !selected.includes(entry.name))) {
    console.log(`[worker] not running ${entry.name}: ${entry.reason}`);
  }
  for (const name of selected) void supervise(name);
  // pm2 (wait_ready) waits for this before it counts the app as online
  process.send?.('ready');
}

main(process.argv.slice(2)).catch((error) => {
  console.error('[worker]', error instanceof Error ? error.message : error);
  process.exit(1);
});
