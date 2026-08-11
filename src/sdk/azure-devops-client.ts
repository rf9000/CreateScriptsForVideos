import type {
  AppConfig,
  WorkItemResponse,
  WiqlQueryResult,
} from '../types/index.ts';

export class AzureDevOpsError extends Error {
  override readonly name = 'AzureDevOpsError';
  readonly statusCode: number;
  /** Milliseconds from a Retry-After header, when the API sent one (429). */
  readonly retryAfterMs?: number;

  constructor(message: string, statusCode: number, retryAfterMs?: number) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function adoFetch<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${config.orgUrl}/${config.project}/_apis/${path}`;
  const authHeader =
    'Basic ' + Buffer.from(':' + config.pat).toString('base64');

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    throw new AzureDevOpsError(
      `Azure DevOps API error ${res.status}: ${body}`,
      res.status,
      Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : undefined,
    );
  }

  return (await res.json()) as T;
}

export const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000];

/**
 * Fetch with retry. 429 (throttling) is always retryable — ADO rejected the
 * request without processing it — honoring Retry-After when present. 5xx and
 * network errors are retried only for idempotent requests; retrying a POST
 * that may have been applied server-side duplicates comments/attachments.
 */
export async function adoFetchWithRetry<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS,
  idempotent = true,
): Promise<T> {
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await adoFetch<T>(config, path, options);
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxAttempts;
      let delay = retryDelays[attempt - 1] ?? 0;

      if (err instanceof AzureDevOpsError) {
        const retryable =
          err.statusCode === 429 || (idempotent && err.statusCode >= 500);
        if (!retryable || isLastAttempt) throw err;
        if (err.statusCode === 429 && err.retryAfterMs !== undefined) {
          delay = err.retryAfterMs;
        }
      } else {
        if (!idempotent || isLastAttempt) throw err;
      }

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('adoFetchWithRetry: unexpected code path');
}

export async function queryWorkItems(
  config: AppConfig,
  wiql: string,
): Promise<number[]> {
  const path = 'wit/wiql?api-version=7.0';
  const data = await adoFetchWithRetry<WiqlQueryResult>(config, path, {
    method: 'POST',
    body: JSON.stringify({ query: wiql }),
  });
  return data.workItems.map((wi) => wi.id);
}

export async function getWorkItem(
  config: AppConfig,
  workItemId: number,
): Promise<WorkItemResponse> {
  const path = `wit/workitems/${workItemId}?$expand=all&api-version=7.0`;
  return adoFetchWithRetry<WorkItemResponse>(config, path);
}

export async function getWorkItemsBatch(
  config: AppConfig,
  ids: number[],
): Promise<WorkItemResponse[]> {
  if (ids.length === 0) return [];
  const idList = ids.join(',');
  const path = `wit/workitems?ids=${idList}&$expand=all&api-version=7.0`;
  const data = await adoFetchWithRetry<{ value: WorkItemResponse[] }>(
    config,
    path,
  );
  return data.value;
}

const DISCOVERY_FIELDS = [
  'System.Tags',
  'System.Title',
  'System.Description',
  'System.WorkItemType',
].join(',');

/**
 * Find work items carrying the configured tag and return them with the fields
 * the processor needs — one WIQL round-trip plus one batch fetch, no $expand.
 *
 * Scoped to the project via the request URL (NOT a `[System.TeamProject]`
 * clause — that's fragile and can zero out results if config.project doesn't
 * exactly match the stored value).
 *
 * `[System.Tags] CONTAINS` is substring-based, so the WIQL only narrows to
 * candidates; we exact-match per tag in code from the fetched System.Tags.
 */
export async function queryTaggedWorkItems(
  config: AppConfig,
): Promise<WorkItemResponse[]> {
  let wiql =
    `SELECT [System.Id] FROM workitems ` +
    `WHERE [System.Tags] CONTAINS '${config.createScriptTag}'`;
  // Area path is how work items are classified under a product (e.g.
  // "Continia Software\Continia Banking") — UNDER matches the node and all
  // descendants. This is the real scope signal; Git artifact links are absent.
  if (config.areaPath) {
    wiql += ` AND [System.AreaPath] UNDER '${config.areaPath}'`;
  }
  const candidateIds = await queryWorkItems(config, wiql);
  if (candidateIds.length === 0) return [];

  const tagLower = config.createScriptTag.toLowerCase();
  const tagged: WorkItemResponse[] = [];
  const chunkSize = 200;

  for (let i = 0; i < candidateIds.length; i += chunkSize) {
    const chunk = candidateIds.slice(i, i + chunkSize);
    const path = `wit/workitems?ids=${chunk.join(',')}&fields=${DISCOVERY_FIELDS}&api-version=7.0`;
    const data = await adoFetchWithRetry<{ value: WorkItemResponse[] }>(
      config,
      path,
    );
    for (const item of data.value ?? []) {
      const tags = String(item.fields['System.Tags'] ?? '');
      if (tags.split(';').some((t) => t.trim().toLowerCase() === tagLower)) {
        tagged.push(item);
      }
    }
  }

  return tagged;
}

interface CommentsResponse {
  comments: Array<{ id: number; text: string }>;
}

/** Fetch the text of all comments on a work item, oldest first. */
export async function getWorkItemComments(
  config: AppConfig,
  workItemId: number,
): Promise<string[]> {
  const path = `wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`;
  const data = await adoFetchWithRetry<CommentsResponse>(config, path);
  return data.comments.map((c) => c.text);
}

/**
 * Remove a tag from a work item's `System.Tags` (case-insensitive). No-op if the
 * tag isn't present. Uses a `replace` patch — `add` on System.Tags merges rather
 * than overwriting, so it would never actually remove anything.
 *
 * The rewrite replaces the WHOLE tag string, and hours can pass between item
 * discovery and this call — so re-read the tags fresh and guard the PATCH with
 * a `test` op on `rev`. On a conflict (someone edited the item in the window
 * between our GET and PATCH), re-read and retry once.
 */
export async function removeTagFromWorkItem(
  config: AppConfig,
  workItemId: number,
  tagToRemove: string,
): Promise<void> {
  const tagLower = tagToRemove.toLowerCase();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const getPath = `wit/workitems/${workItemId}?fields=System.Tags&api-version=7.0`;
    const workItem = await adoFetchWithRetry<WorkItemResponse>(config, getPath);
    const remaining = String(workItem.fields['System.Tags'] ?? '')
      .split(';')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.toLowerCase() !== tagLower);

    try {
      await adoFetchWithRetry<WorkItemResponse>(
        config,
        `wit/workitems/${workItemId}?api-version=7.0`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([
            { op: 'test', path: '/rev', value: workItem.rev },
            { op: 'replace', path: '/fields/System.Tags', value: remaining.join('; ') },
          ]),
        },
      );
      return;
    } catch (err) {
      const conflict =
        err instanceof AzureDevOpsError &&
        (err.statusCode === 409 || err.statusCode === 412 || err.statusCode === 400);
      if (!conflict || attempt === 2) throw err;
      // rev moved between GET and PATCH — loop re-reads and retries once
    }
  }
}

/** Add a comment to a work item. */
export async function addWorkItemComment(
  config: AppConfig,
  workItemId: number,
  text: string,
): Promise<void> {
  const path = `wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`;
  await adoFetchWithRetry(config, path, {
    method: 'POST',
    body: JSON.stringify({ text }),
  }, DEFAULT_RETRY_DELAYS, false);
}

export interface AttachmentRef {
  id: string;
  url: string;
}

/** Upload raw file content as an attachment; returns the attachment id and url. */
export async function uploadAttachment(
  config: AppConfig,
  fileName: string,
  content: string,
): Promise<AttachmentRef> {
  const path = `wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`;
  return adoFetchWithRetry<AttachmentRef>(config, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content,
  }, DEFAULT_RETRY_DELAYS, false);
}

/** Link a previously uploaded attachment to a work item with a relation comment. */
export async function linkAttachment(
  config: AppConfig,
  workItemId: number,
  attachmentUrl: string,
  comment: string,
): Promise<WorkItemResponse> {
  const path = `wit/workitems/${workItemId}?api-version=7.1`;
  return adoFetchWithRetry<WorkItemResponse>(config, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: attachmentUrl,
          attributes: { comment },
        },
      },
    ]),
  }, DEFAULT_RETRY_DELAYS, false);
}
