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
  test-item <id>   Process a single work item (dry-run, no writes)
  help             Show this help message

Options:
  --dry-run        Skip Azure DevOps writes. The agent still runs at full cost: it provisions a BC environment and publishes apps.

Environment variables:
  AZURE_DEVOPS_PAT          Azure DevOps personal access token (required)
  AZURE_DEVOPS_ORG          Azure DevOps organization name (required)
  AZURE_DEVOPS_PROJECT      Azure DevOps project name (required)
  AZURE_DEVOPS_AREA_PATH    Area path to scope work items (WIQL UNDER; optional)
  CREATE_SCRIPT_TAG         Tag that opts items in (default: "create script")
  CONTINIA_BANKING_PATH     Read-only continia-banking clone (LSP root)
  ANTHROPIC_API_KEY         Anthropic API key (optional; empty = Claude Code OAuth)
  WORKSPACE_OUTPUT_DIR      Writable dir for the generated .md script (default: ./output)
  PTE_OUTPUT_DIR            Writable dir for the generated PTE (default: WORKSPACE_OUTPUT_DIR)
  LSP_PLUGIN_PATH           Local path to the LSP plugin loaded into the agent
  POLL_INTERVAL_MINUTES     Polling interval (default: 5)
  AGENT_MAX_TURNS           Max agentic turns per item (default: 200)
  CLAUDE_MODEL              Claude model to use (default: claude-sonnet-4-6)
  PROMPT_PATH               Orchestration prompt (default: .claude/commands/create-script.md)
`.trim();

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

switch (command) {
  case 'watch': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun)
      console.log(
        '[DRY RUN] Azure DevOps writes are skipped — the agent still runs at full cost (provisions an environment, publishes apps)\n',
      );
    await startWatcher(config);
    break;
  }

  case 'run-once': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun)
      console.log(
        '[DRY RUN] Azure DevOps writes are skipped — the agent still runs at full cost (provisions an environment, publishes apps)\n',
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
      console.error('Usage: devops-pull test-item <work-item-id>');
      process.exitCode = 1;
      break;
    }
    const config = loadConfig();
    config.dryRun = true;
    console.log(
      `[DRY RUN] Testing processing for work item #${itemIdArg} (no ADO writes; agent runs at full cost)\n`,
    );
    const item = await getWorkItem(config, Number(itemIdArg));
    const result = await processItem(config, item);
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
