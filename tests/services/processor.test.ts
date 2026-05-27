import { describe, test, expect, mock } from 'bun:test';
import type { AppConfig, WorkItemResponse, ScriptResult } from '../../src/types/index.ts';
import { processItem } from '../../src/services/processor.ts';
import type { ProcessorDeps } from '../../src/services/processor.ts';

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    wiqlQuery: 'q',
    pollIntervalMinutes: 5,
    claudeModel: 'claude-sonnet-4-6',
    promptPath: '.claude/commands/create-script.md',
    stateDir: '.state',
    dryRun: false,
    repoIds: [],
    createScriptTag: 'create script',
    continiaBankingPath: './continia-banking',
    workspaceOutputDir: './output',
    pteOutputDir: './output',
    lspPluginPath: '',
    agentMaxTurns: 120,
    maxProcessAttempts: 3,
    ...overrides,
  };
}

function mockWorkItem(overrides: Partial<WorkItemResponse> = {}): WorkItemResponse {
  return {
    id: 42,
    fields: {
      'System.Title': 'Demo merge rules',
      'System.WorkItemType': 'Product Backlog Item',
      'System.Description': 'Show how to create a merge rule.',
    },
    rev: 1,
    url: 'https://example.com/42',
    ...overrides,
  };
}

const successResult: ScriptResult = {
  status: 'success',
  feature: 'Merge Rules',
  scriptPath: '/work/output/42/script.md',
  ptePath: '/work/pte/42',
  env: {
    id: 'env-1',
    name: 'Demo Env',
    url: 'https://env.example.com',
    username: 'admin',
    password: 'p@ssw0rd',
  },
  costUsd: 0.5,
};

function makeDeps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    fetchComments: mock(async () => ['Use DK localization']),
    runOrchestrator: mock(async () => successResult),
    readScript: mock(() => '# Recording Script\n\nStep 1...'),
    uploadAttachment: mock(async () => ({ id: 'att-1', url: 'https://att/att-1' })),
    linkAttachment: mock(async () => ({}) as WorkItemResponse),
    addComment: mock(async () => {}),
    report: mock(() => {}),
    ...overrides,
  };
}

describe('processItem — success', () => {
  test('passes fetched comments into the orchestrator context', async () => {
    const deps = makeDeps();
    await processItem(mockConfig(), mockWorkItem(), deps);

    const call = (deps.runOrchestrator as ReturnType<typeof mock>).mock.calls[0]!;
    const context = call[1] as { comments: string[]; itemTitle: string };
    expect(context.comments).toEqual(['Use DK localization']);
    expect(context.itemTitle).toBe('Demo merge rules');
  });

  test('uploads the script file content as an attachment', async () => {
    const deps = makeDeps();
    await processItem(mockConfig(), mockWorkItem(), deps);

    expect(deps.readScript).toHaveBeenCalledWith('/work/output/42/script.md');
    const upload = (deps.uploadAttachment as ReturnType<typeof mock>).mock.calls[0]!;
    expect(upload[2]).toBe('# Recording Script\n\nStep 1...');
  });

  test('links the uploaded attachment to the work item', async () => {
    const deps = makeDeps();
    await processItem(mockConfig(), mockWorkItem(), deps);

    const link = (deps.linkAttachment as ReturnType<typeof mock>).mock.calls[0]!;
    expect(link[1]).toBe(42);
    expect(link[2]).toBe('https://att/att-1');
  });

  test('posts a comment with the env URL, username, password, and mentions the attachment', async () => {
    const deps = makeDeps();
    await processItem(mockConfig(), mockWorkItem(), deps);

    const comment = (deps.addComment as ReturnType<typeof mock>).mock.calls[0]![2] as string;
    expect(comment).toContain('https://env.example.com');
    expect(comment).toContain('admin');
    expect(comment).toContain('p@ssw0rd');
    expect(comment.toLowerCase()).toContain('attach');
  });

  test('returns processed: true and propagates the USD cost', async () => {
    const result = await processItem(mockConfig(), mockWorkItem(), makeDeps());
    expect(result.processed).toBe(true);
    expect(result.itemId).toBe(42);
    expect(result.costUsd).toBe(0.5);
  });
});

describe('processItem — failure', () => {
  const failDeps = () =>
    makeDeps({
      runOrchestrator: mock(
        async (): Promise<ScriptResult> => ({
          status: 'failed',
          errorMessage: 'environment would not start',
        }),
      ),
    });

  test('posts a comment with the error message', async () => {
    const deps = failDeps();
    await processItem(mockConfig(), mockWorkItem(), deps);

    const comment = (deps.addComment as ReturnType<typeof mock>).mock.calls[0]![2] as string;
    expect(comment).toContain('environment would not start');
  });

  test('does not upload or link an attachment', async () => {
    const deps = failDeps();
    await processItem(mockConfig(), mockWorkItem(), deps);

    expect(deps.uploadAttachment).not.toHaveBeenCalled();
    expect(deps.linkAttachment).not.toHaveBeenCalled();
  });

  test('returns processed: false with the error', async () => {
    const result = await processItem(mockConfig(), mockWorkItem(), failDeps());
    expect(result.processed).toBe(false);
    expect(result.error).toContain('environment would not start');
  });
});

describe('processItem — dry run', () => {
  test('performs no ADO writes', async () => {
    const deps = makeDeps();
    const result = await processItem(mockConfig({ dryRun: true }), mockWorkItem(), deps);

    expect(deps.uploadAttachment).not.toHaveBeenCalled();
    expect(deps.linkAttachment).not.toHaveBeenCalled();
    expect(deps.addComment).not.toHaveBeenCalled();
    expect(result.processed).toBe(true);
    expect(result.costUsd).toBe(0.5);
  });

  test('prints the generated script and env details to the terminal', async () => {
    const deps = makeDeps();
    await processItem(mockConfig({ dryRun: true }), mockWorkItem(), deps);

    const reported = (deps.report as ReturnType<typeof mock>).mock.calls
      .map((c) => c[0] as string)
      .join('\n');
    expect(reported).toContain('# Recording Script');
    expect(reported).toContain('https://env.example.com');
    expect(reported).toContain('admin');
  });
});
