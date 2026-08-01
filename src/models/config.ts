/**
 * Configuration parsing and management for Pl4n
 */

import { promises as fs } from "fs";
import path from "path";
import { load as loadYaml } from "js-yaml";

import { DEFAULT_CLAUDE_ALLOWED_TOOLS } from "../defaults";
import { isRecord } from "../utils/types";
import type { AgentConfig, ClaudeConfig, CodexConfig, Pl4nConfigParams } from "./types";

const DEFAULT_CLAUDE_CONFIG: ClaudeConfig = {
  allowedTools: DEFAULT_CLAUDE_ALLOWED_TOOLS,
};

const DEFAULT_CODEX_CONFIG: CodexConfig = {
  fullAuto: true,
  search: true,
};

const AGENT_TYPES = new Set(["claude", "codex"]);

const CODEX_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
let warnedCodexXmax = false;

function cloneClaudeConfig(config: ClaudeConfig): ClaudeConfig {
  return {
    allowedTools: config.allowedTools ? [...config.allowedTools] : undefined,
    addDir: config.addDir ? [...config.addDir] : undefined,
  };
}

function cloneCodexConfig(config: CodexConfig): CodexConfig {
  return {
    fullAuto: config.fullAuto,
    sandbox: config.sandbox,
    approvalPolicy: config.approvalPolicy,
    dangerouslyBypass: config.dangerouslyBypass,
    addDir: config.addDir ? [...config.addDir] : undefined,
    search: config.search,
    config: config.config ? { ...config.config } : undefined,
    mcp: config.mcp ? { ...config.mcp } : undefined,
  };
}

function defaultConfigParams(): Pl4nConfigParams {
  return {
    agents: [
      {
        id: "opus",
        type: "claude",
        model: "opus",
        thinking: "ultrathink",
        claude: cloneClaudeConfig(DEFAULT_CLAUDE_CONFIG),
        enabled: true,
      },
      {
        id: "codex",
        type: "codex",
        model: "gpt-5.2-codex",
        thinking: "xhigh",
        codex: cloneCodexConfig(DEFAULT_CODEX_CONFIG),
        enabled: true,
      },
    ],
    synthesizer: {
      id: "synthesizer",
      type: "claude",
      model: "opus",
      thinking: "ultrathink",
      claude: cloneClaudeConfig(DEFAULT_CLAUDE_CONFIG),
      enabled: true,
    },
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function parseEnabled(value: unknown, field: string): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be a list`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must include at least one entry`);
  }
  return value.map((entry, index) => requireString(entry, `${field}[${index}]`));
}

function optionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  return value;
}

function mergeClaudeConfig(base?: ClaudeConfig, override?: ClaudeConfig): ClaudeConfig | undefined {
  if (!base && !override) {
    return undefined;
  }
  const allowedTools = override?.allowedTools ?? base?.allowedTools;
  const addDir = override?.addDir ?? base?.addDir;
  return {
    allowedTools: allowedTools ? [...allowedTools] : undefined,
    addDir: addDir ? [...addDir] : undefined,
  };
}

function mergeCodexConfig(base?: CodexConfig, override?: CodexConfig): CodexConfig | undefined {
  if (!base && !override) {
    return undefined;
  }
  const addDir = override?.addDir ?? base?.addDir;
  const config = override?.config ?? base?.config;
  const mcp = override?.mcp ?? base?.mcp;
  return {
    fullAuto: override?.fullAuto ?? base?.fullAuto,
    sandbox: override?.sandbox ?? base?.sandbox,
    approvalPolicy: override?.approvalPolicy ?? base?.approvalPolicy,
    dangerouslyBypass: override?.dangerouslyBypass ?? base?.dangerouslyBypass,
    addDir: addDir ? [...addDir] : undefined,
    search: override?.search ?? base?.search,
    config: config ? { ...config } : undefined,
    mcp: mcp ? { ...mcp } : undefined,
  };
}

function parseClaudeConfig(value: unknown, field: string): ClaudeConfig {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  const allowedToolsValue = value.allowed_tools ?? value.allowedTools;
  const addDirValue = value.add_dir ?? value.addDir;
  return {
    allowedTools:
      allowedToolsValue === undefined
        ? undefined
        : parseStringList(allowedToolsValue, `${field}.allowed_tools`),
    addDir:
      addDirValue === undefined ? undefined : parseStringList(addDirValue, `${field}.add_dir`),
  };
}

