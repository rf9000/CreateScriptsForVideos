import { writeFileSync } from 'fs';
import { join } from 'path';
import { stringify } from 'yaml';
import { lintRecording, loadVideoInputs } from './recording.ts';
import { fieldGroupsFor, lintRecordingNames } from './symbols.ts';
import type { SymbolIndex } from './symbols.ts';

/** Where a PTE's symbols live: its own folder (its pages) and .alpackages (everything it builds against). */
export function symbolDirsFor(ptePath: string): string[] {
  return [join(ptePath, '.alpackages'), ptePath];
}

/**
 * Full pre-recording check: step structure plus every page/field/action/repeater
 * name against the symbols. When clean, writes recording.staging.yml (FastTab
 * hints) from the symbols, so nobody has to author it. Returns the problems.
 */
export function checkRecording(itemDir: string, index: SymbolIndex): string[] {
  let recording;
  try {
    recording = loadVideoInputs(itemDir).recording;
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
  const problems = [...lintRecording(recording), ...lintRecordingNames(recording, index)];
  if (problems.length === 0) {
    writeFileSync(join(itemDir, 'recording.staging.yml'), stringify(fieldGroupsFor(recording, index)));
  }
  return problems;
}
