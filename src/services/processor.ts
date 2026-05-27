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
  report: (text) => console.log(text),
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

function buildEnvComment(result: ScriptResult, fileName: string): string {
  const env = result.env;
  const feature = result.feature ?? 'this feature';
  const lines = [
    `Recording environment ready for **${feature}**.`,
    '',
    `- **Environment:** ${env?.name ?? '(unknown)'} (${env?.id ?? '?'})`,
    `- **URL:** ${env?.url ?? '(unknown)'}`,
    `- **Username:** ${env?.username ?? '(unknown)'}`,
    `- **Password:** ${env?.password ?? '(unknown)'}`,
  ];
  if (result.gaps && result.gaps.length > 0) {
    lines.push('', '**Gaps to be aware of:**', ...result.gaps.map((g) => `- ${g}`));
  }
  lines.push('', `The recording script is attached to this work item as \`${fileName}\`.`);
  return lines.join('\n');
}

function buildFailureComment(result: ScriptResult): string {
  return [
    `Script generation failed for this work item:`,
    '',
    `> ${result.errorMessage ?? 'unknown error'}`,
    '',
    `It will be retried on the next polling cycle.`,
  ].join('\n');
}

export async function processItem(
  config: AppConfig,
  item: WorkItemResponse,
  deps: ProcessorDeps = defaultDeps,
): Promise<ItemProcessResult> {
  const title = String(item.fields['System.Title'] ?? '(untitled)');
  log(`Processing item #${item.id}: ${title}`);

  try {
    const comments = await deps.fetchComments(config, item.id);

    const context: OrchestratorContext = {
      itemId: item.id,
      itemTitle: title,
      itemType: String(item.fields['System.WorkItemType'] ?? ''),
      itemDescription: String(item.fields['System.Description'] ?? ''),
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
    return { itemId: item.id, processed: false, error: String(err) };
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