function parseCodexConfig(value: unknown, field: string): CodexConfig {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  const approvalPolicyValue =
    value.approval_policy ?? value.ask_for_approval ?? value.askForApproval ?? value.approvalPolicy;
  const dangerouslyBypassValue =
    value.dangerously_bypass ??
    value.dangerously_bypass_approvals_and_sandbox ??
    value.dangerouslyBypass;
  const fullAutoValue = value.full_auto ?? value.fullAuto;
  const addDirValue = value.add_dir ?? value.addDir;
  const searchValue = value.search ?? value.web_search ?? value.webSearch;
  const configValue = optionalRecord(value.config, `${field}.config`);
  const mcpValue = optionalRecord(value.mcp, `${field}.mcp`);
  if (configValue && Object.prototype.hasOwnProperty.call(configValue, "mcp") && mcpValue) {
    throw new Error(`${field}.mcp conflicts with ${field}.config.mcp`);
  }
  return {
    fullAuto: optionalBoolean(fullAutoValue, `${field}.full_auto`),
    sandbox: optionalString(value.sandbox, `${field}.sandbox`),
    approvalPolicy: optionalString(approvalPolicyValue, `${field}.approval_policy`),
    dangerouslyBypass: optionalBoolean(dangerouslyBypassValue, `${field}.dangerously_bypass`),
    addDir:
      addDirValue === undefined ? undefined : parseStringList(addDirValue, `${field}.add_dir`),
    search: optionalBoolean(searchValue, `${field}.search`),
    config: configValue ? { ...configValue } : undefined,
    mcp: mcpValue ? { ...mcpValue } : undefined,
  };
}

function normalizeCodexThinking(value: string | undefined, field: string): string | undefined {
  if (!value) {
    return value;
  }
  const normalized = value.trim();
  if (normalized === "xmax") {
    if (!warnedCodexXmax) {
      console.warn(`[pl4n] ${field} "xmax" is deprecated; using "xhigh" instead.`);
      warnedCodexXmax = true;
    }
    return "xhigh";
  }
  if (!CODEX_REASONING_EFFORTS.has(normalized)) {
    throw new Error(`${field} must be one of ${[...CODEX_REASONING_EFFORTS].join(", ")}`);
  }
  return normalized;
}

type AgentDefaults = {
  claude?: ClaudeConfig;
  codex?: CodexConfig;
};

function parseAgentConfig(value: unknown, field: string, defaults: AgentDefaults): AgentConfig {
  if (!isRecord(value)) {
    throw new Error(`${field} must be a mapping`);
  }
  const type = requireString(value.type, `${field}.type`);
  if (!AGENT_TYPES.has(type)) {
    throw new Error(`${field}.type must be one of ${[...AGENT_TYPES].join(", ")}`);
  }
  const claudeValue = value.claude;
  const codexValue = value.codex;
  let thinking = optionalString(value.thinking, `${field}.thinking`);
  let claudeConfig =
    claudeValue === undefined ? undefined : parseClaudeConfig(claudeValue, `${field}.claude`);
  let codexConfig =
    codexValue === undefined ? undefined : parseCodexConfig(codexValue, `${field}.codex`);

  if (type === "claude") {
    if (codexValue !== undefined) {
      throw new Error(`${field}.codex is not valid for claude agents`);
    }
    claudeConfig = mergeClaudeConfig(defaults.claude, claudeConfig);
  } else if (type === "codex") {
    if (claudeValue !== undefined) {
      throw new Error(`${field}.claude is not valid for codex agents`);
    }
    codexConfig = mergeCodexConfig(defaults.codex, codexConfig);
    thinking = normalizeCodexThinking(thinking, `${field}.thinking`);
  }

  return {
    id: requireString(value.id, `${field}.id`),
    type,
    model: requireString(value.model, `${field}.model`),
    thinking,
    claude: claudeConfig,
    codex: codexConfig,
    enabled: parseEnabled(value.enabled, `${field}.enabled`),
  };
}

function applyAgentDefaults(agent: AgentConfig, defaults: AgentDefaults): AgentConfig {
  if (agent.type === "claude") {
    return { ...agent, claude: mergeClaudeConfig(agent.claude, defaults.claude) };
  }
  if (agent.type === "codex") {
    return { ...agent, codex: mergeCodexConfig(agent.codex, defaults.codex) };
  }
  return agent;
}

function parseAgents(value: unknown, defaults: AgentDefaults): AgentConfig[] {
  if (!Array.isArray(value)) {
    throw new Error("agents must be a list");
  }
  if (value.length === 0) {
    throw new Error("agents must include at least one entry");
  }

  const agents = value.map((entry, index) => parseAgentConfig(entry, `agents[${index}]`, defaults));
  const ids = new Set<string>();
  for (const agent of agents) {
    if (ids.has(agent.id)) {
      throw new Error(`agents contains duplicate id: ${agent.id}`);
    }
    ids.add(agent.id);
  }
  if (!agents.some((agent) => agent.enabled)) {
    throw new Error("agents must include at least one enabled agent");
  }
  return agents;
}

