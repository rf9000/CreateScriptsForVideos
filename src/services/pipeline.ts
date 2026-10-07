import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';
import type { AppConfig, EnvDetails, ItemMode, ScriptResult, StageUsage } from '../types/index.ts';
import { runAgentStage, defaultAgentStageDeps } from './agent-stage.ts';
import type { AgentStageDeps, StageRun } from './agent-stage.ts';
import { createContiniaCli, waitForRunning } from './continia-cli.ts';
import type { ContiniaCli } from './continia-cli.ts';
import { selectProfile } from './profile-selection.ts';
import { countryAppDir, discoverBankingApps, requiredBcVersion } from '../utils/banking-repo.ts';
import type { BankingApp } from '../utils/banking-repo.ts';
import { makeVideo } from '../video/make-video.ts';
import type { VideoResult } from '../video/make-video.ts';
import { checkRecording, symbolDirsFor } from '../video/recording-check.ts';
import { loadSymbolIndex } from '../video/symbols.ts';

/**
 * The per-item pipeline. LLM stages (generate, validate, deploy) each run as a
 * separate agent session; environment work (provision, activate, verify,
 * credentials) is plain code against the continia CLI. Progress is saved after
 * each step so a failed item can resume from the last good step.
 */

/** GUID of the "Continia Banking Internal Access" app the PTE depends on. */
export const INTERNAL_ACCESS_APP_ID = '6e549e35-d1b2-4878-a37a-a736c22f35bf';
/** GUID of the Continia Core Internal Activation App; Continia products need it on a fresh env. */
export const ACTIVATION_APP_ID = 'c3755ece-dab0-4d16-987d-040661f18522';

export interface WorkItemContext {
  itemId: number;
  itemTitle: string;
  itemType: string;
  itemDescription: string;
  comments: string[];
}

export const generateOutputSchema = z.object({
  status: z.enum(['success', 'failed']),
  feature: z.string().describe('Short feature name, e.g. "Merge Rules"'),
  needsBankingDemo: z
    .boolean()
    .describe('True if the demo relies on baseline data from the banking-demo app'),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string()),
  errorMessage: z.string().optional().describe('Required when status is failed'),
});

export const validateOutputSchema = z.object({
  status: z.enum(['passed', 'blocked']),
  blockers: z.array(z.string()).describe('Blockers still open after the fix attempts'),
  warnings: z.array(z.string()),
});

export const recordingOutputSchema = z.object({
  status: z.enum(['success', 'failed']),
  notes: z.array(z.string()).describe('Anything a reviewer of the video should know'),
  errorMessage: z.string().optional().describe('Required when status is failed'),
});

export const deployOutputSchema = z.object({
  status: z.enum(['success', 'failed']),
  gaps: z.array(z.string()),
  errorMessage: z.string().optional().describe('Required when status is failed'),
});

type GenerateOutput = z.infer<typeof generateOutputSchema>;
type ValidateOutput = z.infer<typeof validateOutputSchema>;

/** What is saved between steps. Never holds credentials. */
export interface PipelineState {
  generate?: GenerateOutput;
  validate?: ValidateOutput;
  profileId?: string;
  envId?: string;
  activated?: boolean;
  deployGaps?: string[];
  /** Item mode of the first attempt, so a resume keeps it. */
  mode?: ItemMode;
  /** A recording already ran on this environment (its demo data may have changed). */
  videoAttempted?: boolean;
  /** recording.yml was written and passed the symbol check. */
  recordingChecked?: boolean;
}

export interface PipelineDeps {
  stageDeps: AgentStageDeps;
  cli: (config: AppConfig) => ContiniaCli;
  waitForRunning: typeof waitForRunning;
  loadState: (path: string) => PipelineState | undefined;
  saveState: (path: string, state: PipelineState) => void;
  clearState: (path: string) => void;
  fileExists: (path: string) => boolean;
  readAppName: (ptePath: string) => string;
  discoverBankingApps: (repoPath: string) => BankingApp[];
  makeVideo: (input: Parameters<typeof makeVideo>[0]) => Promise<VideoResult>;
  /** Structure + symbol-name check of recording.yml; writes FastTab hints when clean. */
  checkRecording: (itemDir: string, ptePath: string) => string[];
}

