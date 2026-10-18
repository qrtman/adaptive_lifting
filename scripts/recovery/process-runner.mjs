import { spawn } from 'node:child_process';

// Maximum lifecycle: timeoutMs + 2 * killGraceMs (at most 620 seconds).
// The final grace bounds failed kill/pipe closure confirmation; it never implies success.
export const PROCESS_LIMITS = Object.freeze({
  timeoutMs: 120_000, maxTimeoutMs: 600_000,
  killGraceMs: 2_000, maxKillGraceMs: 10_000,
  maxBufferBytes: 8 * 1024 * 1024,
});

function failure(code) {
  const error = new Error(`Recovery command failed (${code}).`);
  error.name = 'ProcessCommandError';
  error.code = code;
  return error;
}

function bounded(value, fallback, min, max) {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < min || number > max) throw failure('INVALID_OPTIONS');
  return number;
}

/** Start a shell-free command. closed rejects on every interruption/nonzero exit.
 * spawnImpl and signalSource permit isolated lifecycle tests; production defaults
 * use Node spawn and process. No supplied error/reason is attached to failures.
 */
export function startCommand(binary, args, options = {}) {
  const timeoutMs = bounded(options.timeoutMs, PROCESS_LIMITS.timeoutMs, 10, PROCESS_LIMITS.maxTimeoutMs);
  const killGraceMs = bounded(options.killGraceMs, PROCESS_LIMITS.killGraceMs, 10, PROCESS_LIMITS.maxKillGraceMs);
  const signalSource = options.signalSource ?? process;
  const abortSignal = options.signal;
  let child;
  let settled = false;
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  let stoppedCode;
  let deadline;
  let escalation;
  let confirmation;
  let resolveClosed;
  let rejectClosed;
  const closed = new Promise((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
  // Callers often attach the rejection handler only after connecting pipelines.
  closed.catch(() => {});
  const streams = new Map();
  const cleanup = () => {
    clearTimeout(deadline);
    clearTimeout(escalation);
    clearTimeout(confirmation);
    abortSignal?.removeEventListener('abort', onAbort);
    if (options.handleSignals) {
      signalSource.removeListener('SIGINT', onInterrupt);
      signalSource.removeListener('SIGTERM', onTerminate);
    }
  };
  const settle = (code) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (code) rejectClosed(failure(code));
    else resolveClosed({ code: exitCode, signal: exitSignal });
  };
  const maybeClosed = () => {
    if (exited && [...streams.values()].every(Boolean)) {
      settle(stoppedCode ?? (exitSignal ? 'SIGNAL' : exitCode === 0 ? null : 'EXIT'));
    }
  };
  const kill = (signal) => {
    try { child?.kill(signal); } catch { /* Confirmation remains mandatory. */ }
  };
  const stop = (code) => {
    if (settled || stoppedCode) return closed;
    stoppedCode = code;
    clearTimeout(deadline);
    escalation = setTimeout(() => {
      confirmation = setTimeout(() => {
        // Descendants can retain inherited pipes. Bound our wait and fail closed.
        for (const stream of streams.keys()) stream.destroy();
        settle('CLOSURE_UNCONFIRMED');
      }, killGraceMs);
      kill('SIGKILL');
    }, killGraceMs);
    kill('SIGTERM');
    maybeClosed();
    return closed;
  };
  const onAbort = () => { stop('ABORTED'); };
  const onInterrupt = () => { stop('INTERRUPTED'); };
  const onTerminate = () => { stop('INTERRUPTED'); };
  const handle = { get child() { return child; }, closed, abort: () => stop('ABORTED') };
  if (abortSignal?.aborted) {
    settle('ABORTED');
    return handle;
  }
  try {
    child = (options.spawnImpl ?? spawn)(binary, args, {
      cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, shell: false,
    });
  } catch {
    settle('SPAWN');
    return handle;
  }
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    streams.set(stream, stream.closed === true);
    stream.once('close', () => { streams.set(stream, true); maybeClosed(); });
    stream.on('error', () => { stop('STREAM'); });
  }
  child.stdin?.on('error', () => { stop('STREAM'); });
  child.once('error', () => {
    // A failed spawn has no running process to terminate. Node still closes stdio.
    if (child.pid == null) { stoppedCode ??= 'SPAWN'; exited = true; maybeClosed(); }
    else stop('PROCESS');
  });
  child.once('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    maybeClosed();
  });
  child.once('close', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    maybeClosed();
  });
  abortSignal?.addEventListener('abort', onAbort, { once: true });
  if (options.handleSignals) {
    signalSource.on('SIGINT', onInterrupt);
    signalSource.on('SIGTERM', onTerminate);
  }
  deadline = setTimeout(() => { stop('TIMEOUT'); }, timeoutMs);
  if (abortSignal?.aborted) onAbort();
  return handle;
}

/** Capture bounded UTF-8 stdout/stderr. Output is returned only on success. */
export async function runCommand(binary, args, options = {}) {
  const maxBufferBytes = bounded(options.maxBufferBytes, PROCESS_LIMITS.maxBufferBytes, 1, 64 * 1024 * 1024);
  const handle = startCommand(binary, args, options);
  let bytes = 0;
  let overflow = false;
  const stdout = [];
  const stderr = [];
  for (const [stream, chunks] of [[handle.child?.stdout, stdout], [handle.child?.stderr, stderr]]) {
    stream?.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBufferBytes) {
        overflow = true;
        handle.abort().catch(() => {});
      } else chunks.push(buffer);
    });
  }
  if (handle.child?.stdin) {
    try { handle.child.stdin.end(options.input); } catch { handle.abort().catch(() => {}); }
  }
  try {
    const result = await handle.closed;
    return { ...result, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
  } catch (error) {
    if (overflow) throw failure('OUTPUT_LIMIT');
    throw error;
  }
}