function parsePl4nConfig(value: unknown): Pl4nConfigParams {
  if (!isRecord(value)) {
    throw new Error("config must be a mapping");
  }

  const defaults = defaultConfigParams();
  const claudeDefaults = mergeClaudeConfig(
    DEFAULT_CLAUDE_CONFIG,
    value.claude === undefined ? undefined : parseClaudeConfig(value.claude, "claude"),
  );
  const codexDefaults = mergeCodexConfig(
    DEFAULT_CODEX_CONFIG,
    value.codex === undefined ? undefined : parseCodexConfig(value.codex, "codex"),
  );
  const agentDefaults: AgentDefaults = {
    claude: claudeDefaults,
    codex: codexDefaults,
  };

  const agents =
    value.agents === undefined
      ? defaults.agents.map((agent) => applyAgentDefaults(agent, agentDefaults))
      : parseAgents(value.agents, agentDefaults);
  const synthesizer =
    value.synthesizer === undefined
      ? applyAgentDefaults(defaults.synthesizer, agentDefaults)
      : parseAgentConfig(value.synthesizer, "synthesizer", agentDefaults);
  return { agents, synthesizer };
}

async function resolveConfigPath(pl4nDir: string): Promise<string | null> {
  const candidates = ["pl4n.yaml", "pl4n.yml"];
  for (const candidate of candidates) {
    const fullPath = path.join(pl4nDir, candidate);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export class Pl4nConfig {
  agents: AgentConfig[];
  synthesizer: AgentConfig;

  constructor(params: Pl4nConfigParams) {
    this.agents = params.agents;
    this.synthesizer = params.synthesizer;
  }

  static default(): Pl4nConfig {
    return new Pl4nConfig(defaultConfigParams());
  }

  static async loadFromPl4nDir(pl4nDir: string): Promise<Pl4nConfig> {
    const configPath = await resolveConfigPath(pl4nDir);
    if (!configPath) {
      return Pl4nConfig.default();
    }
    return Pl4nConfig.loadFromFile(configPath);
  }

  static fromConfigData(data: unknown, source: string): Pl4nConfig {
    if (data === undefined || data === null) {
      throw new Error(`Invalid config ${source}: config is empty`);
    }

    try {
      const parsed = parsePl4nConfig(data);
      return new Pl4nConfig(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid config";
      throw new Error(`Invalid config ${source}: ${message}`);
    }
  }

  static async loadFromFile(configPath: string): Promise<Pl4nConfig> {
    const content = await fs.readFile(configPath, "utf8");
    let data: unknown;
    try {
      data = loadYaml(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse YAML";
      throw new Error(`Invalid config ${configPath}: ${message}`);
    }
    return Pl4nConfig.fromConfigData(data, configPath);
  }

  toConfigDict(): Record<string, unknown> {
    const serializeClaude = (config?: ClaudeConfig): Record<string, unknown> | null => {
      if (!config) {
        return null;
      }
      const data: Record<string, unknown> = {};
      if (config.allowedTools && config.allowedTools.length > 0) {
        data.allowed_tools = config.allowedTools;
      }
      if (config.addDir && config.addDir.length > 0) {
        data.add_dir = config.addDir;
      }
      return Object.keys(data).length > 0 ? data : null;
    };

    const serializeCodex = (config?: CodexConfig): Record<string, unknown> | null => {
      if (!config) {
        return null;
      }
      const data: Record<string, unknown> = {};
      if (config.fullAuto !== undefined) {
        data.full_auto = config.fullAuto;
      }
      if (config.sandbox) {
        data.sandbox = config.sandbox;
      }
      if (config.approvalPolicy) {
        data.approval_policy = config.approvalPolicy;
      }
      if (config.dangerouslyBypass !== undefined) {
        data.dangerously_bypass = config.dangerouslyBypass;
      }
      if (config.addDir && config.addDir.length > 0) {
        data.add_dir = config.addDir;
      }
      if (config.search !== undefined) {
        data.search = config.search;
      }
      if (config.config) {
        data.config = config.config;
      }
      if (config.mcp) {
        data.mcp = config.mcp;
      }
      return Object.keys(data).length > 0 ? data : null;
    };

    const serializeAgent = (agent: AgentConfig): Record<string, unknown> => {
      const data: Record<string, unknown> = {
        id: agent.id,
        type: agent.type,
        model: agent.model,
      };
      if (agent.thinking) {
        data.thinking = agent.thinking;
      }
      const claude = serializeClaude(agent.claude);
      if (claude) {
        data.claude = claude;
      }
      const codex = serializeCodex(agent.codex);
      if (codex) {
        data.codex = codex;
      }
      if (agent.enabled !== undefined) {
        data.enabled = agent.enabled;
      }
      return data;
    };

    const config: Record<string, unknown> = {
      agents: this.agents.map((agent) => serializeAgent(agent)),
      synthesizer: serializeAgent(this.synthesizer),
    };
    return config;
  }
}
