import type { ContiniaCli, EnvProfile } from './continia-cli.ts';
import { satisfiesBcVersion, selectBcVersion } from '../utils/bc-version.ts';

/**
 * Pick the DemoPortal profile for a fresh environment: the lowest published BC
 * version that satisfies what continia-banking's app.json files require, in the
 * configured localization. Tracking app.json (not the newest catalogue entry)
 * keeps a newly published BC version from silently retargeting every demo.
 * Ported from DevOpsCoder's env-provision stage.
 */
export async function selectProfile(
  cli: ContiniaCli,
  requiredVersion: string,
  localization: string,
  warn: (message: string) => void = () => {},
): Promise<EnvProfile> {
  const available = await cli.listProfileVersions();
  const chosen = selectBcVersion(requiredVersion, available);
  if (!chosen) {
    throw new Error(
      `no DemoPortal profile version satisfies BC ${requiredVersion} required by continia-banking ` +
        `(available: ${available.join(', ') || 'none'}). Set CONTINIA_ENV_PROFILE_ID to pin one.`,
    );
  }

  // Re-check each row's version: the --bc-version filter is server-side, and an
  // unfiltered list would make an older profile look as valid as the right one.
  const profiles = (await cli.listProfiles(chosen)).filter(
    (p) => p.isEnabled && p.bcVersion !== '' && satisfiesBcVersion(requiredVersion, p.bcVersion),
  );

  const wanted = localization.trim().toLowerCase() || 'base';
  // Sorted by id so the choice is deterministic when a pair has several profiles.
  const matches = profiles
    .filter((p) => p.localization.toLowerCase() === wanted)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (matches.length > 1) {
    warn(`BC ${chosen} has ${matches.length} enabled '${wanted}' profiles; taking the lowest id`);
  }
  const match = matches[0];
  if (!match) {
    const have = [...new Set(profiles.map((p) => p.localization || '?'))].sort().join(', ');
    throw new Error(
      `BC ${chosen} has no enabled '${wanted}' profile (available: ${have || 'none'}). ` +
        `Set CONTINIA_ENV_LOCALIZATION to one of those, or CONTINIA_ENV_PROFILE_ID to pin a profile.`,
    );
  }
  return match;
}
