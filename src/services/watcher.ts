import type {
  AppConfig,
  WorkItemResponse,
  ItemProcessResult,
} from '../types/index.ts';
import * as sdk from '../sdk/azure-devops-client.ts';
import * as proc from './processor.ts';
import * as pruner from './pruner.ts';

export interface WatcherDeps {
  fetchItems: (config: AppConfig) => Promise<WorkItemResponse[]>;
  processItem: (
    config: AppConfig,
    item: WorkItemResponse,
  ) => Promise<ItemProcessResult>;
  /** Delete aged per-item output folders. Returns the count pruned. */
  pruneOutputs: (config: AppConfig) => number;
}

async function defaultFetchItems(config: AppConfig): Promise<WorkItemResponse[]> {
  return sdk.queryTaggedWorkItems(config);
}

const defaultDeps: WatcherDeps = {
  fetchItems: defaultFetchItems,
  processItem: proc.processItem,
  pruneOutputs: pruner.pruneOldOutputs,
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

/**
 * One poll cycle. The tag IS the work queue: discovery returns only tagged items,
 * and the processor removes the tag after every attempt — so there's no processed
 * state to track. Re-tagging an item is how you request it again.
 */
export async function runPollCycle(
  config: AppConfig,
  deps: WatcherDeps = defaultDeps,
): Promise<{ processed: number; errors: number; costUsd: number }> {
  let totalProcessed = 0;
  let totalErrors = 0;
  let totalCostUsd = 0;

  log('Polling for tagged items...');
  const items = await deps.fetchItems(config);
  log(`  Found ${items.length} tagged item(s)`);

  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      try {
        const result = await deps.processItem(config, item);
        totalCostUsd += result.costUsd ?? 0;
        if (result.processed) totalProcessed++;
        else totalErrors++;
      } catch (err) {
        log(`  Item #${item.id}: Fatal error — ${err}`);
        totalErrors++;
      }
    }
  };
  const workerCount = Math.min(Math.max(1, config.watchConcurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (config.outputRetentionDays > 0) {
    const prunedCount = deps.pruneOutputs(config);
    if (prunedCount > 0) log(`  Pruned ${prunedCount} aged output folder(s)`);
  }

  return { processed: totalProcessed, errors: totalErrors, costUsd: totalCostUsd };
}

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise(resolve => {
    const checkInterval = 1000;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += checkInterval;
      if (signal.aborted || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, checkInterval);
  });
}

export async function startWatcher(config: AppConfig): Promise<void> {
  const signal = { aborted: false };

  const shutdown = () => {
    log('Shutting down...');
    signal.aborted = true;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`Starting watcher — polling every ${config.pollIntervalMinutes} minutes`);

  while (!signal.aborted) {
    try {
      const result = await runPollCycle(config);
      log(
        `Cycle complete: ${result.processed} processed, ${result.errors} errors, ` +
          `$${result.costUsd.toFixed(4)} total cost`,
      );
    } catch (err) {
      log(`Cycle failed: ${err}`);
    }

    if (!signal.aborted) {
      log(`Sleeping ${config.pollIntervalMinutes} minutes...`);
      await sleep(config.pollIntervalMinutes * 60 * 1000, signal);
    }
  }

  log('Watcher stopped');
}
