'use strict';
/**
 * Worker thread that runs one Solidity compilation.
 *
 * Started by lib/contract/compile-worker.ts with
 *   workerData = { compilerPath, input, maxOutputBytes }
 * where `compilerPath` is a soljson file that lib/contract/compiler-cache.ts
 * verified against its published sha256. The compiler is wrapped with
 * solc/wrapper (`setupMethods`) and `compile(input)` runs synchronously here,
 * so the request process' event loop is never blocked. The result is posted
 * back as { ok: true, output } or { ok: false, code, error }; the parent
 * terminates the worker afterwards (or on timeout / memory limit).
 */
const { parentPort, workerData } = require('node:worker_threads');

function post(message) {
  if (parentPort) parentPort.postMessage(message);
}

try {
  const { compilerPath, input, maxOutputBytes } = workerData || {};
  if (typeof compilerPath !== 'string' || typeof input !== 'string') {
    throw new Error('solc-worker: compilerPath and input are required');
  }
  const setupMethods = require('solc/wrapper');
  const soljson = require(compilerPath);
  const compiler = setupMethods(soljson);
  const output = compiler.compile(input);
  if (typeof output !== 'string') {
    throw new Error('solc-worker: the compiler returned no output');
  }
  if (typeof maxOutputBytes === 'number' && output.length > maxOutputBytes) {
    post({
      ok: false,
      code: 'OUTPUT_TOO_LARGE',
      error: `Compiler output is ${output.length} bytes; the limit is ${maxOutputBytes}`,
    });
  } else {
    post({ ok: true, output });
  }
} catch (error) {
  post({
    ok: false,
    code: 'COMPILE_ERROR',
    error: error && error.message ? error.message : String(error),
  });
}
