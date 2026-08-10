import { describe, test, expect } from 'bun:test';
import type { AppConfig } from '../../src/types/index.ts';
import {
  buildOrchestratorPrompt,
  parseResult,
  runOrchestrator,
} from '../../src/services/orchestrator-agent.ts';
import type {
  OrchestratorContext,
  AgentMessage,
} from '../../src/services/orchestrator-agent.ts';

function mockConfig(): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    wiqlQuery: 'q',
    pollIntervalMinutes: 5,
    claudeModel: 'claude-sonnet-4-6',
    promptPath: '.claude/commands/create-script.md',
    dryRun: false,
    areaPath: '',
    createScriptTag: 'create script',
    continiaBankingPath: '/repos/banking',
    continiaApiToken: '',
    anthropicApiKey: '',
    workspaceOutputDir: '/work/output',
    pteOutputDir: '/work/pte',
    lspPluginPath: '/plugins/lsp',
    agentMaxTurns: 120,
    outputRetentionDays: 14,
  };
}

const baseContext: OrchestratorContext = {
  itemId: 42,
  itemTitle: 'Demo merge rules',
  itemType: 'Product Backlog Item',
  itemDescription: 'Show how to create a new merge rule.',
  comments: ['Focus on the DK localization', 'Use realistic IBANs'],
};

describe('buildOrchestratorPrompt', () => {
  test('includes the work item id, title, type, and description', () => {
    const prompt = buildOrchestratorPrompt(baseContext);
    expect(prompt).toContain('42');
    expect(prompt).toContain('Demo merge rules');
    expect(prompt).toContain('Product Backlog Item');
    expect(prompt).toContain('Show how to create a new merge rule.');
  });

  test('includes each comment', () => {
    const prompt = buildOrchestratorPrompt(baseContext);
    expect(prompt).toContain('Focus on the DK localization');
    expect(prompt).toContain('Use realistic IBANs');
  });

  test('omits the comments section when there are none', () => {
    const prompt = buildOrchestratorPrompt({ ...baseContext, comments: [] });
    expect(prompt).not.toContain('## Comments');
  });
});

describe('parseResult', () => {
  const success = {
    status: 'success',
    feature: 'Merge Rules',
    scriptPath: '/work/output/42/script.md',
    ptePath: '/work/pte/42',
    env: {
      id: 'env-1',
      name: 'Demo Env',
      url: 'https://env.example.com',
      username: 'admin',
      password: 'p@ss',
    },
    assumptions: ['happy path'],
    gaps: [],
  };

  test('parses a raw JSON success object', () => {
    const result = parseResult(JSON.stringify(success));
    expect(result.status).toBe('success');
    expect(result.feature).toBe('Merge Rules');
    expect(result.env?.url).toBe('https://env.example.com');
    expect(result.scriptPath).toBe('/work/output/42/script.md');
  });

  test('parses JSON inside a fenced code block with surrounding prose', () => {
    const raw = `All done! Here is the result:\n\n\`\`\`json\n${JSON.stringify(success)}\n\`\`\`\n\nThanks.`;
    const result = parseResult(raw);
    expect(result.status).toBe('success');
    expect(result.feature).toBe('Merge Rules');
  });

  test('parses a failed result and keeps the error message', () => {
    const raw = JSON.stringify({ status: 'failed', errorMessage: 'env would not start' });
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('env would not start');
  });

  test('returns a failed result when no JSON can be parsed', () => {
    const result = parseResult('I could not finish the task.');
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBeTruthy();
  });
});

