import { readFileSync } from 'fs';
import type {
  AppConfig,
  WorkItemResponse,
  ItemProcessResult,
  ScriptResult,
} from '../types/index.ts';
import type { AttachmentRef } from '../sdk/azure-devops-client.ts';
import type { OrchestratorContext } from './orchestrator-agent.ts';

import * as sdk from '../sdk/azure-devops-client.ts';
import * as orchestrator from './orchestrator-agent.ts';
import { htmlToText } from './html.ts';

export interface ProcessorDeps {
  fetchComments: (config: AppConfig, workItemId: number) => Promise<string[]>;
  runOrchestrator: (
    config: AppConfig,
    context: OrchestratorContext,
  ) => Promise<ScriptResult>;
  readScript: (path: string) => string;
  uploadAttachment: (
    config: AppConfig,
    fileName: string,
    content: string,
  ) => Promise<AttachmentRef>;
  linkAttachment: (
    config: AppConfig,
    workItemId: number,
    attachmentUrl: string,
    comment: string,
  ) => Promise<WorkItemResponse>;
  addComment: (config: AppConfig, workItemId: number, text: string) => Promise<void>;
  removeTag: (config: AppConfig, workItemId: number, tag: string) => Promise<void>;
  /** Human-facing terminal output (used for dry-run reporting). */
  report: (text: string) => void;
}

