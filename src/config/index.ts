import { z } from "zod";
import type { AppConfig } from "../types/index.ts";

const DEFAULT_WIQL = "SELECT [System.Id] FROM workitems WHERE [System.State] = 'New' ORDER BY [System.CreatedDate] DESC";

const envSchema = z.object({
  AZURE_DEVOPS_PAT: z.string().min(1, "AZURE_DEVOPS_PAT is required"),
  AZURE_DEVOPS_ORG: z.string().min(1, "AZURE_DEVOPS_ORG is required"),
  AZURE_DEVOPS_PROJECT: z.string().min(1, "AZURE_DEVOPS_PROJECT is required"),
  AZURE_DEVOPS_WIQL_QUERY: z.string().default(DEFAULT_WIQL),
  AZURE_DEVOPS_AREA_PATH: z.string().default(""),
  CREATE_SCRIPT_TAG: z.string().default("create script"),
  CONTINIA_BANKING_PATH: z.string().default("./continia-banking"),
  CONTINIA_API_TOKEN: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  WORKSPACE_OUTPUT_DIR: z.string().default("./output"),
  PTE_OUTPUT_DIR: z.string().optional(),
  LSP_PLUGIN_PATH: z.string().default(""),
  POLL_INTERVAL_MINUTES: z.coerce.number().default(5),
  AGENT_MAX_TURNS: z.coerce.number().default(120),
  OUTPUT_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-6"),
  PROMPT_PATH: z.string().default(".claude/commands/create-script.md"),
});

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${messages}`);
  }

  const parsed = result.data;
  const workspaceOutputDir = parsed.WORKSPACE_OUTPUT_DIR;

  return {
    org: parsed.AZURE_DEVOPS_ORG,
    orgUrl: `https://dev.azure.com/${parsed.AZURE_DEVOPS_ORG}`,
    project: parsed.AZURE_DEVOPS_PROJECT,
    pat: parsed.AZURE_DEVOPS_PAT,
    wiqlQuery: parsed.AZURE_DEVOPS_WIQL_QUERY,
    pollIntervalMinutes: parsed.POLL_INTERVAL_MINUTES,
    claudeModel: parsed.CLAUDE_MODEL,
    promptPath: parsed.PROMPT_PATH,
    dryRun: false,
    areaPath: parsed.AZURE_DEVOPS_AREA_PATH,
    createScriptTag: parsed.CREATE_SCRIPT_TAG,
    continiaBankingPath: parsed.CONTINIA_BANKING_PATH,
    continiaApiToken: parsed.CONTINIA_API_TOKEN,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    workspaceOutputDir,
    pteOutputDir: parsed.PTE_OUTPUT_DIR ?? workspaceOutputDir,
    lspPluginPath: parsed.LSP_PLUGIN_PATH,
    agentMaxTurns: parsed.AGENT_MAX_TURNS,
    outputRetentionDays: parsed.OUTPUT_RETENTION_DAYS,
  };
}
