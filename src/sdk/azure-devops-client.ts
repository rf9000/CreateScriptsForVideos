import type {
  AppConfig,
  WorkItemResponse,
  WiqlQueryResult,
} from '../types/index.ts';

export class AzureDevOpsError extends Error {
  override readonly name = 'AzureDevOpsError';
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
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
    throw new AzureDevOpsError(
      `Azure DevOps API error ${res.status}: ${body}`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000];

export async function adoFetchWithRetry<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS,
): Promise<T> {
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await adoFetch<T>(config, path, options);
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxAttempts;

      if (err instanceof AzureDevOpsError) {
        if (err.statusCode < 500) {
          throw err;
        }
        if (isLastAttempt) {
          throw err;
        }
      } else {
        if (isLastAttempt) {
          throw err;
        }
      }

      const delay = retryDelays[attempt - 1] ?? 0;
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

export async function updateWorkItemField(
  config: AppConfig,
  workItemId: number,
  fieldName: string,
  value: string,
): Promise<WorkItemResponse> {
  const path = `wit/workitems/${workItemId}?api-version=7.0`;
  return adoFetchWithRetry<WorkItemResponse>(config, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([{ op: 'add', path: `/fields/${fieldName}`, value }]),
  });
}

/** Build a WIQL query scoped to the configured project and `create script` tag. */
export async function queryWorkItemsByTag(
  config: AppConfig,
): Promise<number[]> {
  const wiql =
    `SELECT [System.Id] FROM workitems ` +
    `WHERE [System.TeamProject] = '${config.project}' ` +
    `AND [System.Tags] CONTAINS '${config.createScriptTag}'`;
  return queryWorkItems(config, wiql);
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
  });
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
  });
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
  });
}
