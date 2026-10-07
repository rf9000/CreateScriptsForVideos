import type { AppConfig } from '../../src/types/index.ts';

/** A complete AppConfig for tests; override only what the test cares about. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    pollIntervalMinutes: 5,
    dryRun: false,
    areaPath: '',
    createScriptTag: 'create script',
    createVideoTag: 'create video',
    openaiApiKey: '',
    videoLocale: 'en-US',
    videoHeaded: false,
    continiaBankingPath: '/repos/banking',
    continiaApiToken: 'cont-token',
    continiaCliPath: 'continia',
    envProfileId: 'profile-1',
    envLocalization: 'base',
    envReadyTimeoutMinutes: 15,
    anthropicApiKey: '',
    workspaceOutputDir: '/work/output',
    pteOutputDir: '/work/pte',
    lspPluginPath: '',
    outputRetentionDays: 14,
    watchConcurrency: 1,
    stages: {
      generate: { model: 'gen-model', maxTurns: 150, timeoutMinutes: 60 },
      validate: { model: 'val-model', maxTurns: 60, timeoutMinutes: 30 },
      deploy: { model: 'dep-model', maxTurns: 80, timeoutMinutes: 45 },
    },
    ...overrides,
  };
}
