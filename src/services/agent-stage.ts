import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AppConfig, StageName, StageUsage } from '../types/index.ts';

/**
 * Runs one LLM stage of the pipeline as its own Agent SDK session: its own
 * model, effort, turn/budget caps and timeout, and a JSON-schema result read
 * from `structured_output` instead of being scraped out of prose.
 */

export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface AgentStageDeps {
  query: QueryFn;
  readPrompt: (name: string) => string;
}

const PROMPTS_DIR = join(import.meta.dir, '..', '..', 'prompts');

export const defaultAgentStageDeps: AgentStageDeps = {
  query: sdkQuery,
  readPrompt: (name) => readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf-8'),
};

export type StageRun<T> =
  | { ok: true; output: T; usage: StageUsage }
  | { ok: false; error: string; usage: StageUsage };

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

/** Host env vars the agent must never see (it only talks to DemoPortal). */
const HIDDEN_ENV_PREFIXES = ['AZURE_DEVOPS_'];

export function agentEnv(
  config: AppConfig,
  hostEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(hostEnv)) {
    if (value === undefined) continue;
    if (HIDDEN_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  env['CONTINIA_API_TOKEN'] = config.continiaApiToken;
  // Set = API billing; empty = Claude Code login credentials.
  if (config.anthropicApiKey) env['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
  return env;
}

export function buildStageOptions(
  config: AppConfig,
  stage: StageName,
  systemAppend: string,
  outputSchema: Record<string, unknown>,
  abortController: AbortController,
): Options {
  const settings = config.stages[stage];
  const options: Options = {
    model: settings.model,
    maxTurns: settings.maxTurns,
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.maxBudgetUsd ? { maxBudgetUsd: settings.maxBudgetUsd } : {}),
    // Keep Claude Code's own system prompt (tool + skill guidance) and add the stage's.
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend },
    tools: { type: 'preset', preset: 'claude_code' },
    // Project settings load the .claude/skills the stages invoke; they resolve from cwd.
    settingSources: ['project'],
    cwd: process.cwd(),
    additionalDirectories: [config.continiaBankingPath, config.workspaceOutputDir, config.pteOutputDir],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    outputFormat: { type: 'json_schema', schema: outputSchema },
    abortController,
    env: agentEnv(config),
  };
  if (config.lspPluginPath) {
    options.plugins = [{ type: 'local', path: config.lspPluginPath }];
  }
  return options;
}

/**
 * Run one stage. `promptNames` are files in prompts/ appended to the system
 * prompt in order (shared invariants first). Never throws: errors, timeouts
 * and schema mismatches come back as `ok: false` with whatever usage was seen.
 */
export async function runAgentStage<S extends z.ZodType>(
  config: AppConfig,
  stage: StageName,
  promptNames: string[],
  prompt: string,
  schema: S,
  deps: AgentStageDeps = defaultAgentStageDeps,
): Promise<StageRun<z.infer<S>>> {
  const settings = config.stages[stage];
  const usage: StageUsage = { stage, model: settings.model, costUsd: 0, turns: 0, durationMs: 0 };
  const started = Date.now();
  const abortController = new AbortController();
  const timeoutMs = settings.timeoutMinutes * 60_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  const fail = (error: string): StageRun<z.infer<S>> => ({ ok: false, error, usage });

  try {
    const systemAppend = promptNames.map((name) => deps.readPrompt(name)).join('\n\n');
    // zod stamps $schema: draft 2020-12, which the Claude Code CLI's validator rejects.
    const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    const options = buildStageOptions(config, stage, systemAppend, jsonSchema, abortController);

    log(`  Stage ${stage}: starting (${settings.model}${settings.effort ? `, effort ${settings.effort}` : ''})`);
    let structured: unknown;
    let failure: string | undefined;
    for await (const message of deps.query({ prompt, options })) {
      if (message.type !== 'result') continue;
      usage.costUsd = message.total_cost_usd;
      usage.turns = message.num_turns;
      if (message.subtype === 'success' && !message.is_error) {
        structured = message.structured_output;
      } else if (message.subtype === 'success') {
        failure = `agent reported an error: ${message.result.slice(0, 300)}`;
      } else {
        const detail = message.errors.length > 0 ? `: ${message.errors.join('; ').slice(0, 300)}` : '';
        failure = `${message.subtype}${detail}`;
      }
    }

    if (failure) return fail(`${stage} stage ended with ${failure}`);
    if (structured === undefined) return fail(`${stage} stage returned no structured output`);
    const parsed = schema.safeParse(structured);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return fail(`${stage} stage output failed validation: ${issues}`);
    }
    return { ok: true, output: parsed.data, usage };
  } catch (err) {
    if (timedOut) return fail(`${stage} stage timed out after ${settings.timeoutMinutes} min`);
    return fail(`${stage} stage threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
    usage.durationMs = Date.now() - started;
    log(
      `  Stage ${stage}: $${usage.costUsd.toFixed(4)} | ${usage.turns} turns | ` +
        `${Math.round(usage.durationMs / 1000)}s`,
    );
  }
}
