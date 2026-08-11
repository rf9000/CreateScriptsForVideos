import { describe, test, expect, afterEach, mock } from 'bun:test';
import type { AppConfig } from '../../src/types/index.ts';
import {
  AzureDevOpsError,
  adoFetch,
  adoFetchWithRetry,
  queryWorkItems,
  queryTaggedWorkItems,
  getWorkItem,
  getWorkItemsBatch,
  updateWorkItemField,
  getWorkItemComments,
  addWorkItemComment,
  removeTagFromWorkItem,
  uploadAttachment,
  linkAttachment,
} from '../../src/sdk/azure-devops-client.ts';

const originalFetch = globalThis.fetch;
let mockFn: ReturnType<typeof mock>;

function mockConfig(): AppConfig {
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
    watchConcurrency: 1,
  };
}

function setMockFetch(body: unknown, status = 200, statusText = 'OK') {
  mockFn = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        statusText,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  globalThis.fetch = mockFn as unknown as typeof fetch;
}

function setSequentialMockFetch(
  ...responses: Array<{ body: unknown; status?: number }>
) {
  let callIndex = 0;
  mockFn = mock(() => {
    const r = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        statusText: r.status && r.status >= 400 ? 'Error' : 'OK',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  globalThis.fetch = mockFn as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('adoFetch', () => {
  test('builds the correct URL and auth header', async () => {
    setMockFetch({ hello: 'world' });
    const config = mockConfig();

    const result = await adoFetch<{ hello: string }>(config, 'some/path');

    expect(result).toEqual({ hello: 'world' });
    expect(mockFn).toHaveBeenCalledTimes(1);

    const call = mockFn.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;

    expect(url).toBe(
      'https://dev.azure.com/my-org/my-project/_apis/some/path',
    );

    const headers = init.headers as Record<string, string>;
    const expectedAuth =
      'Basic ' + Buffer.from(':test-pat-token').toString('base64');
    expect(headers['Authorization']).toBe(expectedAuth);
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('throws AzureDevOpsError on non-ok response', async () => {
    setMockFetch({ message: 'Not Found' }, 404, 'Not Found');
    const config = mockConfig();

    try {
      await adoFetch(config, 'missing/resource');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      const adoErr = err as AzureDevOpsError;
      expect(adoErr.statusCode).toBe(404);
      expect(adoErr.name).toBe('AzureDevOpsError');
    }
  });
});

describe('adoFetchWithRetry', () => {
  test('retries on 500 and eventually succeeds', async () => {
    setSequentialMockFetch(
      { body: { error: 'Internal Server Error' }, status: 500 },
      { body: { ok: true }, status: 200 },
    );
    const config = mockConfig();

    const result = await adoFetchWithRetry<{ ok: boolean }>(
      config,
      'test/path',
      undefined,
      [0, 0, 0],
    );

    expect(result).toEqual({ ok: true });
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  test('does not retry on 404', async () => {
    setSequentialMockFetch(
      { body: { error: 'Not Found' }, status: 404 },
      { body: { ok: true }, status: 200 },
    );
    const config = mockConfig();

    try {
      await adoFetchWithRetry(config, 'test/path', undefined, [0, 0, 0]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(404);
    }

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test('throws after exhausting retries on 500', async () => {
    setSequentialMockFetch(
      { body: { error: 'fail' }, status: 500 },
      { body: { error: 'fail' }, status: 500 },
      { body: { error: 'fail' }, status: 500 },
      { body: { error: 'fail' }, status: 500 },
    );
    const config = mockConfig();

    try {
      await adoFetchWithRetry(config, 'test/path', undefined, [0, 0, 0]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(500);
    }

    expect(mockFn).toHaveBeenCalledTimes(4);
  });
});

describe('retry policy', () => {
  test('adoFetch exposes Retry-After as retryAfterMs', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '7' },
        }),
      ),
    ) as unknown as typeof fetch;
    try {
      await adoFetch(mockConfig(), 'wit/anything?api-version=7.0');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(429);
      expect((err as AzureDevOpsError).retryAfterMs).toBe(7000);
    }
  });

  test('adoFetchWithRetry retries 429 and succeeds', async () => {
    setSequentialMockFetch(
      { body: 'throttled', status: 429 },
      { body: { ok: true } },
    );
    const result = await adoFetchWithRetry<{ ok: boolean }>(
      mockConfig(), 'wit/x?api-version=7.0', undefined, [1],
    );
    expect(result.ok).toBe(true);
    expect(mockFn.mock.calls.length).toBe(2);
  });

  test('non-idempotent calls do NOT retry 5xx', async () => {
    setSequentialMockFetch({ body: 'boom', status: 503 }, { body: { ok: true } });
    await expect(
      adoFetchWithRetry(mockConfig(), 'wit/x?api-version=7.0', { method: 'POST' }, [1], false),
    ).rejects.toThrow('503');
    expect(mockFn.mock.calls.length).toBe(1);
  });

  test('non-idempotent calls still retry 429', async () => {
    setSequentialMockFetch({ body: 'throttled', status: 429 }, { body: { ok: true } });
    const result = await adoFetchWithRetry<{ ok: boolean }>(
      mockConfig(), 'wit/x?api-version=7.0', { method: 'POST' }, [1], false,
    );
    expect(result.ok).toBe(true);
    expect(mockFn.mock.calls.length).toBe(2);
  });

  test('non-idempotent calls do not retry network errors', async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls++;
      return Promise.reject(new Error('socket hang up'));
    }) as unknown as typeof fetch;
    await expect(
      adoFetchWithRetry(mockConfig(), 'wit/x?api-version=7.0', { method: 'POST' }, [1], false),
    ).rejects.toThrow('socket hang up');
    expect(calls).toBe(1);
  });
});

describe('queryWorkItems', () => {
  test('posts WIQL query and returns work item IDs', async () => {
    setMockFetch({
      workItems: [
        { id: 1, url: 'https://example.com/1' },
        { id: 2, url: 'https://example.com/2' },
      ],
    });
    const config = mockConfig();

    const result = await queryWorkItems(config, "SELECT [System.Id] FROM workitems WHERE [System.State] = 'New'");

    expect(result).toEqual([1, 2]);
    const call = mockFn.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toContain('wit/wiql?api-version=7.0');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { query: string };
    expect(body.query).toBe("SELECT [System.Id] FROM workitems WHERE [System.State] = 'New'");
  });

  test('returns empty array when no work items match', async () => {
    setMockFetch({ workItems: [] });
    const config = mockConfig();

    const result = await queryWorkItems(config, "SELECT [System.Id] FROM workitems WHERE 1=0");
    expect(result).toEqual([]);
  });
});

describe('getWorkItem', () => {
  test('builds correct URL and returns work item directly', async () => {
    const workItem = {
      id: 100,
      fields: { 'System.Title': 'Some work item' },
      rev: 3,
      url: 'https://example.com/100',
    };
    setMockFetch(workItem);
    const config = mockConfig();

    const result = await getWorkItem(config, 100);

    expect(result).toEqual(workItem);
    const url = mockFn.mock.calls[0]![0] as string;
    expect(url).toContain('wit/workitems/100');
    expect(url).toContain('$expand=all');
    expect(url).toContain('api-version=7.0');
  });
});

describe('getWorkItemsBatch', () => {
  test('fetches multiple work items and returns them', async () => {
    const items = [
      { id: 1, fields: { 'System.Title': 'Item 1' }, rev: 1, url: 'https://example.com/1' },
      { id: 2, fields: { 'System.Title': 'Item 2' }, rev: 1, url: 'https://example.com/2' },
    ];
    setMockFetch({ value: items });
    const config = mockConfig();

    const result = await getWorkItemsBatch(config, [1, 2]);

    expect(result).toEqual(items);
    const url = mockFn.mock.calls[0]![0] as string;
    expect(url).toContain('wit/workitems?ids=1,2');
    expect(url).toContain('$expand=all');
    expect(url).toContain('api-version=7.0');
  });

  test('returns empty array for empty input', async () => {
    const config = mockConfig();
    const result = await getWorkItemsBatch(config, []);
    expect(result).toEqual([]);
  });
});

describe('updateWorkItemField', () => {
  test('sends PATCH with json-patch body and correct content-type', async () => {
    const updated = {
      id: 100,
      fields: { 'Custom.Field': 'New value' },
      rev: 4,
      url: 'https://example.com/100',
    };
    setMockFetch(updated);
    const config = mockConfig();

    const result = await updateWorkItemField(
      config,
      100,
      'Custom.Field',
      'New value',
    );

    expect(result).toEqual(updated);

    const call = mockFn.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;

    expect(url).toContain('wit/workitems/100');
    expect(url).toContain('api-version=7.0');
    expect(init.method).toBe('PATCH');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json-patch+json');

    const body = JSON.parse(init.body as string) as Array<{
      op: string;
      path: string;
      value: string;
    }>;
    expect(body).toEqual([
      { op: 'add', path: '/fields/Custom.Field', value: 'New value' },
    ]);
  });
});

describe('queryTaggedWorkItems', () => {
  test('returns full items for exact tag matches using exactly two requests', async () => {
    setSequentialMockFetch(
      { body: { workItems: [{ id: 1, url: 'u1' }, { id: 2, url: 'u2' }] } },
      {
        body: {
          value: [
            {
              id: 1, rev: 3, url: 'u1',
              fields: {
                'System.Tags': 'create script; other',
                'System.Title': 'Item one',
                'System.Description': '<p>desc</p>',
                'System.WorkItemType': 'Product Backlog Item',
              },
            },
            {
              id: 2, rev: 1, url: 'u2',
              fields: { 'System.Tags': 'create scripts', 'System.Title': 'Item two' },
            },
          ],
        },
      },
    );
    const items = await queryTaggedWorkItems(mockConfig());
    expect(items.map((i) => i.id)).toEqual([1]);
    expect(items[0]!.fields['System.Title']).toBe('Item one');
    expect(mockFn.mock.calls.length).toBe(2);
    const batchUrl = String(mockFn.mock.calls[1]![0]);
    expect(batchUrl).toContain('System.Title');
    expect(batchUrl).not.toContain('$expand');
  });

  test('returns empty without a batch call when WIQL finds nothing', async () => {
    setMockFetch({ workItems: [] });
    const items = await queryTaggedWorkItems(mockConfig());
    expect(items).toEqual([]);
    expect(mockFn.mock.calls.length).toBe(1);
  });

  test('narrows via WIQL (no TeamProject clause) using a CONTAINS clause', async () => {
    setSequentialMockFetch(
      { body: { workItems: [{ id: 7, url: 'u7' }, { id: 8, url: 'u8' }] } },
      {
        body: {
          value: [
            { id: 7, rev: 1, url: 'u7', fields: { 'System.Tags': 'create script; other' } },
            { id: 8, rev: 1, url: 'u8', fields: { 'System.Tags': 'create scripts' } }, // substring-only
          ],
        },
      },
    );
    const config = mockConfig();

    const result = await queryTaggedWorkItems(config);

    // #8 is dropped: CONTAINS matched the substring, but exact match rejects it.
    expect(result.map((i) => i.id)).toEqual([7]);
    const wiqlInit = mockFn.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(wiqlInit.body as string) as { query: string };
    expect(body.query).not.toContain('System.TeamProject');
    expect(body.query).toContain("[System.Tags] CONTAINS 'create script'");
  });

  test('adds an AreaPath UNDER clause when areaPath is set', async () => {
    setSequentialMockFetch(
      { body: { workItems: [{ id: 7, url: 'u7' }] } },
      { body: { value: [{ id: 7, rev: 1, url: 'u7', fields: { 'System.Tags': 'create script' } }] } },
    );
    const config = { ...mockConfig(), areaPath: 'Continia Software\\Continia Banking' };

    await queryTaggedWorkItems(config);

    const body = JSON.parse(
      (mockFn.mock.calls[0]![1] as RequestInit).body as string,
    ) as { query: string };
    expect(body.query).toContain(
      "[System.AreaPath] UNDER 'Continia Software\\Continia Banking'",
    );
  });

  test('omits the AreaPath clause when areaPath is empty', async () => {
    setSequentialMockFetch(
      { body: { workItems: [{ id: 7, url: 'u7' }] } },
      { body: { value: [{ id: 7, rev: 1, url: 'u7', fields: { 'System.Tags': 'create script' } }] } },
    );

    await queryTaggedWorkItems(mockConfig());

    const body = JSON.parse(
      (mockFn.mock.calls[0]![1] as RequestInit).body as string,
    ) as { query: string };
    expect(body.query).not.toContain('System.AreaPath');
  });

  test('chunks batch fetches at 200 ids', async () => {
    const candidateIds = Array.from({ length: 250 }, (_, i) => i + 1);
    const firstChunk = candidateIds.slice(0, 200);
    const secondChunk = candidateIds.slice(200);
    setSequentialMockFetch(
      { body: { workItems: candidateIds.map((id) => ({ id, url: `u${id}` })) } },
      {
        body: {
          value: firstChunk.map((id) => ({
            id, rev: 1, url: `u${id}`, fields: { 'System.Tags': 'create script' },
          })),
        },
      },
      {
        body: {
          value: secondChunk.map((id) => ({
            id, rev: 1, url: `u${id}`, fields: { 'System.Tags': 'create script' },
          })),
        },
      },
    );

    const result = await queryTaggedWorkItems(mockConfig());

    expect(result.length).toBe(250);
    expect(mockFn.mock.calls.length).toBe(3); // WIQL + 2 batch chunks
    const firstBatchUrl = String(mockFn.mock.calls[1]![0]);
    const secondBatchUrl = String(mockFn.mock.calls[2]![0]);
    expect(firstBatchUrl).toContain(`ids=${firstChunk.join(',')}`);
    expect(secondBatchUrl).toContain(`ids=${secondChunk.join(',')}`);
  });
});

describe('removeTagFromWorkItem', () => {
  test('removes the tag (case-insensitive) via a replace patch', async () => {
    setSequentialMockFetch(
      { body: { id: 42, fields: { 'System.Tags': 'Create Script; demo; other' }, rev: 1, url: 'u' } },
      { body: { id: 42, fields: {}, rev: 2, url: 'u' } },
    );

    await removeTagFromWorkItem(mockConfig(), 42, 'create script');

    const patchInit = mockFn.mock.calls[1]![1] as RequestInit;
    expect(patchInit.method).toBe('PATCH');
    const ops = JSON.parse(patchInit.body as string) as Array<{
      op: string;
      path: string;
      value: string;
    }>;
    expect(ops[1]!.op).toBe('replace');
    expect(ops[1]!.path).toBe('/fields/System.Tags');
    expect(ops[1]!.value).toBe('demo; other');
  });

  test('guards the tags rewrite with a rev test op', async () => {
    setSequentialMockFetch(
      { body: { id: 1, rev: 7, url: 'u', fields: { 'System.Tags': 'create script; keep' } } },
      { body: { id: 1, rev: 8, url: 'u', fields: {} } },
    );
    await removeTagFromWorkItem(mockConfig(), 1, 'create script');
    const patchInit = mockFn.mock.calls[1]![1] as RequestInit;
    const ops = JSON.parse(String(patchInit.body)) as Array<Record<string, unknown>>;
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 7 });
    expect(ops[1]).toEqual({ op: 'replace', path: '/fields/System.Tags', value: 'keep' });
    const getUrl = String(mockFn.mock.calls[0]![0]);
    expect(getUrl).toContain('fields=System.Tags');
    expect(getUrl).not.toContain('$expand');
  });

  test('re-reads and retries once when the rev test fails', async () => {
    setSequentialMockFetch(
      { body: { id: 1, rev: 7, url: 'u', fields: { 'System.Tags': 'create script' } } },
      { body: 'rev mismatch', status: 409 },
      { body: { id: 1, rev: 9, url: 'u', fields: { 'System.Tags': 'create script; new-tag' } } },
      { body: { id: 1, rev: 10, url: 'u', fields: {} } },
    );
    await removeTagFromWorkItem(mockConfig(), 1, 'create script');
    expect(mockFn.mock.calls.length).toBe(4);
    const secondPatch = JSON.parse(
      String((mockFn.mock.calls[3]![1] as RequestInit).body),
    ) as Array<Record<string, unknown>>;
    expect(secondPatch[0]).toEqual({ op: 'test', path: '/rev', value: 9 });
    expect(secondPatch[1]!['value']).toBe('new-tag');
  });
});

