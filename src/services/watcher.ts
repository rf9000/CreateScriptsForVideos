import type {
  AppConfig,
  WorkItemResponse,
  ItemProcessResult,
} from '../types/index.ts';
import { StateStore } from '../state/state-store.ts';
import * as sdk from '../sdk/azure-devops-client.ts';
import * as proc from './processor.ts';

export interface WatcherDeps {
  fetchItems: (
    config: AppConfig,
  ) => Promise<WorkItemResponse[]>;

  processItem: (
    config: AppConfig,
    item: WorkItemResponse,
  ) => Promise<ItemProcessResult>;

  /** Called when an item has failed maxProcessAttempts times and is being abandoned. */
  notifyGaveUp?: (
    config: AppConfig,
    item: WorkItemResponse,
    attempts: number,
  ) => Promise<void>;
}

async function defaultFetchItems(config: AppConfig): Promise<WorkItemResponse[]> {
  const ids = await sdk.queryWorkItemsByTag(config);
  if (ids.length === 0) return [];
  return sdk.getWorkItemsBatch(config, ids);
}

async function defaultNotifyGaveUp(
  config: AppConfig,
  item: WorkItemResponse,
  attempts: number,
): Promise<void> {
  await sdk.addWorkItemComment(
    config,
    item.id,
    `<p>Script generation failed ${attempts} times and will not be retried automatically. ` +
      `Please review and <strong>re-tag</strong> the work item to try again.</p>`,
  );
  // Remove the tag so it stops being rediscovered; re-tagging is the retry signal
  // the comment above refers to.
  await sdk.removeTagFromWorkItem(config, item.id, config.createScriptTag);
}

const defaultDeps: WatcherDeps = {
  fetchItems: defaultFetchItems,
  processItem: proc.processItem,
  notifyGaveUp: defaultNotifyGaveUp,
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

export async function runPollCycle(
  config: AppConfig,
  stateStore: StateStore,
  deps: WatcherDeps = defaultDeps,
): Promise<{ processed: number; errors: number; costUsd: number }> {
  let totalProcessed = 0;
  let totalErrors = 0;
  let totalCostUsd = 0;

  log('Polling for items...');

  const items = await deps.fetchItems(config);
  const newItems = items.filter(item => !stateStore.isProcessed(item.id));

  log(`  Found ${items.length} items, ${newItems.length} unprocessed`);

  for (const item of newItems) {
    const attempts = stateStore.recordAttempt(item.id);
    let succeeded = false;

    try {
      const result = await deps.processItem(config, item);
      totalCostUsd += result.costUsd ?? 0;

      if (result.processed) {
        stateStore.markProcessed(item.id);
        totalProcessed++;
        succeeded = true;
      } else {
        totalErrors++;
      }
    } catch (err) {
      log(`  Item #${item.id}: Fatal error — ${err}`);
      totalErrors++;
    }

    if (!succeeded && attempts >= config.maxProcessAttempts) {
      log(`  Item #${item.id}: Giving up after ${attempts} attempts`);
      try {
        await (deps.notifyGaveUp ?? defaultNotifyGaveUp)(config, item, attempts);
      } catch (err) {
        log(`  Item #${item.id}: Failed to post give-up comment — ${err}`);
      }
      stateStore.markProcessed(item.id);
    }
  }

  stateStore.save();
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
  const stateStore = new StateStore(config.stateDir);
  const signal = { aborted: false };

  const shutdown = () => {
    log('Shutting down...');
    signal.aborted = true;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`Starting watcher — polling every ${config.pollIntervalMinutes} minutes`);
  log(`${stateStore.processedCount} items already processed`);

  while (!signal.aborted) {
    try {
      const result = await runPollCycle(config, stateStore);
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
