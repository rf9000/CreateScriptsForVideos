import { describe, test, expect, mock } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { runPipeline, buildBrief, itemPaths, ACTIVATION_APP_ID } from '../../src/services/pipeline.ts';
import type { PipelineDeps, PipelineState, WorkItemContext } from '../../src/services/pipeline.ts';
import type { ContiniaCli } from '../../src/services/continia-cli.ts';
import type { QueryFn } from '../../src/services/agent-stage.ts';
import { testConfig } from '../helpers/config.ts';

const context: WorkItemContext = {
  itemId: 42,
  itemTitle: 'Demo merge rules',
  itemType: 'Product Backlog Item',
  itemDescription: 'Show how to create a merge rule.',
  comments: ['Use DK localization'],
};

const outputs: Record<string, unknown> = {
  generate: {
    status: 'success', feature: 'Merge Rules', needsBankingDemo: true,
    assumptions: ['happy path'], gaps: ['gen gap'],
  },
  validate: { status: 'passed', blockers: [], warnings: ['val warning'] },
  deploy: { status: 'success', gaps: [] },
};

/** Query fake that answers each stage from `byStage`, keyed by the stage prompt name. */
function stageQuery(byStage: Record<string, unknown>, cost = 1) {
  return mock<QueryFn>(({ options }) => {
    const append = (options.systemPrompt as { append: string }).append;
    const stage = ['generate', 'validate', 'deploy'].find((s) => append.includes(`<${s}>`))!;
    return (async function* () {
      yield {
        type: 'result', subtype: 'success', is_error: false, result: '',
        structured_output: byStage[stage], total_cost_usd: cost, num_turns: 2, errors: [],
      } as unknown as SDKMessage;
    })();
  });
}

function fakeCli(overrides: Partial<ContiniaCli> = {}): { [K in keyof ContiniaCli]: ReturnType<typeof mock> } {
  return {
    createEnvironment: mock(async () => 'env-1'),
    startEnvironment: mock(async () => {}),
    getEnvironment: mock(async () => ({ id: 'env-1', name: 'Demo #42', url: 'https://bc/env-1', status: 'Running' })),
    installAppById: mock(async () => ({ installed: true, alreadyPresent: false })),
    listApps: mock(async () => [{ name: 'Continia Demo Data - Merge Rules', publisher: 'P', version: '1' }]),
    getUsers: mock(async () => [{ username: 'ADMIN', password: 'pw' }]),
    ...overrides,
  } as { [K in keyof ContiniaCli]: ReturnType<typeof mock> };
}

function makeDeps(opts: { cli?: ReturnType<typeof fakeCli>; query?: ReturnType<typeof stageQuery>; saved?: PipelineState } = {}) {
  const store = new Map<string, PipelineState>();
  const cli = opts.cli ?? fakeCli();
  const query = opts.query ?? stageQuery(outputs);
  const deps = {
    stageDeps: { query, readPrompt: (name: string) => `<${name}>` },
    cli: () => cli as unknown as ContiniaCli,
    waitForRunning: mock(async () => ({ id: 'env-1', name: 'n', url: 'u', status: 'Running' })),
    loadState: mock(() => opts.saved),
    saveState: mock((path: string, state: PipelineState) => {
      store.set(path, structuredClone(state));
    }),
    clearState: mock(() => {}),
    fileExists: mock(() => true),
    readAppName: mock(() => 'Continia Demo Data - Merge Rules'),
  } satisfies PipelineDeps;
  return { deps, cli, query, store };
}

describe('buildBrief', () => {
  test('includes id, type, title, description and comments', () => {
    const brief = buildBrief(context);
    for (const part of ['#42', 'Product Backlog Item', 'Demo merge rules', 'Show how', 'Use DK localization']) {
      expect(brief).toContain(part);
    }
  });

  test('omits empty sections', () => {
    const brief = buildBrief({ ...context, itemDescription: '', comments: [] });
    expect(brief).not.toContain('## Description');
    expect(brief).not.toContain('## Comments');
  });
});