describe('getWorkItemComments', () => {
  test('returns comment texts and uses the comments endpoint', async () => {
    setMockFetch({
      totalCount: 2,
      count: 2,
      comments: [
        { id: 1, text: 'first comment' },
        { id: 2, text: 'second comment' },
      ],
    });
    const config = mockConfig();

    const result = await getWorkItemComments(config, 100);

    expect(result).toEqual(['first comment', 'second comment']);
    const url = mockFn.mock.calls[0]![0] as string;
    expect(url).toContain('wit/workItems/100/comments');
  });

  test('returns empty array when there are no comments', async () => {
    setMockFetch({ totalCount: 0, count: 0, comments: [] });
    const result = await getWorkItemComments(mockConfig(), 100);
    expect(result).toEqual([]);
  });
});

describe('addWorkItemComment', () => {
  test('POSTs the comment text to the comments endpoint', async () => {
    setMockFetch({ id: 5, text: 'hello' });
    const config = mockConfig();

    await addWorkItemComment(config, 100, 'hello');

    const call = mockFn.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toContain('wit/workItems/100/comments');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toBe('hello');
  });
});

describe('uploadAttachment', () => {
  test('POSTs raw content to the attachments endpoint and returns id+url', async () => {
    setMockFetch({ id: 'abc-123', url: 'https://dev.azure.com/att/abc-123' });
    const config = mockConfig();

    const result = await uploadAttachment(config, 'script.md', '# Recording Script');

    expect(result).toEqual({ id: 'abc-123', url: 'https://dev.azure.com/att/abc-123' });
    const call = mockFn.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toContain('wit/attachments?fileName=script.md');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('# Recording Script');
  });
});