describe('parseResult — schema validation', () => {
  const validEnv = {
    id: 'env-1', name: 'Demo', url: 'https://e.example.com',
    username: 'admin', password: 'pw',
  };

  test('accepts a fully-formed success', () => {
    const raw = '```json\n' + JSON.stringify({
      status: 'success', feature: 'Merge Rules',
      scriptPath: '/out/42/script.md', ptePath: '/out/42/pte',
      env: validEnv, assumptions: [], gaps: [],
    }) + '\n```';
    expect(parseResult(raw).status).toBe('success');
  });

  test('rejects success without env', () => {
    const raw = '```json\n' + JSON.stringify({
      status: 'success', scriptPath: '/out/42/script.md',
    }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('schema validation');
    expect(result.errorMessage).toContain('env');
  });

  test('rejects success without scriptPath', () => {
    const raw = '```json\n' + JSON.stringify({ status: 'success', env: validEnv }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('scriptPath');
  });

  test('salvages a valid env from a schema-invalid success', () => {
    const raw = '```json\n' + JSON.stringify({ status: 'success', env: validEnv }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.env).toEqual(validEnv);
  });

  test('rejects failed without errorMessage', () => {
    const raw = '```json\n' + JSON.stringify({ status: 'failed' }) + '\n```';
    const result = parseResult(raw);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('schema validation');
  });
});

describe('runOrchestrator', () => {
  function fakeQuery(messages: AgentMessage[]) {
    return () =>
      (async function* () {
        for (const m of messages) yield m;
      })();
  }

  test('returns the parsed result from the final success message', async () => {
    const payload = JSON.stringify({
      status: 'success',
      feature: 'Merge Rules',
      scriptPath: '/work/output/42/script.md',
      env: {
        id: 'env-1',
        name: 'Demo Env',
        url: 'https://env.example.com',
        username: 'admin',
        password: 'p@ss',
      },
    });
    const messages: AgentMessage[] = [
      { type: 'assistant' } as AgentMessage,
      {
        type: 'result',
        subtype: 'success',
        result: payload,
        total_cost_usd: 0.12,
        num_turns: 9,
        usage: { input_tokens: 1000, output_tokens: 500 },
      } as AgentMessage,
    ];

    const result = await runOrchestrator(mockConfig(), baseContext, {
      query: fakeQuery(messages),
    });

    expect(result.status).toBe('success');
    expect(result.feature).toBe('Merge Rules');
  });

  test('attaches the USD cost from the result message', async () => {
    const messages: AgentMessage[] = [
      {
        type: 'result',
        subtype: 'success',
        result: '{"status":"success"}',
        total_cost_usd: 0.37,
      } as AgentMessage,
    ];

    const result = await runOrchestrator(mockConfig(), baseContext, {
      query: fakeQuery(messages),
    });

    expect(result.costUsd).toBe(0.37);
  });

  test('returns a failed result when the SDK reports a non-success subtype', async () => {
    const messages: AgentMessage[] = [
      { type: 'result', subtype: 'error_max_turns', num_turns: 120 } as AgentMessage,
    ];

    const result = await runOrchestrator(mockConfig(), baseContext, {
      query: fakeQuery(messages),
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('error_max_turns');
  });

  test('passes the orchestration options to the query function', async () => {
    let captured: { prompt: string; options: Record<string, unknown> } | undefined;
    const query = (params: { prompt: string; options: Record<string, unknown> }) => {
      captured = params;
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: '{"status":"success"}',
        } as AgentMessage;
      })();
    };

    await runOrchestrator(mockConfig(), baseContext, { query });

    expect(captured).toBeDefined();
    expect(captured!.options.settingSources).toEqual(['project']);
    expect(captured!.options.maxTurns).toBe(120);
    expect(captured!.options.additionalDirectories).toContain('/repos/banking');
    expect(captured!.options.permissionMode).toBe('bypassPermissions');
    // banking clone is exposed read-only; tools must be granted for an agentic loop
    expect(Array.isArray(captured!.options.allowedTools)).toBe(true);
  });

  test('exposes the continia API token to the agent subprocess env', async () => {
    let captured: { options: Record<string, unknown> } | undefined;
    const query = (params: { prompt: string; options: Record<string, unknown> }) => {
      captured = params;
      return (async function* () {
        yield { type: 'result', subtype: 'success', result: '{"status":"success"}' } as AgentMessage;
      })();
    };
    const config = { ...mockConfig(), continiaApiToken: 'tok-xyz' };

    await runOrchestrator(config, baseContext, { query });

    const env = captured!.options.env as Record<string, string>;
    expect(env.CONTINIA_API_TOKEN).toBe('tok-xyz');
  });

  test('forwards ANTHROPIC_API_KEY to the agent env when configured', async () => {
    let captured: { options: Record<string, unknown> } | undefined;
    const query = (params: { prompt: string; options: Record<string, unknown> }) => {
      captured = params;
      return (async function* () {
        yield { type: 'result', subtype: 'success', result: '{"status":"success"}' } as AgentMessage;
      })();
    };
    const config = { ...mockConfig(), anthropicApiKey: 'sk-ant-test' };

    await runOrchestrator(config, baseContext, { query });

    const env = captured!.options.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
  });

  test('does not set ANTHROPIC_API_KEY when not configured (uses OAuth)', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      let captured: { options: Record<string, unknown> } | undefined;
      const query = (params: { prompt: string; options: Record<string, unknown> }) => {
        captured = params;
        return (async function* () {
          yield { type: 'result', subtype: 'success', result: '{"status":"success"}' } as AgentMessage;
        })();
      };

      await runOrchestrator(mockConfig(), baseContext, { query });

      const env = captured!.options.env as Record<string, string>;
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
