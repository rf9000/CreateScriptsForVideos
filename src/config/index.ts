import { z } from "zod";
import type { AppConfig, StageConfig, StageName } from "../types/index.ts";

const optionalNumber = z.coerce.number().positive().optional();

const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

const envSchema = z.object({
  AZURE_DEVOPS_PAT: z.string().min(1, "AZURE_DEVOPS_PAT is required"),
  AZURE_DEVOPS_ORG: z.string().min(1, "AZURE_DEVOPS_ORG is required"),
  AZURE_DEVOPS_PROJECT: z.string().min(1, "AZURE_DEVOPS_PROJECT is required"),
  AZURE_DEVOPS_AREA_PATH: z.string().default(""),
  CREATE_SCRIPT_TAG: z.string().default("create script"),
  CONTINIA_BANKING_PATH: z.string().default("./continia-banking"),
  CONTINIA_API_TOKEN: z.string().default(""),
  CONTINIA_CLI_PATH: z.string().default("continia"),
  CONTINIA_ENV_PROFILE_ID: z.string().default(""),
  CONTINIA_ENV_LOCALIZATION: z.string().default("base"),
  ENV_READY_TIMEOUT_MINUTES: z.coerce.number().positive().default(15),
  ANTHROPIC_API_KEY: z.string().default(""),
  WORKSPACE_OUTPUT_DIR: z.string().default("./output"),
  PTE_OUTPUT_DIR: z.string().optional(),
  LSP_PLUGIN_PATH: z.string().default(""),
  POLL_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
  OUTPUT_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),
  WATCH_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-6"),
  CLAUDE_EFFORT: effortSchema.optional(),
});

/** Per-stage defaults; every value can be overridden with STAGE_<NAME>_<SETTING>. */
const STAGE_DEFAULTS: Record<StageName, { maxTurns: number; timeoutMinutes: number }> = {
  generate: { maxTurns: 150, timeoutMinutes: 60 },
  validate: { maxTurns: 60, timeoutMinutes: 30 },
  deploy: { maxTurns: 80, timeoutMinutes: 45 },
};

function loadStageConfig(
  name: StageName,
  env: Record<string, string | undefined>,
  model: string,
  effort: StageConfig["effort"],
): StageConfig {
  const prefix = `STAGE_${name.toUpperCase()}_`;
  const schema = z.object({
    MODEL: z.string().min(1).optional(),
    EFFORT: effortSchema.optional(),
    MAX_TURNS: z.coerce.number().int().positive().optional(),
    MAX_BUDGET_USD: optionalNumber,
    TIMEOUT_MINUTES: optionalNumber,
  });
  const raw = Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.startsWith(prefix) && value !== "")
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
  const result = schema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${prefix}${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${messages}`);
  }
  const parsed = result.data;
  return {
    model: parsed.MODEL ?? model,
    effort: parsed.EFFORT ?? effort,
    maxTurns: parsed.MAX_TURNS ?? STAGE_DEFAULTS[name].maxTurns,
    maxBudgetUsd: parsed.MAX_BUDGET_USD,
    timeoutMinutes: parsed.TIMEOUT_MINUTES ?? STAGE_DEFAULTS[name].timeoutMinutes,
  };
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  // Treat empty strings as unset so `KEY=` in .env falls back to the default.
  const nonEmpty = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ""),
  );
  const result = envSchema.safeParse(nonEmpty);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${messages}`);
  }

  const parsed = result.data;
  const workspaceOutputDir = parsed.WORKSPACE_OUTPUT_DIR;
  const stage = (name: StageName) =>
    loadStageConfig(name, env, parsed.CLAUDE_MODEL, parsed.CLAUDE_EFFORT);

  return {
    org: parsed.AZURE_DEVOPS_ORG,
    orgUrl: `https://dev.azure.com/${parsed.AZURE_DEVOPS_ORG}`,
    project: parsed.AZURE_DEVOPS_PROJECT,
    pat: parsed.AZURE_DEVOPS_PAT,
    pollIntervalMinutes: parsed.POLL_INTERVAL_MINUTES,
    dryRun: false,
    areaPath: parsed.AZURE_DEVOPS_AREA_PATH,
    createScriptTag: parsed.CREATE_SCRIPT_TAG,
    continiaBankingPath: parsed.CONTINIA_BANKING_PATH,
    continiaApiToken: parsed.CONTINIA_API_TOKEN,
    continiaCliPath: parsed.CONTINIA_CLI_PATH,
    envProfileId: parsed.CONTINIA_ENV_PROFILE_ID,
    envLocalization: parsed.CONTINIA_ENV_LOCALIZATION,
    envReadyTimeoutMinutes: parsed.ENV_READY_TIMEOUT_MINUTES,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    workspaceOutputDir,
    pteOutputDir: parsed.PTE_OUTPUT_DIR ?? workspaceOutputDir,
    lspPluginPath: parsed.LSP_PLUGIN_PATH,
    outputRetentionDays: parsed.OUTPUT_RETENTION_DAYS,
    watchConcurrency: parsed.WATCH_CONCURRENCY,
    stages: {
      generate: stage("generate"),
      validate: stage("validate"),
      deploy: stage("deploy"),
    },
  };
}
