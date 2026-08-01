/**
 * Type definitions for agent and session configurations
 */

import type { AgentStatus } from "./enums";

export interface ClaudeConfig {
  allowedTools?: string[];
  addDir?: string[];
}

export interface CodexConfig {
  fullAuto?: boolean;
  sandbox?: string;
  approvalPolicy?: string;
  dangerouslyBypass?: boolean;
  addDir?: string[];
  search?: boolean;
  config?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
}

export interface OpencodeConfig {
  agent?: string;
}

export interface AgentConfig {
  id: string;
  type: string;
  model: string;
  thinking?: string;
  claude?: ClaudeConfig;
  codex?: CodexConfig;
  opencode?: OpencodeConfig;
  enabled?: boolean;
}

export type AgentStatusMap = Record<string, AgentStatus>;
export type AgentPlanIdMap = Record<string, string>;
export type AgentErrorMap = Record<string, string>;

export type Pl4nConfigParams = {
  agents: AgentConfig[];
  synthesizer: AgentConfig;
};
