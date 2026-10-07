import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { strFromU8, unzipSync } from 'fflate';
import type { Recording, StagingHints } from './recording.ts';

/**
 * Page names, field names, action names and repeaters exactly as Business
 * Central knows them, read from the compiled symbol packages (.app) the deploy
 * stage downloads (Microsoft base app included) and merged with page
 * extensions. Recordings must use these names, so a recording can be checked
 * before anything is recorded.
 */

export type PageSymbols = {
  id: number;
  name: string;
  /** Field control name -> caption (when the page sets one) and its FastTab. */
  fields: Map<string, { caption?: string; group?: string }>;
  actions: Map<string, { caption?: string }>;
  repeaters: Set<string>;
};

export type SymbolIndex = { pages: Map<string, PageSymbols> };

/** Actions BC generates itself; they are not declared in AL, so symbols don't list them. */
export const BUILT_IN_ACTIONS = new Set(['Control_New', 'Control_Edit', 'Control_Delete', 'Control_View', 'Control_Refresh']);

const KIND_GROUP = 1;
const KIND_REPEATER = 3;
const KIND_FIELD = 8;

type Json = Record<string, any>;

const captionOf = (node: Json): string | undefined =>
  (node['Properties'] as Json[] | undefined)?.find((p) => p['Name'] === 'Caption')?.['Value'];

