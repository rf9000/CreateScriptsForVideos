import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * The identity continia-banking's app.json lists in `internalsVisibleTo`. An app
 * with this id, name and publisher sees the `Access = Internal` CTS-* objects, so
 * the PTE takes it. It is not an app to install or depend on: none is published.
 */
export const INTERNAL_ACCESS_IDENTITY = {
  id: '6e549e35-d1b2-4878-a37a-a736c22f35bf',
  name: 'Continia Banking Internal Access',
  publisher: 'Continia Software Partner',
} as const;

interface AppJson {
  id?: unknown;
  name?: unknown;
  publisher?: unknown;
  dependencies?: Array<{ id?: unknown }>;
  [key: string]: unknown;
}

/**
 * Give the PTE's app.json the Internal Access identity and drop any dependency on
 * that id, whatever the agent wrote. Returns what it changed (empty when nothing).
 */
export function enforcePteIdentity(
  ptePath: string,
  io: { read: (path: string) => string; write: (path: string, text: string) => void } = {
    read: (path) => readFileSync(path, 'utf-8'),
    write: (path, text) => writeFileSync(path, text),
  },
): string[] {
  const path = join(ptePath, 'app.json');
  const app = JSON.parse(io.read(path).replace(/^﻿/, '')) as AppJson;
  const changes: string[] = [];
  for (const key of ['id', 'name', 'publisher'] as const) {
    if (app[key] !== INTERNAL_ACCESS_IDENTITY[key]) {
      changes.push(`${key} ${JSON.stringify(app[key] ?? null)} -> ${JSON.stringify(INTERNAL_ACCESS_IDENTITY[key])}`);
      app[key] = INTERNAL_ACCESS_IDENTITY[key];
    }
  }
  const deps = app.dependencies ?? [];
  const kept = deps.filter((d) => String(d.id).toLowerCase() !== INTERNAL_ACCESS_IDENTITY.id);
  if (kept.length !== deps.length) {
    changes.push('removed the dependency on Continia Banking Internal Access');
    app.dependencies = kept;
  }
  if (changes.length) io.write(path, `${JSON.stringify(app, null, 2)}\n`);
  return changes;
}