describe('linkAttachment', () => {
  test('PATCHes an AttachedFile relation with a comment', async () => {
    setMockFetch({ id: 100, fields: {}, rev: 5, url: 'u' });
    const config = mockConfig();

    await linkAttachment(config, 100, 'https://dev.azure.com/att/abc-123', 'Recording script');

    const call = mockFn.mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json-patch+json');
    const body = JSON.parse(init.body as string) as Array<{
      op: string;
      path: string;
      value: { rel: string; url: string; attributes: { comment: string } };
    }>;
    expect(body[0]!.op).toBe('add');
    expect(body[0]!.path).toBe('/relations/-');
    expect(body[0]!.value.rel).toBe('AttachedFile');
    expect(body[0]!.value.url).toBe('https://dev.azure.com/att/abc-123');
    expect(body[0]!.value.attributes.comment).toBe('Recording script');
  });
});

describe('error handling', () => {
  test('404 throws AzureDevOpsError with statusCode', async () => {
    setMockFetch({ message: 'Resource not found' }, 404, 'Not Found');
    const config = mockConfig();

    try {
      await queryWorkItems(config, 'invalid');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      const adoErr = err as AzureDevOpsError;
      expect(adoErr.statusCode).toBe(404);
      expect(adoErr.name).toBe('AzureDevOpsError');
      expect(adoErr.message).toContain('404');
    }
  });
});
