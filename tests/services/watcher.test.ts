import { describe, test, expect, mock } from 'bun:test';
import type { AppConfig, WorkItemResponse } from '../../src/types/index.ts';
import { runPollCycle } from '../../src/services/watcher.ts';
import type { WatcherDeps } from '../../src/services/watcher.ts';

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    wiqlQuery: "SELECT [System.Id] FROM workitems WHERE [System.State] = 'New'",
    pollIntervalMinutes: 5,
    claudeModel: 'claude-sonnet-4-6',
    promptPath: './prompt.md',
    dryRun: false,
    areaPath: '',
    createScriptTag: 'create script',
    continiaBankingPath: './continia-banking',
    continiaApiToken: '',
    anthropicApiKey: '',
    workspaceOutputDir: './output',
    pteOutputDir: './output',
    lspPluginPath: '',
    agentMaxTurns: 120,
    outputRetentionDays: 14,
    ...overrides,
  };
}

function mockWorkItem(overrides: Partial<WorkItemResponse> = {}): WorkItemResponse {
  return {
    id: 42,
    fields: {
      'System.Title': 'Test work item',
      'System.WorkItemType': 'Bug',
      'System.Description': 'A test work item.',
    },
    rev: 1,
    url: 'https://example.com/42',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
  return {
    fetchItems: mock(() => Promise.resolve([])),
    processItem: mock(() => Promise.resolve({ itemId: 0, processed: true })),
    ...overrides,
  };
}

describe('runPollCycle', () => {
  test('no items returns all zeros', async () => {
    const deps = makeDeps();

    const result = await runPollCycle(mockConfig(), deps);

    expect(result).toEqual({ processed: 0, errors: 0, costUsd: 0 });
    expect(deps.fetchItems).toHaveBeenCalledTimes(1);
    expect(deps.processItem).toHaveBeenCalledTimes(0);
  });

  test('processes each fetched (tagged) item', async () => {
    const items = [mockWorkItem({ id: 501 }), mockWorkItem({ id: 502 })];
    const deps = makeDeps({
      fetchItems: mock(() => Promise.resolve(items)),
      processItem: mock((_cfg: AppConfig, item: WorkItemResponse) =>
        Promise.resolve({ itemId: item.id, processed: true }),
      ),
    });

    const result = await runPollCycle(mockConfig(), deps);

    expect(result).toEqual({ processed: 2, errors: 0, costUsd: 0 });
    expect(deps.processItem).toHaveBeenCalledTimes(2);
  });

  test('a processItem rejection is counted as an error, not fatal to the cycle', async () => {
    const items = [mockWorkItem({ id: 300 }), mockWorkItem({ id: 301 })];
    const deps = makeDeps({
      fetchItems: mock(() => Promise.resolve(items)),
      processItem: mock((_cfg: AppConfig, item: WorkItemResponse) =>
        item.id === 300
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ itemId: item.id, processed: true }),
      ),
    });

    const result = await runPollCycle(mockConfig(), deps);

    // 301 still processed despite 300 throwing.
    expect(result).toEqual({ processed: 1, errors: 1, costUsd: 0 });
  });

  test('a failed (processed: false) result counts as an error', async () => {
    const deps = makeDeps({
      fetchItems: mock(() => Promise.resolve([mockWorkItem({ id: 400 })])),
      processItem: mock(() =>
        Promise.resolve({ itemId: 400, processed: false, error: 'AI failed' }),
      ),
    });

    const result = await runPollCycle(mockConfig(), deps);

    expect(result).toEqual({ processed: 0, errors: 1, costUsd: 0 });
  });

  test('aggregates the USD cost across items', async () => {
    const items = [mockWorkItem({ id: 701 }), mockWorkItem({ id: 702 })];
    const deps = makeDeps({
      fetchItems: mock(() => Promise.resolve(items)),
      processItem: mock((_cfg: AppConfig, item: WorkItemResponse) =>
        Promise.resolve({ itemId: item.id, processed: true, costUsd: 0.25 }),
      ),
    });

    const result = await runPollCycle(mockConfig(), deps);

    expect(result.costUsd).toBeCloseTo(0.5, 5);
  });
});