const defaultDeps: ProcessorDeps = {
  fetchComments: sdk.getWorkItemComments,
  runOrchestrator: orchestrator.runOrchestrator,
  readScript: (path) => readFileSync(path, 'utf-8'),
  uploadAttachment: sdk.uploadAttachment,
  linkAttachment: sdk.linkAttachment,
  addComment: sdk.addWorkItemComment,
  removeTag: sdk.removeTagFromWorkItem,
  report: (text) => console.log(text),
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

/** Escape text for safe inclusion in the HTML comment body ADO renders. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Marker embedded in every comment this pipeline posts, so later runs can filter them out of the brief. */
export const BOT_COMMENT_MARKER = '[create-scripts]';

/** Phrases identifying comments posted by builds that predate the marker. */
const LEGACY_BOT_PHRASES = [
  'Recording environment ready for',
  'Script generation failed for this work item',
];

export function isBotComment(text: string): boolean {
  return (
    text.includes(BOT_COMMENT_MARKER) ||
    LEGACY_BOT_PHRASES.some((phrase) => text.includes(phrase))
  );
}

const botFooter = `<p><em>Posted automatically by the create-scripts pipeline</em> <code>${BOT_COMMENT_MARKER}</code></p>`;

// ADO work-item comments render HTML, not Markdown — build HTML directly.
function buildEnvComment(result: ScriptResult, fileName: string): string {
  const env = result.env;
  const feature = escapeHtml(result.feature ?? 'this feature');
  const url = env?.url ?? '';
  const lines = [
    `<p>Recording environment ready for <strong>${feature}</strong>.</p>`,
    '<ul>',
    `<li><strong>Environment:</strong> ${escapeHtml(env?.name ?? '(unknown)')} (${escapeHtml(env?.id ?? '?')})</li>`,
    `<li><strong>URL:</strong> ${url ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : '(unknown)'}</li>`,
    `<li><strong>Username:</strong> ${escapeHtml(env?.username ?? '(unknown)')}</li>`,
    `<li><strong>Password:</strong> ${escapeHtml(env?.password ?? '(unknown)')}</li>`,
    '</ul>',
  ];
  if (result.assumptions && result.assumptions.length > 0) {
    lines.push('<p><strong>Assumptions made:</strong></p>', '<ul>');
    for (const a of result.assumptions) lines.push(`<li>${escapeHtml(a)}</li>`);
    lines.push('</ul>');
  }
  if (result.gaps && result.gaps.length > 0) {
    lines.push('<p><strong>Gaps to be aware of:</strong></p>', '<ul>');
    for (const g of result.gaps) lines.push(`<li>${escapeHtml(g)}</li>`);
    lines.push('</ul>');
  }
  lines.push(
    `<p>The recording script is attached to this work item as <code>${escapeHtml(fileName)}</code>.</p>`,
    botFooter,
  );
  return lines.join('\n');
}

function buildFailureComment(result: ScriptResult): string {
  const lines = [
    '<p>Script generation failed for this work item:</p>',
    `<blockquote>${escapeHtml(result.errorMessage ?? 'unknown error')}</blockquote>`,
  ];
  if (result.env) {
    lines.push(
      '<p><strong>An environment was provisioned before the failure and is still running:</strong></p>',
      '<ul>',
      `<li><strong>Environment:</strong> ${escapeHtml(result.env.name)} (${escapeHtml(result.env.id)})</li>`,
      `<li><strong>URL:</strong> <a href="${escapeHtml(result.env.url)}">${escapeHtml(result.env.url)}</a></li>`,
      `<li><strong>Username:</strong> ${escapeHtml(result.env.username)}</li>`,
      `<li><strong>Password:</strong> ${escapeHtml(result.env.password)}</li>`,
      '</ul>',
    );
  }
  lines.push(
    '<p>The tag has been removed. <strong>Re-add the tag</strong> (e.g. after adding more detail) to try again.</p>',
    botFooter,
  );
  return lines.join('\n');
}

export async function processItem(
  config: AppConfig,
  item: WorkItemResponse,
  deps: ProcessorDeps = defaultDeps,
): Promise<ItemProcessResult> {
  const title = String(item.fields['System.Title'] ?? '(untitled)');
  log(`Processing item #${item.id}: ${title}`);

  try {
    const rawComments = await deps.fetchComments(config, item.id);
    // ADO stores comments as HTML and includes this pipeline's own past posts
    // (env credentials, failure reports). Neither belongs in the agent's brief.
    const comments = rawComments
      .filter((c) => !isBotComment(c))
      .map((c) => htmlToText(c))
      .filter((c) => c.length > 0);

    const context: OrchestratorContext = {
      itemId: item.id,
      itemTitle: title,
      itemType: String(item.fields['System.WorkItemType'] ?? ''),
      itemDescription: htmlToText(String(item.fields['System.Description'] ?? '')),
      comments,
    };

    log(`  Item #${item.id}: Running orchestrator...`);
    const result = await deps.runOrchestrator(config, context);
    const costUsd = result.costUsd;
    log(`  Item #${item.id}: Agent cost $${(costUsd ?? 0).toFixed(4)}`);

    if (config.dryRun) {
      deps.report(buildDryRunReport(item.id, title, result, deps.readScript));
      return { itemId: item.id, processed: result.status === 'success', costUsd };
    }

    if (result.status !== 'success') {
      await deps.addComment(config, item.id, buildFailureComment(result));
      log(`  Item #${item.id}: Failed — ${result.errorMessage}`);
      return { itemId: item.id, processed: false, error: result.errorMessage, costUsd };
    }

    if (!result.scriptPath) {
      const msg = 'orchestrator reported success but returned no scriptPath';
      await deps.addComment(config, item.id, buildFailureComment({ status: 'failed', errorMessage: msg }));
      return { itemId: item.id, processed: false, error: msg, costUsd };
    }

    const fileName = `recording-script-${item.id}.md`;
    const content = deps.readScript(result.scriptPath);
    const attachment = await deps.uploadAttachment(config, fileName, content);
    await deps.linkAttachment(
      config,
      item.id,
      attachment.url,
      `Recording script for ${result.feature ?? title}`,
    );
    await deps.addComment(config, item.id, buildEnvComment(result, fileName));

    log(`  Item #${item.id}: Script attached and environment details posted`);
    return { itemId: item.id, processed: true, costUsd };
  } catch (err) {
    log(`  Item #${item.id}: Error — ${err}`);
    // Best-effort failure comment so a removed tag always has an explanation.
    if (!config.dryRun) {
      try {
        await deps.addComment(
          config,
          item.id,
          buildFailureComment({ status: 'failed', errorMessage: String(err) }),
        );
      } catch {
        // ignore — the finally still removes the tag
      }
    }
    return { itemId: item.id, processed: false, error: String(err) };
  } finally {
    // The tag is the work queue: drop it after every real attempt (success or
    // failure) so the item isn't rediscovered. Re-tagging is how you request it
    // again. Skipped in dry-run (no writes). Best-effort — a failed removal just
    // means the item may be retried on the next cycle.
    if (!config.dryRun) {
      try {
        await deps.removeTag(config, item.id, config.createScriptTag);
      } catch (err) {
        log(`  Item #${item.id}: Failed to remove tag — ${err}`);
      }
    }
  }
}

function buildDryRunReport(
  itemId: number,
  title: string,
  result: ScriptResult,
  readScript: (path: string) => string,
): string {
  const lines = [
    '',
    `===== [DRY RUN] Work item #${itemId}: ${title} =====`,
    `Status:  ${result.status}`,
    `Feature: ${result.feature ?? '-'}`,
    `Cost:    $${(result.costUsd ?? 0).toFixed(4)}`,
  ];

  if (result.env) {
    lines.push(
      '',
      '--- Environment (not posted to DevOps in dry run) ---',
      `  Name:     ${result.env.name} (${result.env.id})`,
      `  URL:      ${result.env.url}`,
      `  Username: ${result.env.username}`,
      `  Password: ${result.env.password}`,
    );
  }

  if (result.errorMessage) {
    lines.push('', `Error: ${result.errorMessage}`);
  }

  if (result.scriptPath) {
    let content = `(could not read ${result.scriptPath})`;
    try {
      content = readScript(result.scriptPath);
    } catch {
      // keep the placeholder
    }
    lines.push('', `--- Recording script (${result.scriptPath}) ---`, content);
  }

  return lines.join('\n');
}
