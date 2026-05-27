import type { WorkItemResponse } from '../types/index.ts';

/**
 * True if the work item is linked to one of the given Git repos.
 *
 * Azure DevOps encodes the repo in `ArtifactLink` relations as a vstfs URI like
 * `vstfs:///Git/Ref/{projectId}%2F{repoId}%2F{branch}` (branches) or
 * `vstfs:///Git/Commit/{projectId}%2F{repoId}%2F{commitId}` (commits). We match
 * the repo GUID anywhere in those URIs, case-insensitively.
 *
 * An empty `repoIds` list disables the filter (every item matches).
 */
export function linksRepo(
  item: WorkItemResponse,
  repoIds: string[],
): boolean {
  if (repoIds.length === 0) return true;

  const needles = repoIds.map((id) => id.toLowerCase());
  const artifactUrls = (item.relations ?? [])
    .filter((r) => r.rel === 'ArtifactLink')
    .map((r) => r.url.toLowerCase());

  return artifactUrls.some((url) =>
    needles.some((id) => url.includes(id)),
  );
}