export const defaultPipelineDeps: PipelineDeps = {
  stageDeps: defaultAgentStageDeps,
  cli: (config) => createContiniaCli(config),
  waitForRunning,
  loadState: (path) =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as PipelineState) : undefined,
  saveState: (path, state) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  },
  clearState: (path) => rmSync(path, { force: true }),
  fileExists: existsSync,
  discoverBankingApps,
  makeVideo: (input) => makeVideo(input),
  checkRecording: (itemDir, ptePath) => checkRecording(itemDir, loadSymbolIndex(symbolDirsFor(ptePath))),
  readAppName: (ptePath) => {
    const app = JSON.parse(readFileSync(join(ptePath, 'app.json'), 'utf-8')) as { name?: unknown };
    if (typeof app.name !== 'string' || !app.name) throw new Error(`no name in ${ptePath}/app.json`);
    return app.name;
  },
};

export interface ItemPaths {
  scriptPath: string;
  ptePath: string;
  statePath: string;
}

export function itemPaths(config: AppConfig, itemId: number): ItemPaths {
  const outDir = resolve(config.workspaceOutputDir, String(itemId));
  return {
    scriptPath: join(outDir, 'recording-script.md'),
    // One level below the item folder, so deploying from the PTE's parent gives
    // each item its own workspace root (the CLI writes <root>/.alpackages there).
    ptePath: resolve(config.pteOutputDir, String(itemId), 'pte'),
    statePath: join(outDir, 'pipeline-state.json'),
  };
}

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

