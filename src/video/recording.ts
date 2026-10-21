import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

/** One step of a BC Page Scripting recording (only the fields we read are typed). */
export type RecordingStep = {
  type: string;
  target?: Array<Record<string, unknown>>;
  source?: { page?: string };
  runtimeId?: string;
  value?: unknown;
  description?: string;
  [k: string]: unknown;
};

export type Recording = {
  name?: string;
  description: string;
  start?: Record<string, unknown>;
  steps: RecordingStep[];
};

/** Which FastTab holds each field, by control name (from the AL page source). */
export type StagingHints = { fieldGroups?: Record<string, string> };

/** Narration text per top-level recording step index. */
export type Narration = Record<number, string>;

// From BC's recorder; set-current-row picks a list row, page-closed follows a lookup's OK.
const KNOWN_TYPES = new Set([
  'navigate', 'page-shown', 'page-closed', 'set-current-row', 'filter', 'input', 'focus', 'invoke', 'validate', 'wait', 'scope', 'include',
]);

/** Problems that would make BC's engine skip or misreport steps. Empty = fine. */
export function lintRecording(rec: Recording): string[] {
  const problems: string[] = [];
  const runtimeIds = new Set<string>();
  // BC's recorder refers to the page that was open when recording started (the start page) by a
  // runtimeRef that no page-shown defines; the first step uses it.
  const startRef = rec.steps[0]?.type !== 'page-shown' ? rec.steps[0]?.target?.[0]?.['runtimeRef'] : undefined;
  if (typeof startRef === 'string') runtimeIds.add(startRef);
  rec.steps.forEach((step, i) => {
    if (!KNOWN_TYPES.has(step.type)) problems.push(`step ${i}: unknown step type "${step.type}"`);
    if (step.type === 'page-shown' && typeof step.runtimeId === 'string') runtimeIds.add(step.runtimeId);
    for (const t of step.target ?? []) {
      const ref = t['runtimeRef'];
      if (typeof ref === 'string' && !runtimeIds.has(ref)) {
        problems.push(`step ${i}: runtimeRef "${ref}" has no earlier page-shown runtimeId`);
      }
    }
    if ((step.type === 'input' || step.type === 'validate') && step.value === undefined) {
      problems.push(`step ${i}: ${step.type} step has no value`);
    }
  });
  // A flow that ends on a link out of BC (a bank's login opened by a drill-down) has no outcome
  // left to validate inside BC.
  const last = rec.steps.at(-1);
  const endsOnLinkOut = last?.type === 'invoke' && last['invokeType'] === 'DrillDown';
  if (!endsOnLinkOut && !rec.steps.some((s) => s.type === 'validate')) {
    problems.push('no validate step: the recording must prove the demo outcome');
  }
  return problems;
}

/** Read recording.yml (required), recording.staging.yml and narration.yml (optional) from an item folder. */
export function loadVideoInputs(dir: string): { recording: Recording; hints: StagingHints; narration: Narration } {
  const recordingPath = join(dir, 'recording.yml');
  if (!existsSync(recordingPath)) throw new Error(`recording.yml not found in ${dir}`);
  const recording = parse(readFileSync(recordingPath, 'utf-8')) as Recording;

  const hintsPath = join(dir, 'recording.staging.yml');
  const hints = existsSync(hintsPath) ? ((parse(readFileSync(hintsPath, 'utf-8')) as StagingHints) ?? {}) : {};

  const narration: Narration = {};
  const narrationPath = join(dir, 'narration.yml');
  if (existsSync(narrationPath)) {
    const raw = (parse(readFileSync(narrationPath, 'utf-8')) as { steps?: Record<string, unknown> })?.steps ?? {};
    for (const [key, text] of Object.entries(raw)) {
      const index = Number(key);
      if (Number.isInteger(index) && typeof text === 'string' && text.trim()) narration[index] = text.trim();
    }
  }
  return { recording, hints, narration };
}
