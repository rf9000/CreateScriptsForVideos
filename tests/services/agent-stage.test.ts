import { describe, test, expect, mock } from 'bun:test';
import { z } from 'zod';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { runAgentStage, agentEnv } from '../../src/services/agent-stage.ts';
import type { AgentStageDeps, QueryFn } from '../../src/services/agent-stage.ts';
import { testConfig } from '../helpers/config.ts';

const schema = z.object({ status: z.enum(['success', 'failed']), note: z.string() });

function success(structured: unknown, extra: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result', subtype: 'success', is_error: false, result: 'done',
    structured_output: structured, total_cost_usd: 1.25, num_turns: 7, errors: [], ...extra,
  } as unknown as SDKMessage;
}

function errorResult(subtype: string, errors: string[] = []): SDKMessage {
  return { type: 'result', subtype, is_error: true, total_cost_usd: 0.5, num_turns: 3, errors } as unknown as SDKMessage;
}

function deps(messages: SDKMessage[] | QueryFn) {
  const query = mock<QueryFn>(
    typeof messages === 'function'
      ? messages
      : async function* () {
          yield { type: 'assistant' } as unknown as SDKMessage;
          yield* messages;
        },
  );
  const readPrompt = mock((name: string) => `<${name}>`);
  return { query, readPrompt } satisfies AgentStageDeps;
}

describe('runAgentStage', () => {
  test('returns validated structured output and usage', async () => {
    const d = deps([success({ status: 'success', note: 'ok' })]);
    const run = await runAgentStage(testConfig(), 'generate', ['invariants', 'generate'], 'brief', schema, d);
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.output).toEqual({ status: 'success', note: 'ok' });
    expect(run.usage).toMatchObject({ stage: 'generate', model: 'gen-model', costUsd: 1.25, turns: 7 });
  });

  test('passes stage settings, preset prompt with appended stage prompts, and JSON schema', async () => {
    const config = testConfig();
    config.stages.validate = { model: 'v', effort: 'high', maxTurns: 9, maxBudgetUsd: 3, timeoutMinutes: 1 };
    const d = deps([success({ status: 'success', note: '' })]);
    await runAgentStage(config, 'validate', ['invariants', 'validate'], 'the prompt', schema, d);
    const { prompt, options } = d.query.mock.calls[0]![0] as { prompt: string; options: Options };
    expect(prompt).toBe('the prompt');
    expect(options.model).toBe('v');
    expect(options.effort).toBe('high');
    expect(options.maxTurns).toBe(9);
    expect(options.maxBudgetUsd).toBe(3);
    expect(options.systemPrompt).toEqual({
      type: 'preset', preset: 'claude_code', append: '<invariants>\n\n<validate>',
    });
    expect(options.outputFormat?.type).toBe('json_schema');
    expect(options.outputFormat?.schema).toMatchObject({ type: 'object', required: ['status', 'note'] });
    expect(options.settingSources).toEqual(['project']);
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(options).not.toHaveProperty('allowedTools');
  });

  test('the output schema carries no $schema draft marker (the CLI rejects draft 2020-12)', async () => {
    const d = deps([success({ status: 'success', note: '' })]);
    await runAgentStage(testConfig(), 'generate', ['g'], 'p', schema, d);
    const { options } = d.query.mock.calls[0]![0] as { options: Options };
    expect(options.outputFormat?.schema).not.toHaveProperty('$schema');
    expect(options.outputFormat?.schema).toMatchObject({ type: 'object' });
  });

  test('omits effort and budget when not configured', async () => {
    const d = deps([success({ status: 'success', note: '' })]);
    await runAgentStage(testConfig(), 'deploy', ['deploy'], 'p', schema, d);
    const { options } = d.query.mock.calls[0]![0] as { options: Options };
    expect(options).not.toHaveProperty('effort');
    expect(options).not.toHaveProperty('maxBudgetUsd');
  });

  test('loads the LSP plugin when configured', async () => {
    const d = deps([success({ status: 'success', note: '' })]);
    await runAgentStage(testConfig({ lspPluginPath: '/lsp' }), 'generate', ['g'], 'p', schema, d);
    const { options } = d.query.mock.calls[0]![0] as { options: Options };
    expect(options.plugins).toEqual([{ type: 'local', path: '/lsp' }]);
  });

  test('reports error subtypes with their messages', async () => {
    const d = deps([errorResult('error_max_budget_usd', ['budget hit'])]);
    const run = await runAgentStage(testConfig(), 'generate', ['g'], 'p', schema, d);
    expect(run).toMatchObject({ ok: false, error: 'generate stage ended with error_max_budget_usd: budget hit' });
    expect(run.usage.costUsd).toBe(0.5);
  });

  test('treats is_error on a success result as a failure', async () => {
    const d = deps([success(undefined, { is_error: true, result: 'API Error: overloaded' })]);
    const run = await runAgentStage(testConfig(), 'generate', ['g'], 'p', schema, d);
    expect(run).toMatchObject({ ok: false });
    if (!run.ok) expect(run.error).toContain('API Error: overloaded');
  });

  test('fails when structured output is missing or invalid', async () => {
    const missing = await runAgentStage(testConfig(), 'generate', ['g'], 'p', schema, deps([success(undefined)]));
    expect(missing).toMatchObject({ ok: false, error: 'generate stage returned no structured output' });

    const invalid = await runAgentStage(
      testConfig(), 'generate', ['g'], 'p', schema, deps([success({ status: 'maybe', note: 1 })]),
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toContain('failed validation');
  });

  test('turns a thrown stream into a failure', async () => {
    const d = deps(async function* () {
      throw new Error('spawn failed');
    });
    const run = await runAgentStage(testConfig(), 'generate', ['g'], 'p', schema, d);
    expect(run).toMatchObject({ ok: false, error: 'generate stage threw: spawn failed' });
  });

  test('aborts and reports a timeout', async () => {
    const config = testConfig();
    config.stages.generate.timeoutMinutes = 0.0005; // 30 ms
    const d = deps(({ options }: { options: Options }) =>
      (async function* () {
        await new Promise((_, reject) =>
          options.abortController!.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
        yield success({});
      })(),
    );
    const run = await runAgentStage(config, 'generate', ['g'], 'p', schema, d);
    expect(run).toMatchObject({ ok: false, error: 'generate stage timed out after 0.0005 min' });
  });
});

describe('agentEnv', () => {
  test('hides Azure DevOps variables and sets the continia token', () => {
    const env = agentEnv(testConfig({ anthropicApiKey: 'sk-1' }), {
      PATH: '/bin',
      AZURE_DEVOPS_PAT: 'secret',
      AZURE_DEVOPS_ORG: 'org',
    });
    expect(env).toEqual({ PATH: '/bin', CONTINIA_API_TOKEN: 'cont-token', ANTHROPIC_API_KEY: 'sk-1' });
  });

  test('leaves ANTHROPIC_API_KEY alone when none is configured', () => {
    const env = agentEnv(testConfig(), { ANTHROPIC_API_KEY: 'from-host' });
    expect(env['ANTHROPIC_API_KEY']).toBe('from-host');
  });
});
