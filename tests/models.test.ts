import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "bun:test";

import { AgentStatus, Phase, SessionPaths, SessionState, Pl4nConfig } from "../src/models";

describe("Phase", () => {
  it("has expected values", () => {
    expect(String(Phase.Initializing)).toBe("initializing");
    expect(String(Phase.Drafting)).toBe("drafting");
    expect(String(Phase.PeerReview)).toBe("peer_review");
    expect(String(Phase.Synthesizing)).toBe("synthesizing");
    expect(String(Phase.UserReview)).toBe("user_review");
    expect(String(Phase.Approved)).toBe("approved");
    expect(String(Phase.Error)).toBe("error");
  });
});

describe("AgentStatus", () => {
  it("has expected values", () => {
    expect(String(AgentStatus.Pending)).toBe("pending");
    expect(String(AgentStatus.Working)).toBe("working");
    expect(String(AgentStatus.Done)).toBe("done");
    expect(String(AgentStatus.Error)).toBe("error");
  });
});

describe("SessionState", () => {
  it("serializes to dict", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const state = new SessionState({
      sessionId: "test-session",
      task: "Test task",
      turn: 2,
      phase: Phase.UserReview,
      createdAt: now,
      updatedAt: now,
      agents: { opus: AgentStatus.Done },
      agentPlanIds: { opus: "sunny-glade" },
      sessionToken: "session-token",
    });

    const dict = state.toDict();

    expect(dict.session_id).toBe("test-session");
    expect(dict.task).toBe("Test task");
    expect(dict.turn).toBe(2);
    expect(dict.phase).toBe("user_review");
    expect(dict.agents).toEqual({ opus: "done" });
    expect(dict.agent_plan_ids).toEqual({ opus: "sunny-glade" });
    expect(dict.session_token).toBe("session-token");
  });

  it("serializes agent errors when present", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const state = new SessionState({
      sessionId: "test-session",
      task: "Test task",
      turn: 1,
      phase: Phase.UserReview,
      createdAt: now,
      updatedAt: now,
      agentErrors: { codex: "error: draft failed" },
    });

    const dict = state.toDict();

    expect(dict.agent_errors).toEqual({ codex: "error: draft failed" });
  });
});

describe("SessionPaths", () => {
  it("builds expected paths", () => {
    const root = path.join("/tmp", "pl4n", "session");
    const paths = SessionPaths.fromRoot(root);

    expect(paths.root).toBe(root);
    expect(paths.meta).toBe(path.join(root, "meta.yaml"));
    expect(paths.state).toBe(path.join(root, "state.yaml"));
    expect(paths.input).toBe(path.join(root, "input.md"));
    expect(paths.turns).toBe(path.join(root, "turns"));
    expect(paths.agents).toBe(path.join(root, "agents"));

    expect(paths.turnFile(1)).toBe(path.join(root, "turns", "001.md"));
    expect(paths.turnSnapshotDir(10)).toBe(path.join(root, "turns", "010"));
    expect(paths.plans).toBe(path.join(root, "plans"));
    expect(paths.agentPlanFile("sunny-glade")).toBe(path.join(root, "plans", "sunny-glade.md"));
    expect(paths.agentLogFile("sunny-glade")).toBe(
      path.join(root, "agents", "sunny-glade", "agent.log"),
    );
    expect(paths.agentSessionFile("sunny-glade")).toBe(
      path.join(root, "agents", "sunny-glade", "session.txt"),
    );
    expect(paths.agentDir("sunny-glade")).toBe(path.join(root, "agents", "sunny-glade"));
  });
});

