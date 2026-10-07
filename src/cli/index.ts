#!/usr/bin/env bun

import { loadConfig } from '../config/index.ts';
import { startWatcher, runPollCycle } from '../services/watcher.ts';
import { getWorkItem } from '../sdk/azure-devops-client.ts';
import { processItem, defaultProcessorDeps } from '../services/processor.ts';
import { briefWorkItem, parseBrief } from '../services/brief.ts';
import { describePage, loadSymbolIndex } from '../video/symbols.ts';
import { checkRecording, symbolDirsFor } from '../video/recording-check.ts';
import { existsSync, readFileSync } from 'fs';

const HELP = `
Create Scripts For Videos — Azure DevOps work-item driven demo script generator

Usage:
  create-scripts <command>

Commands:
  watch            Start the long-running watcher (polls every N minutes)
  run-once         Run a single poll cycle and exit
  test-item <id>   Process a single work item (dry-run, no ADO writes)
  test-item --brief <file.md> [--id <n>]
                   Process a local brief instead (# Title, then description); no ADO at all
  symbols <pte-folder> <page>
                   List a page's real field/action/repeater names (from the PTE's symbols)
  recording-check <item-folder> <pte-folder>
                   Check recording.yml steps and names; write FastTab hints when clean
  help             Show this help message

Options:
  --dry-run        Skip Azure DevOps writes. The pipeline still runs at full cost: it provisions a BC environment and publishes apps.
  --resume         (test-item) Continue from the item's saved pipeline state instead of starting over.
  --video          (test-item) Also record the demo video, as if the item were tagged create video.

Environment variables:
  AZURE_DEVOPS_PAT          Azure DevOps personal access token (required)
  AZURE_DEVOPS_ORG          Azure DevOps organization name (required)
  AZURE_DEVOPS_PROJECT      Azure DevOps project name (required)
  AZURE_DEVOPS_AREA_PATH    Area path to scope work items (WIQL UNDER; optional)
  CREATE_SCRIPT_TAG         Tag that opts items in (default: "create script")
  CREATE_VIDEO_TAG          Tag that also records a demo video (default: "create video")
  OPENAI_API_KEY            OpenAI key for video narration (required for video items)
  VIDEO_LOCALE              Narration locale (default: en-US)
  VIDEO_HEADED              Show the browser while recording (default: false)
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
    const briefIndex = process.argv.indexOf('--brief');
    const briefPath = briefIndex >= 0 ? process.argv[briefIndex + 1] : undefined;
    const itemIdArg = process.argv[3];
    const options = {
      resume: process.argv.includes('--resume'),
      ...(process.argv.includes('--video') ? { mode: 'video' as const } : {}),
    };
    let result;
    if (briefPath) {
      // Local brief: no Azure DevOps reads or writes at all.
      if (!existsSync(briefPath)) {
        console.error(`Brief not found: ${briefPath}`);
        process.exitCode = 1;
        break;
      }
      const idIndex = process.argv.indexOf('--id');
      const id = idIndex >= 0 ? Number(process.argv[idIndex + 1]) : undefined;
      const brief = parseBrief(readFileSync(briefPath, 'utf-8'), briefPath, id);
      const config = loadConfig(process.env, { requireAdo: false });
      config.dryRun = true;
      console.log(`[DRY RUN] Testing brief "${brief.title}" as item #${brief.id} (no ADO; pipeline runs at full cost)\n`);
      result = await processItem(
        config,
        briefWorkItem(brief),
        { ...defaultProcessorDeps, fetchComments: async () => [] },
        options,
      );
    } else {
      if (!itemIdArg || isNaN(Number(itemIdArg))) {
        console.error('Usage: create-scripts test-item <work-item-id> | --brief <file.md> [--id <n>] [--resume] [--video]');
        process.exitCode = 1;
        break;
      }
      const config = loadConfig();
      config.dryRun = true;
      console.log(
        `[DRY RUN] Testing processing for work item #${itemIdArg} (no ADO writes; pipeline runs at full cost)\n`,
      );
      const item = await getWorkItem(config, Number(itemIdArg));
      result = await processItem(config, item, undefined, options);
    }
    console.log(
      `\nDone: ${result.processed ? 'processed' : 'failed'}` +
        `${result.error ? ` (${result.error})` : ''} — $${(result.costUsd ?? 0).toFixed(4)}`,
    );
    break;
  }

  case 'symbols': {
    // For the recording agent: real names of a page, from the PTE's symbol packages.
    const [ptePath, pageName] = [process.argv[3], process.argv.slice(4).join(' ')];
    if (!ptePath || !pageName) {
      console.error('Usage: create-scripts symbols <pte-folder> <page name>');
      process.exitCode = 1;
      break;
    }
    console.log(describePage(loadSymbolIndex(symbolDirsFor(ptePath)), pageName));
    break;
  }

  case 'recording-check': {
    // For the recording agent: structure + names; writes FastTab hints when clean.
    const [itemDir, ptePath] = [process.argv[3], process.argv[4]];
    if (!itemDir || !ptePath) {
      console.error('Usage: create-scripts recording-check <item-folder> <pte-folder>');
      process.exitCode = 1;
      break;
    }
    const problems = checkRecording(itemDir, loadSymbolIndex(symbolDirsFor(ptePath)));
    if (problems.length) {
      console.log(`recording.yml has ${problems.length} problem(s):`);
      for (const p of problems) console.log(`- ${p}`);
      process.exitCode = 1;
    } else {
      console.log('recording.yml OK: all steps and names check out; recording.staging.yml written.');
    }
    break;
  }

  case 'help':
  default:
    console.log(HELP);
    break;
}
