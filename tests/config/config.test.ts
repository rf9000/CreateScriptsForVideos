import { describe, expect, it } from "bun:test";
import { loadConfig } from "../../src/config/index.ts";

const validEnv: Record<string, string> = {
  AZURE_DEVOPS_PAT: "test-pat-token",
  AZURE_DEVOPS_ORG: "my-org",
  AZURE_DEVOPS_PROJECT: "my-project",
};

describe("loadConfig", () => {
  it("returns correct AppConfig for valid env", () => {
    const config = loadConfig(validEnv);

    expect(config.pat).toBe("test-pat-token");
    expect(config.org).toBe("my-org");
    expect(config.orgUrl).toBe("https://dev.azure.com/my-org");
    expect(config.project).toBe("my-project");
  });

  it("throws when AZURE_DEVOPS_PAT is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_PAT;
    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_ORG is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_ORG;
    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_PROJECT is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_PROJECT;
    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("applies default values when optional vars are absent", () => {
    const config = loadConfig(validEnv);

    expect(config.pollIntervalMinutes).toBe(5);
    expect(config.claudeModel).toBe("claude-sonnet-4-6");
    expect(config.promptPath).toBe(".claude/commands/create-script.md");
    expect(config.stateDir).toBe(".state");
  });

  it("uses default WIQL query when not provided", () => {
    const config = loadConfig(validEnv);
    expect(config.wiqlQuery).toContain("SELECT [System.Id] FROM workitems");
  });

  it("uses custom WIQL query when provided", () => {
    const env = {
      ...validEnv,
      AZURE_DEVOPS_WIQL_QUERY: "SELECT [System.Id] FROM workitems WHERE [System.State] = 'Active'",
    };
    const config = loadConfig(env);
    expect(config.wiqlQuery).toBe(
      "SELECT [System.Id] FROM workitems WHERE [System.State] = 'Active'",
    );
  });

  it("overrides defaults when optional vars are provided", () => {
    const env = {
      ...validEnv,
      POLL_INTERVAL_MINUTES: "30",
      CLAUDE_MODEL: "claude-opus-4-6",
      PROMPT_PATH: "custom/prompt.md",
      STATE_DIR: "/tmp/state",
    };

    const config = loadConfig(env);

    expect(config.pollIntervalMinutes).toBe(30);
    expect(config.claudeModel).toBe("claude-opus-4-6");
    expect(config.promptPath).toBe("custom/prompt.md");
    expect(config.stateDir).toBe("/tmp/state");
  });

  it("derives orgUrl from org name", () => {
    const env = { ...validEnv, AZURE_DEVOPS_ORG: "contoso" };
    const config = loadConfig(env);
    expect(config.orgUrl).toBe("https://dev.azure.com/contoso");
  });

  describe("script-generator config", () => {
    it("parses AZURE_DEVOPS_REPO_IDS into a trimmed array", () => {
      const env = {
        ...validEnv,
        AZURE_DEVOPS_REPO_IDS: "a838fce3-3b9c-4c78-beec-cb4cf5983144, 6e549e35-d1b2 ,  ",
      };
      const config = loadConfig(env);
      expect(config.repoIds).toEqual([
        "a838fce3-3b9c-4c78-beec-cb4cf5983144",
        "6e549e35-d1b2",
      ]);
    });

    it("defaults repoIds to an empty array", () => {
      const config = loadConfig(validEnv);
      expect(config.repoIds).toEqual([]);
    });

    it("defaults createScriptTag to 'create script'", () => {
      expect(loadConfig(validEnv).createScriptTag).toBe("create script");
    });

    it("overrides createScriptTag via CREATE_SCRIPT_TAG", () => {
      const config = loadConfig({ ...validEnv, CREATE_SCRIPT_TAG: "record-me" });
      expect(config.createScriptTag).toBe("record-me");
    });

    it("reads CONTINIA_BANKING_PATH", () => {
      const config = loadConfig({ ...validEnv, CONTINIA_BANKING_PATH: "/repos/banking" });
      expect(config.continiaBankingPath).toBe("/repos/banking");
    });

    it("defaults workspaceOutputDir to ./output and overrides it", () => {
      expect(loadConfig(validEnv).workspaceOutputDir).toBe("./output");
      expect(
        loadConfig({ ...validEnv, WORKSPACE_OUTPUT_DIR: "/tmp/out" }).workspaceOutputDir,
      ).toBe("/tmp/out");
    });

    it("defaults pteOutputDir to workspaceOutputDir when PTE_OUTPUT_DIR absent", () => {
      const config = loadConfig({ ...validEnv, WORKSPACE_OUTPUT_DIR: "/tmp/out" });
      expect(config.pteOutputDir).toBe("/tmp/out");
    });

    it("uses PTE_OUTPUT_DIR when provided", () => {
      const config = loadConfig({
        ...validEnv,
        WORKSPACE_OUTPUT_DIR: "/tmp/out",
        PTE_OUTPUT_DIR: "/tmp/pte",
      });
      expect(config.pteOutputDir).toBe("/tmp/pte");
    });

    it("defaults agentMaxTurns to 120 and coerces overrides", () => {
      expect(loadConfig(validEnv).agentMaxTurns).toBe(120);
      expect(loadConfig({ ...validEnv, AGENT_MAX_TURNS: "200" }).agentMaxTurns).toBe(200);
    });

    it("defaults maxProcessAttempts to 3 and coerces overrides", () => {
      expect(loadConfig(validEnv).maxProcessAttempts).toBe(3);
      expect(loadConfig({ ...validEnv, MAX_PROCESS_ATTEMPTS: "5" }).maxProcessAttempts).toBe(5);
    });

    it("reads LSP_PLUGIN_PATH", () => {
      const config = loadConfig({ ...validEnv, LSP_PLUGIN_PATH: "/plugins/lsp" });
      expect(config.lspPluginPath).toBe("/plugins/lsp");
    });

    it("reads CONTINIA_API_TOKEN and defaults it to empty", () => {
      expect(loadConfig(validEnv).continiaApiToken).toBe("");
      expect(
        loadConfig({ ...validEnv, CONTINIA_API_TOKEN: "tok-123" }).continiaApiToken,
      ).toBe("tok-123");
    });
  });
});
