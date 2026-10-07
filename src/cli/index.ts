#!/usr/bin/env bun

import { loadConfig } from '../config/index.ts';
import { startWatcher, runPollCycle } from '../services/watcher.ts';
import { getWorkItem } from '../sdk/azure-devops-client.ts';
import { processItem } from '../services/processor.ts';

const HELP = `
Create Scripts For Videos — Azure DevOps work-item driven demo script generator

Usage:
  create-scripts <command>

Commands:
  watch            Start the long-running watcher (polls every N minutes)
  run-once         Run a single poll cycle and exit
  test-item <id>   Process a single work item (dry-run, no ADO writes)
  help             Show this help message

Options:
  --dry-run        Skip Azure DevOps writes. The pipeline still runs at full cost: it provisions a BC environment and publishes apps.
  --resume         (test-item) Continue from the item's saved pipeline state instead of starting over.

Environment variables:
  AZURE_DEVOPS_PAT          Azure DevOps personal access token (required)
  AZURE_DEVOPS_ORG          Azure DevOps organization name (required)
  AZURE_DEVOPS_PROJECT      Azure DevOps project name (required)
  AZURE_DEVOPS_AREA_PATH    Area path to scope work items (WIQL UNDER; optional)
  CREATE_SCRIPT_TAG         Tag that opts items in (default: "create script")
  CONTINIA_BANKING_PATH     Read-only continia-banking clone (LSP root)
  CONTINIA_API_TOKEN        DemoPortal API token for the continia CLI
  CONTINIA_CLI_PATH         continia CLI path or command (default: continia)
  CONTINIA_ENV_PROFILE_ID   Pin the DemoPortal profile (default: derived from continia-banking's app.json BC version)
  CONTINIA_ENV_LOCALIZATION Localization of the derived profile and banking country app (default: base)
  ENV_READY_TIMEOUT_MINUTES Max wait for a new environment to reach Running (default: 15)
  ANTHROPIC_API_KEY         Anthropic API key (optional; empty = Claude Code OAuth)
  WORKSPACE_OUTPUT_DIR      Writable dir for the generated .md script (default: ./output)
  PTE_OUTPUT_DIR            Writable dir for the generated PTE (default: WORKSPACE_OUTPUT_DIR)
  LSP_PLUGIN_PATH           Local path to the LSP plugin loaded into the agent
  POLL_INTERVAL_MINUTES     Polling interval (default: 5)
  WATCH_CONCURRENCY         Max items processed in parallel per cycle (default: 1; >1 unverified — skills may contend on shared repo state)
  CLAUDE_MODEL              Default model for every agent stage (default: claude-sonnet-4-6)
  CLAUDE_EFFORT             Default effort for every agent stage: low|medium|high|xhigh|max (default: model default)
  STAGE_<S>_MODEL           Per-stage overrides, <S> = GENERATE | VALIDATE | DEPLOY:
  STAGE_<S>_EFFORT            model, effort, max turns, USD budget cap, timeout.
  STAGE_<S>_MAX_TURNS         Defaults: turns 150/60/80, timeout 60/30/45 min, no budget cap.
  STAGE_<S>_MAX_BUDGET_USD
  STAGE_<S>_TIMEOUT_MINUTES
`.trim();

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

switch (command) {
  case 'watch': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun)
      console.log(
        '[DRY RUN] Azure DevOps writes are skipped — the pipeline still runs at full cost (provisions an environment, publishes apps)\n',
      );
    await startWatcher(config);
    break;
  }

  case 'run-once': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun)
      console.log(
        '[DRY RUN] Azure DevOps writes are skipped — the pipeline still runs at full cost (provisions an environment, publishes apps)\n',
      );
    const result = await runPollCycle(config);
    console.log(
      `Done: ${result.processed} processed, ${result.errors} errors, ` +
        `$${result.costUsd.toFixed(4)} total cost`,
    );
    break;
  }

  case 'test-item': {
    const itemIdArg = process.argv[3];
    if (!itemIdArg || isNaN(Number(itemIdArg))) {
      console.error('Usage: create-scripts test-item <work-item-id> [--resume]');
      process.exitCode = 1;
      break;
    }
    const config = loadConfig();
    config.dryRun = true;
    console.log(
      `[DRY RUN] Testing processing for work item #${itemIdArg} (no ADO writes; pipeline runs at full cost)\n`,
    );
    const item = await getWorkItem(config, Number(itemIdArg));
    const result = await processItem(config, item, undefined, {
      resume: process.argv.includes('--resume'),
    });
    console.log(
      `\nDone: ${result.processed ? 'processed' : 'failed'}` +
        `${result.error ? ` (${result.error})` : ''} — $${(result.costUsd ?? 0).toFixed(4)}`,
    );
    break;
  }

  case 'help':
  default:
    console.log(HELP);
    break;
}