describe("Pl4nConfig", () => {
  it("builds default config", () => {
    const config = Pl4nConfig.default();
    expect(config.agents.length).toBe(2);
    expect(config.agents[0].id).toBe("opus");
    expect(config.agents[0].claude?.allowedTools).toContain("Read");
    expect(config.agents[1].id).toBe("codex");
    expect(config.agents[1].model).toBe("gpt-5.2-codex");
    expect(config.agents[1].thinking).toBe("xhigh");
    expect(config.agents[1].codex?.sandbox).toBeUndefined();
    expect(config.agents[1].codex?.approvalPolicy).toBeUndefined();
    expect(config.agents[1].codex?.fullAuto).toBe(true);
    expect(config.agents[1].codex?.search).toBe(true);
    expect(config.synthesizer.id).toBe("synthesizer");
  });

  it("loads config from yaml", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "claude:",
        "  allowed_tools:",
        "    - Read",
        "    - Write",
        "codex:",
        "  full_auto: false",
        "  sandbox: read-only",
        "  approval_policy: untrusted",
        "  dangerously_bypass: false",
        "  search: true",
        "  add_dir:",
        "    - extra-dir",
        "  config:",
        "    sandbox_permissions:",
        "      - disk-full-read-access",
        "  mcp:",
        "    servers:",
        "      - name: default",
        "        command:",
        "          - npx",
        "          - server",
        "agents:",
        "  - id: alpha",
        "    type: claude",
        "    model: opus",
        "    claude:",
        "      allowed_tools:",
        "        - Read",
        "  - id: beta",
        "    type: codex",
        "    model: gpt-5.2-codex",
        "    thinking: xhigh",
        "    enabled: false",
        "synthesizer:",
        "  id: synth",
        "  type: claude",
        "  model: opus",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");

      const config = await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      expect(config.agents.length).toBe(2);
      expect(config.agents[0]).toEqual({
        id: "alpha",
        type: "claude",
        model: "opus",
        claude: { allowedTools: ["Read"] },
        enabled: true,
      });
      expect(config.agents[1]).toEqual({
        id: "beta",
        type: "codex",
        model: "gpt-5.2-codex",
        thinking: "xhigh",
        codex: {
          fullAuto: false,
          sandbox: "read-only",
          approvalPolicy: "untrusted",
          dangerouslyBypass: false,
          addDir: ["extra-dir"],
          search: true,
          config: { sandbox_permissions: ["disk-full-read-access"] },
          mcp: {
            servers: [{ name: "default", command: ["npx", "server"] }],
          },
        },
        enabled: false,
      });
      expect(config.synthesizer).toEqual({
        id: "synth",
        type: "claude",
        model: "opus",
        claude: { allowedTools: ["Read", "Write"] },
        enabled: true,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("maps legacy codex xmax thinking to xhigh", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      if (typeof message === "string") {
        warnings.push(message);
      }
    };
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "agents:",
        "  - id: codex",
        "    type: codex",
        "    model: gpt-5.2-codex",
        "    thinking: xmax",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");
      const config = await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      const codexAgent = config.agents.find((agent) => agent.type === "codex");
      expect(codexAgent?.thinking).toBe("xhigh");
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = originalWarn;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("applies defaults when agents and synthesizer are omitted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "claude:",
        "  allowed_tools:",
        "    - Read",
        "codex:",
        "  search: false",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");

      const config = await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      expect(config.agents.length).toBe(2);
      const claudeAgent = config.agents.find((agent) => agent.type === "claude");
      const codexAgent = config.agents.find((agent) => agent.type === "codex");

      expect(claudeAgent?.claude?.allowedTools).toEqual(["Read"]);
      expect(codexAgent?.codex?.search).toBe(false);
      expect(config.synthesizer.claude?.allowedTools).toEqual(["Read"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to defaults when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    try {
      const config = await Pl4nConfig.loadFromPl4nDir(path.join(root, ".pl4n"));
      expect(config.agents.length).toBe(2);
      expect(config.agents[0].id).toBe("opus");
      expect(config.agents[1].id).toBe("codex");
      expect(config.synthesizer.id).toBe("synthesizer");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid codex thinking values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "agents:",
        "  - id: codex",
        "    type: codex",
        "    model: gpt-5.2-codex",
        "    thinking: ultrathink",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");
      let error: Error | undefined;
      try {
        await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      } catch (err) {
        error = err as Error;
      }
      expect(error).toBeDefined();
      expect(error?.message).toContain("thinking");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), "agents: []\n", "utf8");
      let error: Error | undefined;
      try {
        await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      } catch (err) {
        error = err as Error;
      }
      expect(error).toBeDefined();
      expect(error?.message).toContain("agents");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("Pl4nConfig agent type validation", () => {
  it("rejects unknown agent types", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "agents:",
        "  - id: mystery",
        "    type: nonexistent",
        "    model: whatever",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");
      let error: Error | undefined;
      try {
        await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      } catch (err) {
        error = err as Error;
      }
      expect(error).toBeDefined();
      expect(error?.message).toContain("type must be one of");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown agent types even when disabled", async () => {
    // Intentional pin of the breaking behavior change: unknown-type entries
    // used to load (and be silently skipped); now they fail config load even
    // with enabled: false. See the PR description for the migration note.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "agents:",
        "  - id: alpha",
        "    type: claude",
        "    model: opus",
        "  - id: parked",
        "    type: gemini",
        "    model: gemini-pro",
        "    enabled: false",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");
      let error: Error | undefined;
      try {
        await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      } catch (err) {
        error = err as Error;
      }
      expect(error).toBeDefined();
      expect(error?.message).toContain("agents[1].type must be one of");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("Pl4nConfig opencode", () => {
  it("loads opencode agents and synthesizer from yaml", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "agents:",
        "  - id: alpha",
        "    type: claude",
        "    model: opus",
        "  - id: free",
        "    type: opencode",
        "    model: opencode/deepseek-v4-flash-free",
        "    thinking: high",
        "    opencode:",
        "      agent: build",
        "synthesizer:",
        "  id: synth",
        "  type: opencode",
        "  model: opencode/deepseek-v4-flash-free",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");

      const config = await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      expect(config.agents.length).toBe(2);
      const opencodeAgent = config.agents.find((agent) => agent.type === "opencode");
      expect(opencodeAgent).toEqual({
        id: "free",
        type: "opencode",
        model: "opencode/deepseek-v4-flash-free",
        thinking: "high",
        opencode: { agent: "build" },
        enabled: true,
      });
      expect(config.synthesizer.type).toBe("opencode");
      expect(config.synthesizer.opencode).toEqual({ agent: "plan" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("applies top-level opencode defaults", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const yaml = [
        "opencode:",
        "  agent: general",
        "agents:",
        "  - id: free",
        "    type: opencode",
        "    model: opencode/deepseek-v4-flash-free",
        "",
      ].join("\n");
      await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");

      const config = await Pl4nConfig.loadFromPl4nDir(pl4nDir);
      expect(config.agents[0].opencode).toEqual({ agent: "general" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects cross-type config sections", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pl4n-config-"));
    const pl4nDir = path.join(root, ".pl4n");
    try {
      await fs.mkdir(pl4nDir, { recursive: true });
      const cases: Array<[string, string]> = [
        ["claude", "opencode"],
        ["codex", "opencode"],
        ["opencode", "claude"],
        ["opencode", "codex"],
      ];
      for (const [agentType, extraSection] of cases) {
        const yaml = [
          "agents:",
          "  - id: mixed",
          `    type: ${agentType}`,
          "    model: some-model",
          `    ${extraSection}:`,
          extraSection === "claude" ? "      allowed_tools: [Read]" : "      agent: plan",
          "",
        ].join("\n");
        await fs.writeFile(path.join(pl4nDir, "pl4n.yaml"), yaml, "utf8");
        let error: Error | undefined;
        try {
          await Pl4nConfig.loadFromPl4nDir(pl4nDir);
        } catch (err) {
          error = err as Error;
        }
        expect(error).toBeDefined();
        expect(error?.message).toContain(`not valid for ${agentType} agents`);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("serializes opencode config in toConfigDict", () => {
    const config = new Pl4nConfig({
      agents: [
        {
          id: "free",
          type: "opencode",
          model: "opencode/deepseek-v4-flash-free",
          thinking: "high",
          opencode: { agent: "plan" },
          enabled: true,
        },
      ],
      synthesizer: {
        id: "synth",
        type: "claude",
        model: "opus",
        enabled: true,
      },
    });

    const data = config.toConfigDict();
    expect(data.agents).toEqual([
      {
        id: "free",
        type: "opencode",
        model: "opencode/deepseek-v4-flash-free",
        thinking: "high",
        opencode: { agent: "plan" },
        enabled: true,
      },
    ]);
  });
});
