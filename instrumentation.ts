/**
 * Runs once when the Next.js server starts. It starts the background jobs (tools/worker.ts), so
 * `npm start` (pm2 app `explorer`) is the whole explorer; config.json decides which jobs run.
 *
 * The jobs run in a child process, not in the server's event loop: a sync catching up must not
 * slow down the pages, and no job can stop the website. The child writes to the server's log
 * (each line with its job's name), is started again a minute after it ends, and stops with the
 * server (SIGINT when the server exits; by itself when the IPC channel closes).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { workerWanted } = await import('./lib/features');
  if (!workerWanted()) return;
  const { fork } = await import('node:child_process');
  const path = await import('node:path');

  // V8 collects only near its heap limit, so the limit is what the jobs take: 512 MB by default
  // (EXPLORER_WORKER_MEMORY_MB for a large chain); the tools pause their batches at 3/4 of it
  const heapMb = Number(process.env.EXPLORER_WORKER_MEMORY_MB) || 512;

  let child: ReturnType<typeof fork> | null = null;
  let stopping = false;
  const spawn = () => {
    // a file run at runtime, not a module of the build (turbopackIgnore keeps the bundler out)
    child = fork(path.join(/* turbopackIgnore: true */ process.cwd(), 'tools', 'worker.ts'), [], {
      execArgv: ['--import', 'tsx', `--max-old-space-size=${heapMb}`],
      env: {
        ...process.env,
        MEMORY_LIMIT_MB: String(Math.floor((heapMb * 3) / 4)),
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) return;
      console.error(
        `[explorer] the worker ended (${signal ?? `exit ${code}`}); restarting in 60 s`
      );
      setTimeout(spawn, 60_000).unref();
    });
  };
  process.on('exit', () => {
    stopping = true;
    child?.kill('SIGINT');
  });
  spawn();
}
