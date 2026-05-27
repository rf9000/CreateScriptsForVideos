/** Application configuration loaded from environment variables. */
export interface AppConfig {
  org: string;
  orgUrl: string;
  project: string;
  pat: string;
  wiqlQuery: string;
  pollIntervalMinutes: number;
  claudeModel: string;
  promptPath: string;
  stateDir: string;
  dryRun: boolean;
  /** Git repo GUIDs; only work items linked to one of these are processed. Empty = no repo filter. */
  repoIds: string[];
  /** Work-item tag that opts an item into script generation. */
  createScriptTag: string;
  /** Path to the read-only continia-banking clone (LSP navigation root). */
  continiaBankingPath: string;
  /** API token for continia.exe (passed as the global --token option). */
  continiaApiToken: string;
  /** Writable root for the generated .md recording script. */
  workspaceOutputDir: string;
  /** Writable base path where the PTE AL project is created before publishing. */
  pteOutputDir: string;
  /** Local path to the marketplace LSP plugin loaded into the agent. */
  lspPluginPath: string;
  /** Max agentic turns for the orchestrator agent. */
  agentMaxTurns: number;
  /** Max processing attempts per work item before giving up. */
  maxProcessAttempts: number;
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

/** Persisted state tracking which items have already been processed. */
export interface ProcessedState {
  processedItemIds: number[];
  lastRunAt: string;
  /** Processing attempts per work item id (keyed by id as a string in JSON). */
  attempts?: Record<string, number>;
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
  /** USD cost reported by the agent run. */
  costUsd?: number;
}
