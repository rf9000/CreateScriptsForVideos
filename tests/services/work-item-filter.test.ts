import { describe, expect, test } from 'bun:test';
import type { WorkItemResponse } from '../../src/types/index.ts';
import { linksRepo } from '../../src/services/work-item-filter.ts';

const REPO_ID = 'a838fce3-3b9c-4c78-beec-cb4cf5983144';
const PROJECT_ID = '11111111-2222-3333-4444-555555555555';

function itemWithRelations(
  relations: WorkItemResponse['relations'],
): WorkItemResponse {
  return { id: 1, fields: {}, rev: 1, url: 'u', relations };
}

describe('linksRepo', () => {
  test('matches a branch artifact link referencing the repo id', () => {
    const item = itemWithRelations([
      {
        rel: 'ArtifactLink',
        url: `vstfs:///Git/Ref/${PROJECT_ID}%2F${REPO_ID}%2FGBmain`,
        attributes: { name: 'Branch' },
      },
    ]);
    expect(linksRepo(item, [REPO_ID])).toBe(true);
  });

  test('matches a commit artifact link referencing the repo id', () => {
    const item = itemWithRelations([
      {
        rel: 'ArtifactLink',
        url: `vstfs:///Git/Commit/${PROJECT_ID}%2F${REPO_ID}%2Fabc123`,
        attributes: { name: 'Fixed in Commit' },
      },
    ]);
    expect(linksRepo(item, [REPO_ID])).toBe(true);
  });

  test('does not match when the repo id is absent', () => {
    const item = itemWithRelations([
      {
        rel: 'ArtifactLink',
        url: `vstfs:///Git/Ref/${PROJECT_ID}%2F99999999-0000-0000-0000-000000000000%2FGBmain`,
        attributes: { name: 'Branch' },
      },
    ]);
    expect(linksRepo(item, [REPO_ID])).toBe(false);
  });

  test('ignores non-ArtifactLink relations', () => {
    const item = itemWithRelations([
      { rel: 'AttachedFile', url: `https://x/${REPO_ID}`, attributes: {} },
    ]);
    expect(linksRepo(item, [REPO_ID])).toBe(false);
  });

  test('returns false when there are no relations', () => {
    expect(linksRepo(itemWithRelations(undefined), [REPO_ID])).toBe(false);
    expect(linksRepo(itemWithRelations([]), [REPO_ID])).toBe(false);
  });

  test('matches when any of several repo ids is referenced', () => {
    const item = itemWithRelations([
      {
        rel: 'ArtifactLink',
        url: `vstfs:///Git/Ref/${PROJECT_ID}%2F${REPO_ID}%2FGBmain`,
        attributes: { name: 'Branch' },
      },
    ]);
    expect(linksRepo(item, ['other-id', REPO_ID])).toBe(true);
  });

  test('returns true for every item when the repo id list is empty (no filter)', () => {
    expect(linksRepo(itemWithRelations(undefined), [])).toBe(true);
  });

  test('is case-insensitive on the repo GUID', () => {
    const item = itemWithRelations([
      {
        rel: 'ArtifactLink',
        url: `vstfs:///Git/Ref/${PROJECT_ID}%2F${REPO_ID.toUpperCase()}%2FGBmain`,
        attributes: { name: 'Branch' },
      },
    ]);
    expect(linksRepo(item, [REPO_ID])).toBe(true);
  });
});