/** SymbolReference.json from a .app (NAVX header, then a zip). */
export function readSymbolReference(app: Uint8Array): unknown {
  let start = -1;
  for (let i = 0; i < app.length - 3; i++) {
    if (app[i] === 0x50 && app[i + 1] === 0x4b && app[i + 2] === 0x03 && app[i + 3] === 0x04) {
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error('not a .app package (no zip content)');
  const files = unzipSync(app.subarray(start), { filter: (f) => f.name === 'SymbolReference.json' });
  const bytes = files['SymbolReference.json'];
  if (!bytes) throw new Error('package has no SymbolReference.json');
  let text = strFromU8(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

function collect(ns: Json, key: string, out: Json[]): void {
  for (const item of (ns[key] as Json[] | undefined) ?? []) out.push(item);
  for (const child of (ns['Namespaces'] as Json[] | undefined) ?? []) collect(child, key, out);
}

function addControls(page: PageSymbols, controls: Json[] | undefined, group?: string): void {
  for (const c of controls ?? []) {
    if (c['Kind'] === KIND_FIELD) page.fields.set(c['Name'], { caption: captionOf(c), group });
    if (c['Kind'] === KIND_REPEATER) page.repeaters.add(c['Name']);
    // The first group below the page root is the FastTab.
    const childGroup = group ?? (c['Kind'] === KIND_GROUP ? (captionOf(c) ?? c['Name']) : undefined);
    addControls(page, c['Controls'], childGroup);
  }
}

function addActions(page: PageSymbols, actions: Json[] | undefined): void {
  for (const a of actions ?? []) {
    if (a['Name']) page.actions.set(a['Name'], { caption: captionOf(a) });
    addActions(page, a['Actions']);
  }
}

/** Index pages from SymbolReference objects; page extensions are merged into their target pages. */
export function buildIndex(refs: unknown[]): SymbolIndex {
  const pages = new Map<string, PageSymbols>();
  const extensions: Json[] = [];
  for (const ref of refs as Json[]) {
    const found: Json[] = [];
    collect(ref, 'Pages', found);
    for (const p of found) {
      const page: PageSymbols = { id: p['Id'], name: p['Name'], fields: new Map(), actions: new Map(), repeaters: new Set() };
      addControls(page, p['Controls']);
      addActions(page, p['Actions']);
      pages.set(String(p['Name']).toLowerCase(), page);
    }
    collect(ref, 'PageExtensions', extensions);
  }
  for (const ext of extensions) {
    // TargetObject looks like "#<app hash>#Bank Account Card".
    const target = String(ext['TargetObject'] ?? '').split('#').pop()!.toLowerCase();
    const page = pages.get(target);
    if (!page) continue;
    for (const change of (ext['ControlChanges'] as Json[] | undefined) ?? []) {
      const anchor = String(change['Anchor'] ?? '');
      const group = page.fields.get(anchor)?.group ?? anchor;
      addControls(page, change['Controls'], group || undefined);
    }
    for (const change of (ext['ActionChanges'] as Json[] | undefined) ?? []) addActions(page, change['Actions']);
  }
  return { pages };
}

/** Index every .app in the given folders (missing folders are skipped). */
export function loadSymbolIndex(dirs: string[]): SymbolIndex {
  const refs: unknown[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.app'))) {
      try {
        refs.push(readSymbolReference(new Uint8Array(readFileSync(join(dir, file)))));
      } catch {
        // runtime packages without symbols: skip
      }
    }
  }
  return buildIndex(refs);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** Closest real name: same caption, same name ignoring spaces/case, or a small typo. */
function suggest(wanted: string, candidates: Array<{ name: string; caption?: string }>): string | undefined {
  const w = squash(wanted);
  const byCaption = candidates.find((c) => c.caption && squash(c.caption) === w);
  if (byCaption) return byCaption.name;
  const bySquash = candidates.find((c) => squash(c.name) === w);
  if (bySquash) return bySquash.name;
  let best: { name: string; d: number } | undefined;
  for (const c of candidates) {
    const d = distance(w, squash(c.name));
    if (d <= 3 && (!best || d < best.d)) best = { name: c.name, d };
  }
  return best?.name;
}

const hint = (s?: string) => (s ? ` (did you mean "${s}"?)` : '');

/** Names in a recording that BC won't find. Empty = all names exist. */
export function lintRecordingNames(rec: Recording, index: SymbolIndex): string[] {
  const problems: string[] = [];
  const allPages = [...index.pages.values()].map((p) => ({ name: p.name }));
  rec.steps.forEach((step, i) => {
    if (step.type === 'page-shown') {
      const name = step.source?.page;
      // Dialogs (confirmations, system pages) are not all in the symbols.
      if (name && step['modal'] !== true && !index.pages.has(name.toLowerCase())) {
        problems.push(`step ${i}: page "${name}" not found in the symbols${hint(suggest(name, allPages))}`);
      }
      return;
    }
    const pageName = step.target?.find((t) => t['page'])?.['page'] as string | undefined;
    if (!pageName) return;
    const page = index.pages.get(pageName.toLowerCase());
    if (!page) {
      problems.push(`step ${i}: page "${pageName}" not found in the symbols${hint(suggest(pageName, allPages))}`);
      return;
    }
    for (const t of step.target ?? []) {
      const field = t['field'] as string | undefined;
      const action = t['action'] as string | undefined;
      const repeater = t['repeater'] as string | undefined;
      if (field && t['scope'] !== 'filter' && !page.fields.has(field)) {
        const cands = [...page.fields].map(([name, f]) => ({ name, caption: f.caption }));
        problems.push(`step ${i}: field "${field}" is not on page "${page.name}"${hint(suggest(field, cands))}`);
      }
      if (action && !page.actions.has(action) && !BUILT_IN_ACTIONS.has(action)) {
        const cands = [...page.actions].map(([name, a]) => ({ name, caption: a.caption }));
        problems.push(`step ${i}: action "${action}" is not on page "${page.name}"${hint(suggest(action, cands))}`);
      }
      if (repeater && !page.repeaters.has(repeater)) {
        problems.push(`step ${i}: repeater "${repeater}" is not on page "${page.name}"${hint(suggest(repeater, [...page.repeaters].map((name) => ({ name }))))}`);
      }
    }
  });
  return problems;
}

/** FastTab of every field the recording touches, for the staging layer. */
export function fieldGroupsFor(rec: Recording, index: SymbolIndex): StagingHints {
  const fieldGroups: Record<string, string> = {};
  for (const step of rec.steps) {
    const pageName = step.target?.find((t) => t['page'])?.['page'] as string | undefined;
    const field = step.target?.find((t) => t['field'])?.['field'] as string | undefined;
    if (!pageName || !field) continue;
    const group = index.pages.get(pageName.toLowerCase())?.fields.get(field)?.group;
    if (group) fieldGroups[field] = group;
  }
  return { fieldGroups };
}

/** A page's real names with captions, for the agent writing the recording. */
export function describePage(index: SymbolIndex, name: string): string {
  const page = index.pages.get(name.toLowerCase());
  if (!page) {
    const s = suggest(name, [...index.pages.values()].map((p) => ({ name: p.name })));
    return `page "${name}" not found in the symbols${hint(s)}`;
  }
  const q = (c?: string) => (c ? `  "${c}"` : '');
  const lines = [`${page.name} (page ${page.id})`];
  for (const r of page.repeaters) lines.push(`repeater ${r}`);
  for (const [n, f] of page.fields) lines.push(`field ${n}${q(f.caption)}${f.group ? `  [FastTab: ${f.group}]` : ''}`);
  for (const [n, a] of page.actions) lines.push(`action ${n}${q(a.caption)}`);
  lines.push(`built-in actions: ${[...BUILT_IN_ACTIONS].join(', ')}`);
  return lines.join('\n');
}
