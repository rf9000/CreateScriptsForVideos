import { basename, extname } from 'path';
import type { WorkItemResponse } from '../types/index.ts';

/**
 * A local brief stands in for a work item, so the pipeline can run on a
 * feature description without Azure DevOps: the first `# heading` is the
 * title, the rest is the description.
 */
export type Brief = { id: number; title: string; description: string };

/** Ids for briefs live in 900,000,000+, far above real work-item ids, and are stable per file name. */
function idFor(fileName: string): number {
  let hash = 0;
  for (const ch of fileName) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 900_000_000 + (hash % 100_000_000);
}

export function parseBrief(text: string, fileName: string, id?: number): Brief {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headingAt = lines.findIndex((l) => /^#\s+\S/.test(l));
  const title = headingAt >= 0
    ? lines[headingAt]!.replace(/^#\s+/, '').trim()
    : basename(fileName, extname(fileName));
  const body = headingAt >= 0 ? [...lines.slice(0, headingAt), ...lines.slice(headingAt + 1)] : lines;
  return { id: id ?? idFor(basename(fileName)), title, description: body.join('\n').trim() };
}

/** The work-item shape processItem reads; no tags, so tag removal never targets ADO. */
export function briefWorkItem(brief: Brief): WorkItemResponse {
  return {
    id: brief.id,
    rev: 0,
    url: '',
    fields: {
      'System.Title': brief.title,
      'System.Description': brief.description,
      'System.WorkItemType': 'Brief',
      'System.Tags': '',
    },
  };
}
