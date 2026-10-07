/** Application configuration loaded from environment variables. */
export interface AppConfig {
  org: string;
  orgUrl: string;
  project: string;
  pat: string;
  pollIntervalMinutes: number;
  dryRun: boolean;
  /** Area path to scope discovery to (WIQL `UNDER`, includes descendants). Empty = no area filter. */
  areaPath: string;
  /** Work-item tag that opts an item into script generation. */
  createScriptTag: string;
  /** Path to the read-only continia-banking clone (LSP navigation root). */
  continiaBankingPath: string;
  /** API token for continia.exe (passed as the global --token option). */
  continiaApiToken: string;
  /** Path or command name of the continia CLI (`continia` on PATH in Docker). */
  continiaCliPath: string;
  /** Pins the DemoPortal profile. Empty = derive it from continia-banking's app.json versions. */
  envProfileId: string;
  /** Localization of the derived profile and the banking country app (base, dk, nl, ...). */
  envLocalization: string;
  /** How long to wait for a new environment to reach Running. */
  envReadyTimeoutMinutes: number;
  /** Anthropic API key for the agent. Empty = use Claude Code OAuth (~/.claude) instead. */
  anthropicApiKey: string;
  /** Writable root for the generated .md recording script. */
  workspaceOutputDir: string;
  /** Writable base path where the PTE AL project is created before publishing. */
  pteOutputDir: string;
  /** Local path to the marketplace LSP plugin loaded into the agent. */
  lspPluginPath: string;
  /** Days to keep generated output/<id>/ folders before the watcher prunes them. 0 = never prune. */
  outputRetentionDays: number;
  /** Max work items processed in parallel per poll cycle. 1 = sequential (default). */
  watchConcurrency: number;
  /** Settings for each LLM stage of the pipeline. */
  stages: Record<StageName, StageConfig>;
}

/** The pipeline stages that run an agent. */
export type StageName = 'generate' | 'validate' | 'deploy';

/** Model and limits for one agent stage. */
export interface StageConfig {
  model: string;
  /** Reasoning effort. Undefined = the model's default. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns: number;
  /** Hard USD cap for the stage. Undefined = no cap. */
  maxBudgetUsd?: number;
  timeoutMinutes: number;
}

/** Cost and size of one agent stage run, for logging and the cost totals. */
export interface StageUsage {
  stage: StageName;
  model: string;
  costUsd: number;
  turns: number;
  durationMs: number;
}

/** A relation (link) on a work item, e.g. an ArtifactLink to a Git branch/commit. */
export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
}

/** Response shape when fetching a single work item. */
export interface WorkItemResponse {
  id: number;
  fields: Record<string, unknown>;
  rev: number;
  url: string;
  relations?: WorkItemRelation[];
}

/** Response shape from a WIQL query. */
export interface WiqlQueryResult {
  workItems: Array<{ id: number; url: string }>;
}

/** Result summary after processing a single item. */
export interface ItemProcessResult {
  itemId: number;
  processed: boolean;
  error?: string;
  /** USD cost of the agent work for this item. */
  costUsd?: number;
}

/** Connection details for a provisioned BC environment. */
export interface EnvDetails {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
}

/** Structured result returned by the orchestrator agent for one work item. */
export interface ScriptResult {
  status: 'success' | 'failed';
  feature?: string;
  /** Absolute path to the generated human-readable .md recording script. */
  scriptPath?: string;
  /** Absolute path to the generated PTE AL project folder. */
  ptePath?: string;
  env?: EnvDetails;
  assumptions?: string[];
  gaps?: string[];
  errorMessage?: string;
  /** Total USD cost of all agent stages. */
  costUsd?: number;
  /** Per-stage usage, in run order. */
  stages?: StageUsage[];
}
