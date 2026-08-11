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
    };

    const config = loadConfig(env);

    expect(config.pollIntervalMinutes).toBe(30);
    expect(config.claudeModel).toBe("claude-opus-4-6");
    expect(config.promptPath).toBe("custom/prompt.md");
  });

  it("derives orgUrl from org name", () => {
    const env = { ...validEnv, AZURE_DEVOPS_ORG: "contoso" };
    const config = loadConfig(env);
    expect(config.orgUrl).toBe("https://dev.azure.com/contoso");
  });

  describe("script-generator config", () => {
    it("reads AZURE_DEVOPS_AREA_PATH into areaPath", () => {
      const env = {
        ...validEnv,
        AZURE_DEVOPS_AREA_PATH: "Continia Software\\Continia Banking",
      };
      const config = loadConfig(env);
      expect(config.areaPath).toBe("Continia Software\\Continia Banking");
    });

    it("defaults areaPath to an empty string", () => {
      const config = loadConfig(validEnv);
      expect(config.areaPath).toBe("");
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

    it("defaults agentMaxTurns to 200 and coerces overrides", () => {
      expect(loadConfig(validEnv).agentMaxTurns).toBe(200);
      expect(loadConfig({ ...validEnv, AGENT_MAX_TURNS: "300" }).agentMaxTurns).toBe(300);
    });

    it("defaults outputRetentionDays to 14", () => {
      const config = loadConfig(validEnv);
      expect(config.outputRetentionDays).toBe(14);
    });

    it("reads a custom OUTPUT_RETENTION_DAYS", () => {
      const config = loadConfig({ ...validEnv, OUTPUT_RETENTION_DAYS: "0" });
      expect(config.outputRetentionDays).toBe(0);
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

    it("defaults WATCH_CONCURRENCY to 1 and coerces values", () => {
      expect(loadConfig(validEnv).watchConcurrency).toBe(1);
      expect(loadConfig({ ...validEnv, WATCH_CONCURRENCY: "3" }).watchConcurrency).toBe(3);
    });
  });
});
