import { describe, test, expect, mock } from 'bun:test';
import { createContiniaCli, waitForRunning, ContiniaCliError } from '../../src/services/continia-cli.ts';
import type { ContiniaCli, EnvInfo, Exec, ExecResult } from '../../src/services/continia-cli.ts';
import { testConfig } from '../helpers/config.ts';

function execReturning(...results: Array<Partial<ExecResult>>) {
  let i = 0;
  return mock<Exec>(async () => {
    const r = results[Math.min(i++, results.length - 1)]!;
    return { exitCode: 0, stdout: '', stderr: '', ...r };
  });
}

describe('createContiniaCli', () => {
  test('passes the token via the environment, pins api-token auth, and appends --json', async () => {
    const exec = execReturning({ stdout: '{"id":"env-1"}' });
    const cli = createContiniaCli(testConfig({ continiaCliPath: '/opt/continia' }), exec);
    const id = await cli.createEnvironment('Demo #1', 'prof-1');
    expect(id).toBe('env-1');
    expect(exec.mock.calls[0]![0]).toEqual([
      '/opt/continia', '--auth-method', 'api-token',
      'env', 'create', '--name', 'Demo #1', '--profile', 'prof-1', '--json',
    ]);
    expect(exec.mock.calls[0]![2]['CONTINIA_API_TOKEN']).toBe('cont-token');
    expect(exec.mock.calls[0]![0]).not.toContain('cont-token');
  });

  test('leaves auth to the CLI defaults when no token is configured', async () => {
    const exec = execReturning({ stdout: '{"id":"env-1","status":"Running"}' });
    await createContiniaCli(testConfig({ continiaApiToken: '' }), exec).getEnvironment('env-1');
    expect(exec.mock.calls[0]![0]).not.toContain('--auth-method');
  });

  test('env start runs without --json', async () => {
    const exec = execReturning({ stdout: 'started' });
    await createContiniaCli(testConfig(), exec).startEnvironment('env-1');
    expect(exec.mock.calls[0]![0]).toEqual(['continia', '--auth-method', 'api-token', 'env', 'start', 'env-1']);
  });

  test('reads environment fields under alternative names', async () => {
    const exec = execReturning({
      stdout: '{"environmentId":"e9","description":"Demo","webClientUrl":"https://bc","state":"Draft"}',
    });
    const env = await createContiniaCli(testConfig(), exec).getEnvironment('e9');
    expect(env).toEqual({ id: 'e9', name: 'Demo', url: 'https://bc', status: 'Draft' });
  });

  test('names the keys it saw when a required field is missing', async () => {
    const exec = execReturning({ stdout: '{"foo":1}' });
    await expect(createContiniaCli(testConfig(), exec).getEnvironment('x')).rejects.toThrow(
      /environment id.*got keys foo/,
    );
  });

  test('throws with stderr on a non-zero exit', async () => {
    const exec = execReturning({ exitCode: 2, stderr: 'Error: 401' });
    await expect(createContiniaCli(testConfig(), exec).listApps('e1')).rejects.toThrow(
      'continia env apps e1 --all exited 2: Error: 401',
    );
  });

  test('never echoes stdout of env users in errors', async () => {
    const exec = execReturning({ exitCode: 0, stdout: 'password=hunter2 not json' });
    const err = await createContiniaCli(testConfig(), exec).getUsers('e1').catch((e) => e);
    expect(err).toBeInstanceOf(ContiniaCliError);
    expect(String(err)).not.toContain('hunter2');
  });

  test('parses install-by-id results', async () => {
    const exec = execReturning({ stdout: '{"installed":false,"reasonCode":"not-found"}' });
    const result = await createContiniaCli(testConfig(), exec).installAppById('e1', 'app');
    expect(result).toEqual({ installed: false, alreadyPresent: false, reasonCode: 'not-found' });
  });

  test('listApps asks BC for all apps (DemoPortal omits dev-published PTEs)', async () => {
    const exec = execReturning({ stdout: '[]' });
    await createContiniaCli(testConfig(), exec).listApps('e1');
    expect(exec.mock.calls[0]![0]).toEqual(['continia', '--auth-method', 'api-token', 'env', 'apps', 'e1', '--all', '--json']);
  });

  test('accepts wrapped arrays for apps and users', async () => {
    const exec = execReturning(
      { stdout: '{"apps":[{"name":"Continia Demo Data - X","publisher":"P","version":"1.0.0.0"}]}' },
      { stdout: '[{"userName":"ADMIN","password":"pw"}]' },
    );
    const cli = createContiniaCli(testConfig(), exec);
    expect(await cli.listApps('e1')).toEqual([
      { name: 'Continia Demo Data - X', publisher: 'P', version: '1.0.0.0' },
    ]);
    expect(await cli.getUsers('e1')).toEqual([{ username: 'ADMIN', password: 'pw' }]);
  });
});

