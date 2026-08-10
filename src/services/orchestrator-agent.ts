import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { AppConfig, ScriptResult } from '../types/index.ts';

/** GUID of the "Continia Banking Internal Access" app the PTE depends on. */
export const INTERNAL_ACCESS_APP_ID = '6e549e35-d1b2-4878-a37a-a736c22f35bf';

export interface OrchestratorContext {
  itemId: number;
  itemTitle: string;
  itemType: string;
  itemDescription: string;
  comments: string[];
}

/** Minimal subset of the SDK message stream we consume. */
export interface AgentMessage {
  type: string;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface OrchestratorDeps {
  query: (params: {
    prompt: string;
    options: Record<string, unknown>;
  }) => AsyncIterable<AgentMessage>;
}

const defaultDeps: OrchestratorDeps = {
  query: sdkQuery as unknown as OrchestratorDeps['query'],
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

/** Build the user prompt carrying the work item context. */
export function buildOrchestratorPrompt(context: OrchestratorContext): string {
  const lines: string[] = [
    `## Work Item #${context.itemId}`,
    `**Type:** ${context.itemType}`,
    `**Title:** ${context.itemTitle}`,
  ];

  if (context.itemDescription) {
    lines.push('', '## Description', context.itemDescription);
  }

  if (context.comments.length > 0) {
    lines.push('', '## Comments');
    context.comments.forEach((comment, i) => {
      lines.push('', `### Comment ${i + 1}`, comment);
    });
  }

  return lines.join('\n');
}

/** Append the resolved runtime paths/IDs the agent must use for this item. */
function buildRuntimeBlock(config: AppConfig, itemId: number): string {
  const scriptDir = join(config.workspaceOutputDir, String(itemId));
  const pteDir = join(config.pteOutputDir, String(itemId));
  return [
    '',
    '## Runtime configuration (use these exact paths)',
    `- Continia Banking repo (READ-ONLY, never write/delete): ${config.continiaBankingPath}`,
    `- Write the .md recording script to: ${join(scriptDir, 'script.md')}`,
    `- Create the demo-data PTE AL project DIRECTLY in this folder: ${pteDir}`,
    `  (its app.json must be at ${join(pteDir, 'app.json')}). Produce exactly ONE`,
    '  extension — do NOT create nested or feature-named subfolders, and do NOT leave',
    '  duplicate copies. If you revise the PTE, edit the files in place.',
    `- The PTE must depend on the "Continia Banking Internal Access" app (id ${INTERNAL_ACCESS_APP_ID}); do NOT edit continia-banking to gain internal access.`,
    '- Create a fresh environment for this item and leave it running.',
    '',
    'When finished, output a single fenced ```json block as the LAST thing in your reply,',
    'matching: {"status":"success"|"failed","feature":string,"scriptPath":string,',
    '"ptePath":string,"env":{"id","name","url","username","password"},',
    '"assumptions":string[],"gaps":string[],"errorMessage":string}.',
  ].join('\n');
}

const envSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

const commonFields = {
  feature: z.string().optional(),
  ptePath: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
};

// Success must carry everything the processor posts to ADO; failed must explain itself.
const scriptResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    scriptPath: z.string().min(1),
    env: envSchema,
    errorMessage: z.string().optional(),
    ...commonFields,
  }),
  z.object({
    status: z.literal('failed'),
    errorMessage: z.string().min(1),
    scriptPath: z.string().optional(),
    env: envSchema.optional(),
    ...commonFields,
  }),
]);

/**
 * Extract the structured result from the agent's final reply. Accepts a raw
 * JSON object, or a fenced ```json block embedded in prose. Falls back to a
 * failed result when nothing parseable is found. The result is validated
 * against `scriptResultSchema`: a schema-invalid "success" degrades to
 * `status: 'failed'`, salvaging a valid `env` if one was provisioned.
 */
export function parseResult(raw: string): ScriptResult {
  const candidate = extractJson(raw);
  if (candidate !== undefined) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const parsed = scriptResultSchema.safeParse(obj);
      if (parsed.success) return parsed.data;

      // Salvage a provisioned environment so the failure report can surface it.
      const env = envSchema.safeParse(obj['env']);
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return {
        status: 'failed',
        errorMessage: `Agent result failed schema validation: ${issues}`,
        ...(env.success ? { env: env.data } : {}),
      };
    } catch {
      // fall through to failure
    }
  }
  return {
    status: 'failed',
    errorMessage: `Could not parse a result from the agent output: ${raw.slice(0, 200)}`,
  };
}

function extractJson(raw: string): string | undefined {
  const fenceMatches = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fenceMatches.length > 0) {
    return fenceMatches[fenceMatches.length - 1]![1]!.trim();
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return raw.slice(first, last + 1);
  }
  return undefined;
}

function buildOptions(config: AppConfig): Record<string, unknown> {
  const options: Record<string, unknown> = {
    model: config.claudeModel,
    systemPrompt: readFileSync(config.promptPath, 'utf-8'),
    settingSources: ['project'],
    cwd: config.workspaceOutputDir,
    additionalDirectories: [config.continiaBankingPath],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: config.agentMaxTurns,
    tools: { type: 'preset', preset: 'claude_code' },
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Task'],
    // Pass the continia.exe API token to the agent's subprocess environment so
    // `continia --token $CONTINIA_API_TOKEN ...` works without VS Code. When an
    // ANTHROPIC_API_KEY is configured, forward it so Claude Code authenticates via
    // API billing instead of the Claude Code OAuth credentials (~/.claude).
    env: {
      ...process.env,
      CONTINIA_API_TOKEN: config.continiaApiToken,
      ...(config.anthropicApiKey
        ? { ANTHROPIC_API_KEY: config.anthropicApiKey }
        : {}),
    },
  };
  if (config.lspPluginPath) {
    options.plugins = [{ type: 'local', path: config.lspPluginPath }];
  }
  return options;
}

/** Run the agentic orchestration loop for one work item and return its result. */
export async function runOrchestrator(
  config: AppConfig,
  context: OrchestratorContext,
  deps: OrchestratorDeps = defaultDeps,
): Promise<ScriptResult> {
  const prompt =
    buildOrchestratorPrompt(context) + '\n' + buildRuntimeBlock(config, context.itemId);
  const options = buildOptions(config);

  let resultText: string | undefined;
  let failureSubtype: string | undefined;
  let costUsd: number | undefined;

  for await (const message of deps.query({ prompt, options })) {
    if (message.type === 'result') {
      if (message.total_cost_usd !== undefined) {
        costUsd = message.total_cost_usd;
        log(
          `  Cost: $${message.total_cost_usd.toFixed(4)} | ` +
            `${message.usage?.input_tokens ?? 0} in / ${message.usage?.output_tokens ?? 0} out | ` +
            `${message.num_turns ?? 0} turns`,
        );
      }
      if (message.subtype === 'success') {
        resultText = message.result;
      } else {
        failureSubtype = message.subtype;
      }
    }
  }

  if (resultText !== undefined) {
    const result = parseResult(resultText);
    result.costUsd = costUsd;
    return result;
  }

  return {
    status: 'failed',
    errorMessage: `Agent ended without a success result (${failureSubtype ?? 'no result message'})`,
    costUsd,
  };
}