describe('runPipeline', () => {
  test('runs every step and returns success with env details and summed cost', async () => {
    const { deps, cli, query } = makeDeps();
    const result = await runPipeline(testConfig(), context, {}, deps);

    expect(result.status).toBe('success');
    expect(result.feature).toBe('Merge Rules');
    expect(result.env).toEqual({
      id: 'env-1', name: 'Demo #42', url: 'https://bc/env-1', username: 'ADMIN', password: 'pw',
    });
    expect(result.assumptions).toEqual(['happy path']);
    expect(result.gaps).toEqual(['gen gap', 'val warning']);
    expect(result.costUsd).toBe(3);
    expect(result.stages?.map((s) => s.stage)).toEqual(['generate', 'validate', 'deploy']);
    expect(result.scriptPath).toBe(itemPaths(testConfig(), 42).scriptPath);

    expect(query).toHaveBeenCalledTimes(3);
    expect(cli.createEnvironment).toHaveBeenCalledWith('Demo #42 Demo merge rules', 'profile-1');
    expect(cli.installAppById).toHaveBeenCalledWith('env-1', ACTIVATION_APP_ID);
    expect(deps.clearState).toHaveBeenCalled();
  });

  test('tells the deploy stage the env id and whether to publish banking-demo', async () => {
    const { deps, query } = makeDeps();
    await runPipeline(testConfig(), context, {}, deps);
    const deployPrompt = query.mock.calls[2]![0].prompt;
    expect(deployPrompt).toContain('Environment id: env-1');
    expect(deployPrompt).toContain('Publish banking-demo first: yes');
  });

  test('fails before spending anything when no profile is configured', async () => {
    const { deps, query } = makeDeps();
    const result = await runPipeline(testConfig({ envProfileId: '' }), context, {}, deps);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('CONTINIA_ENV_PROFILE_ID');
    expect(query).not.toHaveBeenCalled();
  });

  test('stops when generate fails and does not provision', async () => {
    const query = stageQuery({ ...outputs, generate: { ...(outputs.generate as object), status: 'failed', errorMessage: 'no such feature' } });
    const { deps, cli } = makeDeps({ query });
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect(result).toMatchObject({ status: 'failed', errorMessage: 'no such feature' });
    expect(cli.createEnvironment).not.toHaveBeenCalled();
  });

  test('fails when generate did not write the script', async () => {
    const { deps } = makeDeps();
    deps.fileExists.mockImplementation(() => false);
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect(result.errorMessage).toContain('recording script not written');
  });

  test('stops on validation blockers', async () => {
    const query = stageQuery({ ...outputs, validate: { status: 'blocked', blockers: ['missing bank account'], warnings: [] } });
    const { deps, cli } = makeDeps({ query });
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect(result.errorMessage).toBe('demo data validation blocked: missing bank account');
    expect(cli.createEnvironment).not.toHaveBeenCalled();
  });

  test('reports the running environment when activation fails', async () => {
    const cli = fakeCli({ installAppById: mock(async () => ({ installed: false, alreadyPresent: false, reasonCode: 'not-found' })) });
    const { deps } = makeDeps({ cli });
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect(result.errorMessage).toBe('activation app install failed (not-found)');
    expect(result.env?.id).toBe('env-1');
    expect(result.env?.password).toBe('pw');
  });

  test('reports the environment when deploy fails', async () => {
    const query = stageQuery({ ...outputs, deploy: { status: 'failed', gaps: [], errorMessage: 'AL0185' } });
    const { deps } = makeDeps({ query });
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect(result).toMatchObject({ status: 'failed', errorMessage: 'AL0185' });
    expect(result.env?.id).toBe('env-1');
  });

  test('fails when the PTE is not installed after deploy', async () => {
    const cli = fakeCli({ listApps: mock(async () => []) });
    const { deps } = makeDeps({ cli });
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect(result.errorMessage).toContain('"Continia Demo Data - Merge Rules" is not installed');
  });

  test('environment errors become failures with the env attached', async () => {
    const { deps } = makeDeps();
    deps.waitForRunning.mockImplementation(async () => {
      throw new Error('not Running after 15 min');
    });
    const result = await runPipeline(testConfig(), context, {}, deps);
    expect(result.errorMessage).toBe('environment setup failed: not Running after 15 min');
    expect(result.env?.id).toBe('env-1');
  });

  test('saved state never contains credentials', async () => {
    const { deps, store } = makeDeps();
    await runPipeline(testConfig(), context, {}, deps);
    const saved = JSON.stringify([...store.values()]);
    expect(saved).toContain('env-1');
    expect(saved).not.toContain('pw');
  });

  test('resume skips the steps already done', async () => {
    const saved: PipelineState = {
      generate: outputs.generate as PipelineState['generate'],
      validate: outputs.validate as PipelineState['validate'],
      envId: 'env-1',
      activated: true,
    };
    const { deps, cli, query } = makeDeps({ saved });
    const result = await runPipeline(testConfig(), context, { resume: true }, deps);
    expect(result.status).toBe('success');
    expect(query).toHaveBeenCalledTimes(1);
    expect(cli.createEnvironment).not.toHaveBeenCalled();
    expect(cli.installAppById).not.toHaveBeenCalled();
    expect(deps.clearState).not.toHaveBeenCalled();
  });
});