/** The work item as the agent's brief. */
export function buildBrief(context: WorkItemContext): string {
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

function pathsBlock(config: AppConfig, paths: ItemPaths): string {
  return [
    '## Paths for this item',
    `- continia-banking repo (read-only): ${resolve(config.continiaBankingPath)}`,
    `- Recording script file: ${paths.scriptPath}`,
    `- PTE folder (app.json goes directly here): ${paths.ptePath}`,
    `- continia CLI: \`${config.continiaCliPath} --auth-method api-token <command>\` (token is in CONTINIA_API_TOKEN)`,
  ].join('\n');
}

function envName(context: WorkItemContext): string {
  return `Demo #${context.itemId} ${context.itemTitle}`.slice(0, 60).trim();
}

export interface PipelineOptions {
  /** Continue from the saved state instead of starting over. */
  resume?: boolean;
  /** 'video' also records a demo video. Default 'script'. */
  mode?: ItemMode;
}

export async function runPipeline(
  config: AppConfig,
  context: WorkItemContext,
  options: PipelineOptions = {},
  deps: PipelineDeps = defaultPipelineDeps,
): Promise<ScriptResult> {
  const paths = itemPaths(config, context.itemId);
  const stages: StageUsage[] = [];
  const cli = deps.cli(config);

  if (!options.resume) deps.clearState(paths.statePath);
  const state: PipelineState = (options.resume && deps.loadState(paths.statePath)) || {};
  const save = () => deps.saveState(paths.statePath, state);
  // Resume keeps the mode of the first attempt (the tag is gone by then).
  const mode: ItemMode = options.mode ?? state.mode ?? 'script';
  state.mode = mode;

  const base = () => ({
    scriptPath: paths.scriptPath,
    ptePath: paths.ptePath,
    feature: state.generate?.feature,
    assumptions: state.generate?.assumptions ?? [],
    gaps: [
      ...(state.generate?.gaps ?? []),
      ...(state.validate?.warnings ?? []),
      ...(state.deployGaps ?? []),
    ],
    stages,
    costUsd: stages.reduce((sum, s) => sum + s.costUsd, 0),
  });

  const failed = async (errorMessage: string): Promise<ScriptResult> => {
    const env = state.envId ? await collectEnv(cli, state.envId).catch(() => undefined) : undefined;
    return { ...base(), status: 'failed', errorMessage, ...(env ? { env } : {}) };
  };

  const record = <T>(run: StageRun<T>): run is Extract<StageRun<T>, { ok: true }> => {
    stages.push(run.usage);
    return run.ok;
  };

  // Resolve the profile before any agent spends money: a version or
  // localization mismatch should fail here, not after generate and validate.
  const bankingApps = deps.discoverBankingApps(config.continiaBankingPath);
  if (!state.envId && !state.profileId) {
    try {
      if (config.envProfileId) {
        state.profileId = config.envProfileId;
      } else {
        const required = requiredBcVersion(bankingApps);
        if (!required) {
          return failed(
            `no app.json under ${config.continiaBankingPath} declares "application" or "platform"; ` +
              'set CONTINIA_ENV_PROFILE_ID to pin a profile',
          );
        }
        const profile = await selectProfile(cli, required, config.envLocalization, (m) => log(`  ${m}`));
        log(`  continia-banking requires BC ${required}: using ${profile.description || profile.id} (${profile.id})`);
        state.profileId = profile.id;
      }
    } catch (err) {
      return failed(`profile selection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const brief = buildBrief(context);
  const where = pathsBlock(config, paths);

  // A. Generate: research, PTE, recording script.
  if (!state.generate) {
    const run = await runAgentStage(
      config,
      'generate',
      ['invariants', 'generate'],
      `${brief}\n\n${where}`,
      generateOutputSchema,
      deps.stageDeps,
    );
    if (!record(run)) return failed(run.error);
    if (run.output.status === 'failed') {
      return failed(run.output.errorMessage || 'generate stage failed without a message');
    }
    if (!deps.fileExists(paths.scriptPath)) return failed(`recording script not written to ${paths.scriptPath}`);
    if (!deps.fileExists(join(paths.ptePath, 'app.json'))) return failed(`PTE app.json not written in ${paths.ptePath}`);
    state.generate = run.output;
    save();
  }

  // B. Validate: blocking gate; the stage fixes and re-validates on its own.
  if (state.validate?.status !== 'passed') {
    const run = await runAgentStage(
      config,
      'validate',
      ['invariants', 'validate'],
      `${brief}\n\n${where}`,
      validateOutputSchema,
      deps.stageDeps,
    );
    if (!record(run)) return failed(run.error);
    state.validate = run.output;
    save();
    if (run.output.status === 'blocked') {
      return failed(`demo data validation blocked: ${run.output.blockers.join('; ') || 'no details'}`);
    }
  }

  try {
    // C. Provision a fresh environment and wait for it.
    if (!state.envId) {
      if (!state.profileId) return failed('no profile resolved for provisioning');
      log(`  Provisioning environment from profile ${state.profileId}...`);
      state.envId = await cli.createEnvironment(envName(context), state.profileId);
      save();
    }
    await deps.waitForRunning(cli, state.envId, config.envReadyTimeoutMinutes * 60_000);

    // D. Activate: Continia products need the activation app before any deploy.
    if (!state.activated) {
      const install = await cli.installAppById(state.envId, ACTIVATION_APP_ID);
      if (!install.installed) {
        return failed(`activation app install failed (${install.reasonCode ?? 'no reason code'})`);
      }
      state.activated = true;
      save();
    }
  } catch (err) {
    return failed(`environment setup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // E. Deploy: symbols, compile, publish, fix loop.
  const countryDir = countryAppDir(bankingApps, config.envLocalization);
  const countryApp = countryDir ? join(resolve(config.continiaBankingPath), countryDir) : undefined;
  if (!state.deployGaps) {
    const deployPrompt = [
      brief,
      where,
      '## Environment',
      `- Environment id: ${state.envId}`,
      '- It is running and activated.',
      `- Publish banking-demo first: ${state.generate.needsBankingDemo ? 'yes' : 'no'}`,
      `- Country app for localization '${config.envLocalization}': ${countryApp ?? 'none found'}`,
    ].join('\n\n');
    const run = await runAgentStage(
      config,
      'deploy',
      ['invariants', 'deploy'],
      deployPrompt,
      deployOutputSchema,
      deps.stageDeps,
    );
    if (!record(run)) return failed(run.error);
    if (run.output.status === 'failed') {
      return failed(run.output.errorMessage || 'deploy stage failed without a message');
    }
    state.deployGaps = run.output.gaps;
    save();
  }

  // F. Verify the PTE is installed, then collect credentials.
  try {
    const appName = deps.readAppName(paths.ptePath);
    const apps = await cli.listApps(state.envId);
    if (!apps.some((app) => app.name === appName)) {
      return failed(`deploy reported success but "${appName}" is not installed on ${state.envId}`);
    }
    const env = await collectEnv(cli, state.envId);
    if (mode !== 'video') return { ...base(), status: 'success', env };
    const itemDir = join(paths.scriptPath, '..');
    const videoFailed = (error: string): ScriptResult => {
      log(`  Video failed: ${error}`);
      return { ...base(), status: 'success', env, video: { ok: false, error } };
    };

    // G. Recording: written after deploy, when the PTE's symbols (Microsoft's included) are on disk.
    if (!state.recordingChecked) {
      const recordingPrompt = [
        brief,
        where,
        '## Recording tools',
        `- Recording script to turn into a recording: ${paths.scriptPath}`,
        `- Write: ${join(itemDir, 'recording.yml')} and ${join(itemDir, 'narration.yml')}`,
        `- Look up a page's real names: \`bun src/cli/index.ts symbols "${paths.ptePath}" "<page name>"\``,
        `- Check your recording: \`bun src/cli/index.ts recording-check "${itemDir}" "${paths.ptePath}"\``,
      ].join('\n\n');
      const run = await runAgentStage(config, 'recording', ['invariants', 'recording'], recordingPrompt, recordingOutputSchema, deps.stageDeps);
      if (!record(run)) return videoFailed(run.error);
      if (run.output.status === 'failed') return videoFailed(run.output.errorMessage || 'recording stage failed without a message');
      const problems = deps.checkRecording(itemDir, paths.ptePath);
      if (problems.length) return videoFailed(`recording.yml failed the check: ${problems.join('; ')}`);
      state.recordingChecked = true;
      save();
    }
    const reused = state.videoAttempted === true;
    state.videoAttempted = true;
    save();
    log('  Recording demo video...');
    const video = await deps.makeVideo({
      itemDir: join(paths.scriptPath, '..'),
      url: env.url,
      user: env.username,
      password: env.password,
      config,
    });
    if (!video.ok) log(`  Video failed: ${video.error}`);
    const result = base();
    if (reused) {
      result.gaps.push(
        'video: re-recorded on an environment an earlier recording already used; the demo data may not be in its starting state',
      );
    }
    return {
      ...result,
      status: 'success',
      env,
      video: video.ok ? { ok: true, path: video.videoPath } : { ok: false, error: video.error },
    };
  } catch (err) {
    return failed(`verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Environment details for the work-item comment. */
async function collectEnv(cli: ContiniaCli, envId: string): Promise<EnvDetails> {
  const info = await cli.getEnvironment(envId);
  const users = await cli.getUsers(envId);
  const user = users.find((u) => u.password) ?? users[0];
  return {
    id: info.id,
    name: info.name,
    url: info.url,
    username: user?.username ?? '',
    password: user?.password ?? '',
  };
}
