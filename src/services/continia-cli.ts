import type { AppConfig } from '../types/index.ts';

/**
 * Typed wrapper over `continia.exe --json` for the deterministic pipeline
 * stages (provision, activate, verify, credentials). Field names in the CLI's
 * JSON are read leniently: the wrapper accepts the known spellings and fails
 * with the raw keys listed when none match, so a CLI change is easy to spot.
 */

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type Exec = (cmd: string[], timeoutMs: number) => Promise<ExecResult>;

export class ContiniaCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContiniaCliError';
  }
}

export interface EnvInfo {
  id: string;
  name: string;
  url: string;
  status: string;
}

export interface InstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  reasonCode?: string;
}

export interface InstalledApp {
  name: string;
  publisher: string;
  version: string;
}

export interface EnvUser {
  username: string;
  password: string;
}

export interface ContiniaCli {
  createEnvironment(name: string, profileId: string): Promise<string>;
  startEnvironment(envId: string): Promise<void>;
  getEnvironment(envId: string): Promise<EnvInfo>;
  installAppById(envId: string, appId: string): Promise<InstallResult>;
  listApps(envId: string): Promise<InstalledApp[]>;
  getUsers(envId: string): Promise<EnvUser[]>;
}

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

const defaultExec: Exec = async (cmd, timeoutMs) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

type Json = Record<string, unknown>;

function pickString(obj: Json, keys: string[], what: string): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  throw new ContiniaCliError(
    `continia JSON has no ${what} (tried ${keys.join(', ')}; got keys ${Object.keys(obj).join(', ')})`,
  );
}

function optionalString(obj: Json, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
}

/** Accept a bare array or an object wrapping one under a known key. */
function asArray(value: unknown, keys: string[]): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (value && typeof value === 'object') {
    for (const key of keys) {
      const inner = (value as Json)[key];
      if (Array.isArray(inner)) return inner as Json[];
    }
  }
  throw new ContiniaCliError(`expected a JSON array from continia (or an object with ${keys.join('/')})`);
}

function asObject(value: unknown): Json {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json;
  throw new ContiniaCliError('expected a JSON object from continia');
}

export function createContiniaCli(config: AppConfig, exec: Exec = defaultExec): ContiniaCli {
  /** Run one command. `secret` keeps stdout out of error messages (passwords). */
  async function run(args: string[], opts: { json?: boolean; secret?: boolean } = {}): Promise<unknown> {
    const json = opts.json ?? true;
    const cmd = [
      config.continiaCliPath,
      ...(config.continiaApiToken ? ['--token', config.continiaApiToken] : []),
      ...args,
      ...(json ? ['--json'] : []),
    ];
    const label = `continia ${args.join(' ')}`;
    const result = await exec(cmd, COMMAND_TIMEOUT_MS);
    if (result.exitCode !== 0) {
      const detail = (result.stderr.trim() || (opts.secret ? '' : result.stdout.trim())).slice(0, 500);
      throw new ContiniaCliError(`${label} exited ${result.exitCode}: ${detail}`);
    }
    if (!json) return undefined;
    try {
      return JSON.parse(result.stdout);
    } catch {
      const preview = opts.secret ? '' : `: ${result.stdout.slice(0, 200)}`;
      throw new ContiniaCliError(`${label} returned non-JSON output${preview}`);
    }
  }

  function toEnvInfo(raw: unknown): EnvInfo {
    const obj = asObject(raw);
    return {
      id: pickString(obj, ['id', 'environmentId', 'envId'], 'environment id'),
      name: optionalString(obj, ['name', 'description', 'displayName']),
      url: optionalString(obj, ['url', 'webClientUrl', 'clientUrl', 'webClient']),
      status: optionalString(obj, ['status', 'state']),
    };
  }

  return {
    async createEnvironment(name, profileId) {
      const raw = await run(['env', 'create', '--name', name, '--profile', profileId]);
      return toEnvInfo(raw).id;
    },

    async startEnvironment(envId) {
      await run(['env', 'start', envId], { json: false });
    },

    async getEnvironment(envId) {
      return toEnvInfo(await run(['env', 'get', envId]));
    },

    async installAppById(envId, appId) {
      const obj = asObject(await run(['deps', 'install-by-id', envId, appId]));
      return {
        installed: obj['installed'] === true,
        alreadyPresent: obj['alreadyPresent'] === true,
        ...(typeof obj['reasonCode'] === 'string' ? { reasonCode: obj['reasonCode'] } : {}),
      };
    },

    async listApps(envId) {
      const rows = asArray(await run(['env', 'apps', envId]), ['apps', 'items', 'value']);
      return rows.map((row) => ({
        name: optionalString(row, ['name', 'displayName']),
        publisher: optionalString(row, ['publisher']),
        version: optionalString(row, ['version']),
      }));
    },

    async getUsers(envId) {
      const rows = asArray(await run(['env', 'users', envId], { secret: true }), ['users', 'items', 'value']);
      return rows.map((row) => ({
        username: pickString(row, ['username', 'userName', 'name', 'user'], 'username'),
        password: optionalString(row, ['password', 'pwd']),
      }));
    },
  };
}

export interface WaitDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultWaitDeps: WaitDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

const FAILED_STATUSES = new Set(['failed', 'error', 'deleted']);
const STARTABLE_STATUSES = new Set(['draft', 'stopped']);

/**
 * Start the environment if it is not already starting, then poll until it is
 * Running. Throws on a failed status or when `timeoutMs` passes.
 */
export async function waitForRunning(
  cli: ContiniaCli,
  envId: string,
  timeoutMs: number,
  pollMs = 10_000,
  deps: WaitDeps = defaultWaitDeps,
): Promise<EnvInfo> {
  const deadline = deps.now() + timeoutMs;
  let started = false;
  for (;;) {
    const env = await cli.getEnvironment(envId);
    const status = env.status.toLowerCase();
    if (status === 'running') return env;
    if (FAILED_STATUSES.has(status)) {
      throw new ContiniaCliError(`environment ${envId} entered status ${env.status}`);
    }
    if (!started && STARTABLE_STATUSES.has(status)) {
      await cli.startEnvironment(envId);
      started = true;
    }
    if (deps.now() >= deadline) {
      throw new ContiniaCliError(
        `environment ${envId} not Running after ${Math.round(timeoutMs / 60_000)} min (last status ${env.status || 'unknown'})`,
      );
    }
    await deps.sleep(pollMs);
  }
}
