#!/usr/bin/env bun
/**
 * Discovery-only diagnostic: runs the same pipeline the watcher uses to find
 * work items (tag CONTAINS -> exact tag match + area-path UNDER) and prints what
 * survives. Does NOT process anything (no agent, no env, no writes).
 *
 *   bun scripts/diagnose-discovery.ts
 *
 * Requires a local .env with at least AZURE_DEVOPS_PAT/ORG/PROJECT (and
 * AZURE_DEVOPS_AREA_PATH / CREATE_SCRIPT_TAG to mirror prod).
 */
import { loadConfig } from '../src/config/index.ts';
import {
  queryWorkItems,
  queryTaggedWorkItems,
  getWorkItemsBatch,
} from '../src/sdk/azure-devops-client.ts';

const config = loadConfig();

console.log('=== config ===');
console.log(`org        : ${config.org}`);
console.log(`project    : "${config.project}"`);
console.log(`tag        : "${config.createScriptTag}"`);
console.log(`areaPath   : ${config.areaPath ? `"${config.areaPath}"` : '(none — area filter disabled)'}`);
console.log();

// Stage 1 — tag only, ignoring area scope: everything tagged in the project.
const tagOnlyIds = await queryWorkItems(
  config,
  `SELECT [System.Id] FROM workitems WHERE [System.Tags] CONTAINS '${config.createScriptTag}'`,
);
console.log(`Stage 1 — tag CONTAINS (project-wide, ignores area): ${tagOnlyIds.length}`);
if (tagOnlyIds.length) console.log(`  ids: ${tagOnlyIds.join(', ')}`);
console.log();

// Stage 2 — the watcher's real query: exact tag match + area UNDER.
const discoveredIds = (await queryTaggedWorkItems(config)).map((i) => i.id);
console.log(`Stage 2 — watcher query (exact tag${config.areaPath ? ' + area UNDER' : ''}): ${discoveredIds.length}`);
if (discoveredIds.length) console.log(`  ids: ${discoveredIds.join(', ')}`);
console.log();

// Per-item detail for every tag candidate, flagging which survive Stage 2.
if (tagOnlyIds.length) {
  const discovered = new Set(discoveredIds);
  const items = await getWorkItemsBatch(config, tagOnlyIds);
  console.log('Per-item detail (all tag candidates):');
  for (const item of items) {
    const tags = String(item.fields['System.Tags'] ?? '');
    const area = String(item.fields['System.AreaPath'] ?? '');
    console.log(`  #${item.id}  discovered=${discovered.has(item.id)}  area="${area}"  tags="${tags}"`);
  }
  console.log();
}

console.log(`=== FINAL: ${discoveredIds.length} item(s) the watcher would process ===`);
if (discoveredIds.length === 0) {
  if (tagOnlyIds.length === 0) {
    console.log(`No items carry the exact tag "${config.createScriptTag}". Check the tag text.`);
  } else if (config.areaPath) {
    console.log(`Items are tagged but none are UNDER area "${config.areaPath}". Check the area path,`);
    console.log('or clear AZURE_DEVOPS_AREA_PATH to process every tagged item.');
  }
}