describe('profiles', () => {
  test('parses versions and profile rows as the CLI returns them', async () => {
    const exec = execReturning(
      { stdout: '["28.5.0.0","29.0.0.0"]' },
      {
        stdout: JSON.stringify([
          { id: 'p1', bcVersion: '29.0.0.0', buildVersion: 'x', localization: 'dk', description: 'DK Business Central 29.0', platform: 'y', isEnabled: true },
          { id: 'p2', bcVersion: '29.0.0.0', localization: 'base', description: 'BASE', isEnabled: false },
        ]),
      },
    );
    const cli = createContiniaCli(testConfig(), exec);
    expect(await cli.listProfileVersions()).toEqual(['28.5.0.0', '29.0.0.0']);
    expect(await cli.listProfiles('29.0.0.0')).toEqual([
      { id: 'p1', bcVersion: '29.0.0.0', localization: 'dk', description: 'DK Business Central 29.0', isEnabled: true },
      { id: 'p2', bcVersion: '29.0.0.0', localization: 'base', description: 'BASE', isEnabled: false },
    ]);
    expect(exec.mock.calls[1]![0]).toContain('--bc-version');
  });
});

describe('waitForRunning', () => {
  function fakeCli(statuses: string[]): ContiniaCli & { startEnvironment: ReturnType<typeof mock> } {
    let i = 0;
    return {
      listProfileVersions: mock(async () => []),
      listProfiles: mock(async () => []),
      createEnvironment: mock(async () => 'e1'),
      startEnvironment: mock(async () => {}),
      getEnvironment: mock(async (): Promise<EnvInfo> => ({
        id: 'e1', name: 'n', url: 'u', status: statuses[Math.min(i++, statuses.length - 1)]!,
      })),
      installAppById: mock(async () => ({ installed: true, alreadyPresent: false })),
      listApps: mock(async () => []),
      getUsers: mock(async () => []),
    };
  }

  function clock() {
    let t = 0;
    return { sleep: mock(async (ms: number) => { t += ms; }), now: () => t };
  }

  test('starts a Draft environment once and returns when Running', async () => {
    const cli = fakeCli(['Draft', 'Starting', 'Starting', 'Running']);
    const env = await waitForRunning(cli, 'e1', 60_000, 1_000, clock());
    expect(env.status).toBe('Running');
    expect(cli.startEnvironment).toHaveBeenCalledTimes(1);
  });

  test('does not start an environment that is already starting', async () => {
    const cli = fakeCli(['Creating', 'Running']);
    await waitForRunning(cli, 'e1', 60_000, 1_000, clock());
    expect(cli.startEnvironment).not.toHaveBeenCalled();
  });

  test('throws on a failed status', async () => {
    const cli = fakeCli(['Failed']);
    await expect(waitForRunning(cli, 'e1', 60_000, 1_000, clock())).rejects.toThrow('status Failed');
  });

  test('throws after the timeout', async () => {
    const cli = fakeCli(['Creating']);
    await expect(waitForRunning(cli, 'e1', 5_000, 1_000, clock())).rejects.toThrow(
      'not Running after 0 min (last status Creating)',
    );
  });
});
