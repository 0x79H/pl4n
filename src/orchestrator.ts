import { promises as fs } from "fs";
import path from "path";
import { createTwoFilesPatch } from "diff";

import type { AgentAdapter } from "./adapters/base";
import { fileExists } from "./utils/fs";
import { ClaudeCodeSyncAdapter } from "./adapters/claude";
import { CodexCLISyncAdapter } from "./adapters/codex";
import { OpencodeCLISyncAdapter } from "./adapters/opencode";
import { AgentStatus, Phase, Pl4nConfig } from "./models";
import type { AgentConfig } from "./models";
import { generateUniqueName } from "./names";
import { getDraftPrompt, getPeerReviewPrompt, getSynthesisPrompt } from "./prompts";
import { SessionManager } from "./session";

function createSyncAdapter(config: AgentConfig, context: string): AgentAdapter {
  if (config.type === "claude") {
    return new ClaudeCodeSyncAdapter(config);
  }
  if (config.type === "codex") {
    return new CodexCLISyncAdapter(config);
  }
  if (config.type === "opencode") {
    return new OpencodeCLISyncAdapter(config);
  }
  throw new Error(`Unknown agent type "${config.type}" for ${context}`);
}

function extractErrorSummary(output: string): string {
  // Look for common error patterns and extract a concise summary
  const lines = output.trim().split("\n");

  // Check for "error:" prefix (common in CLI tools)
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("error:")) {
      return trimmed;
    }
  }

  // Check for lines containing "unexpected argument" or similar
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("unexpected argument") ||
      lower.includes("invalid option") ||
      lower.includes("command not found") ||
      lower.includes("permission denied") ||
      lower.includes("timeout")
    ) {
      return line.trim();
    }
  }

  // Return first non-empty line up to 200 chars, or truncated output
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
    }
  }

  return output.length > 200 ? output.slice(0, 200) + "..." : output;
}

function unifiedDiff(params: {
  fromFile: string;
  toFile: string;
  original: string;
  edited: string;
}): string {
  return createTwoFilesPatch(
    params.fromFile,
    params.toFile,
    params.original,
    params.edited,
    "",
    "",
    { context: 3 },
  ).trimEnd();
}

export class TurnOrchestrator {
  manager: SessionManager;
  config: Pl4nConfig;
  adapters: Record<string, AgentAdapter>;

  constructor(manager: SessionManager, config: Pl4nConfig) {
    this.manager = manager;
    this.config = config;
    this.adapters = {};

    for (const agentConfig of config.agents) {
      if (agentConfig.enabled === false) {
        continue;
      }
      this.adapters[agentConfig.id] = createSyncAdapter(agentConfig, `agent "${agentConfig.id}"`);
    }
    // Validate eagerly: a bad synthesizer type must not surface only after a
    // full round of drafting and peer review.
    createSyncAdapter(config.synthesizer, "synthesizer");
  }

  async runTurn(sessionId: string): Promise<boolean> {
    const state = await this.manager.loadSession(sessionId);
    if (!state) {
      return false;
    }

    const paths = this.manager.getPaths(sessionId);
    const turn = state.turn;

    const snapshotDir = paths.turnSnapshotDir(turn);
    await fs.mkdir(snapshotDir, { recursive: true });

    const task = state.task;
    const userFeedback = await this.getUserFeedback(paths, turn);

    for (const agentId of Object.keys(this.adapters)) {
      if (!state.agentPlanIds[agentId]) {
        const existing = new Set(Object.values(state.agentPlanIds));
        const planId = generateUniqueName(existing);
        state.agentPlanIds[agentId] = planId;
      }
    }
    await this.manager.saveState(state);

    state.phase = Phase.Drafting;
    await this.manager.saveState(state);

    const drafts: Record<string, string> = {};
    const projectRoot = path.resolve(this.manager.pl4nDir, "..");

    // Mark all agents as working upfront
    for (const agentId of Object.keys(this.adapters)) {
      state.agents[agentId] = AgentStatus.Working;
    }
    await this.manager.saveState(state);

    // Run all agents in parallel
    const draftPromises = Object.entries(this.adapters).map(async ([agentId, adapter]) => {
      const planId = state.agentPlanIds[agentId];
      const planFile = paths.agentPlanFile(planId);

      const sessionLog = paths.agentLogFile(planId);
      await fs.mkdir(path.dirname(sessionLog), { recursive: true });

      const snapshotFile = path.join(snapshotDir, `${planId}-draft.md`);

      const prompt = getDraftPrompt({
        task,
        turn,
        outputFile: planFile,
        planFile: turn > 1 && (await fileExists(planFile)) ? planFile : "",
        userFeedback,
      });

      const sessionFile = paths.agentSessionFile(planId);
      await fs.mkdir(path.dirname(sessionFile), { recursive: true });

      const [success, output] = await adapter.runSync({
        worktree: projectRoot,
        prompt,
        outputFile: planFile,
        logFile: sessionLog,
        sessionFile,
        appendLog: true,
      });

      return { agentId, planId, planFile, snapshotFile, success, output };
    });

    const draftResults = await Promise.all(draftPromises);

    // Process results and update state
    for (const { agentId, planFile, snapshotFile, success, output } of draftResults) {
      if (success) {
        const content = (await fileExists(planFile)) ? await fs.readFile(planFile, "utf8") : output;
        drafts[agentId] = content;
        await fs.writeFile(snapshotFile, content, "utf8");
        state.agents[agentId] = AgentStatus.Done;
        delete state.agentErrors[agentId];
      } else {
        state.agents[agentId] = AgentStatus.Error;
        state.agentErrors[agentId] = extractErrorSummary(output);
      }
    }
    await this.manager.saveState(state);

    if (Object.keys(drafts).length === 0) {
      state.phase = Phase.Error;
      await this.manager.saveState(state);
      return false;
    }

    state.phase = Phase.PeerReview;
    await this.manager.saveState(state);

    const finals: Record<string, string> = {};
    const agentIds = Object.keys(drafts);

    // Mark all agents as working upfront
    for (const agentId of agentIds) {
      if (this.adapters[agentId]) {
        state.agents[agentId] = AgentStatus.Working;
      }
    }
    await this.manager.saveState(state);

    // Run all peer reviews in parallel
    const reviewPromises = agentIds.map(async (agentId, i) => {
      const adapter = this.adapters[agentId];
      if (!adapter) {
        return null;
      }

      const planId = state.agentPlanIds[agentId];
      const peerIdx = (i + 1) % agentIds.length;
      const peerAgentId = agentIds[peerIdx];
      const peerPlanId = state.agentPlanIds[peerAgentId];
      const peerDraft = drafts[peerAgentId] ?? "";

      const prompt = getPeerReviewPrompt({
        task,
        ownDraft: drafts[agentId],
        peerId: peerPlanId,
        peerDraft,
      });

      const planFile = paths.agentPlanFile(planId);
      const sessionLog = paths.agentLogFile(planId);
      const snapshotFile = path.join(snapshotDir, `${planId}-reviewed.md`);

      const sessionFile = paths.agentSessionFile(planId);

      const [success, output] = await adapter.runSync({
        worktree: path.resolve(this.manager.pl4nDir, ".."),
        prompt,
        outputFile: planFile,
        logFile: sessionLog,
        sessionFile,
        appendLog: true,
      });

      return { agentId, planFile, snapshotFile, success, output, fallbackDraft: drafts[agentId] };
    });

    const reviewResults = await Promise.all(reviewPromises);

    // Process results and update state
    for (const result of reviewResults) {
      if (!result) continue;

      const { agentId, planFile, snapshotFile, success, output, fallbackDraft } = result;

      if (success) {
        const content = (await fileExists(planFile)) ? await fs.readFile(planFile, "utf8") : output;
        finals[agentId] = content;
        await fs.writeFile(snapshotFile, content, "utf8");
        state.agents[agentId] = AgentStatus.Done;
        delete state.agentErrors[agentId];
      } else {
        finals[agentId] = fallbackDraft;
        state.agents[agentId] = AgentStatus.Error;
        state.agentErrors[agentId] = extractErrorSummary(output);
      }
    }
    await this.manager.saveState(state);

    state.phase = Phase.Synthesizing;
    await this.manager.saveState(state);

    const synthesis = await this.synthesize(task, finals, paths, userFeedback);

    const turnFile = paths.turnFile(turn);
    await fs.mkdir(path.dirname(turnFile), { recursive: true });
    await fs.writeFile(turnFile, synthesis, "utf8");

    const snapshotFile = turnFile.replace(/\.md$/, ".snapshot.md");
    await fs.writeFile(snapshotFile, synthesis, "utf8");

    for (const agentId of Object.keys(this.adapters)) {
      const planId = state.agentPlanIds[agentId];
      await fs.writeFile(paths.agentPlanFile(planId), synthesis, "utf8");
    }

    state.phase = Phase.UserReview;
    await this.manager.saveState(state);

    return true;
  }

  private async getUserFeedback(paths: { turnFile: (turn: number) => string }, turn: number) {
    if (turn < 2) {
      return "";
    }

    const prevFile = paths.turnFile(turn - 1);
    if (!(await fileExists(prevFile))) {
      return "";
    }

    const snapshotFile = prevFile.replace(/\.md$/, ".snapshot.md");
    if (await fileExists(snapshotFile)) {
      const original = await fs.readFile(snapshotFile, "utf8");
      const edited = await fs.readFile(prevFile, "utf8");

      const diff = unifiedDiff({
        fromFile: "synthesis",
        toFile: "user-edited",
        original,
        edited,
      });

      if (diff.trim().length > 0) {
        return `\`\`\`diff\n${diff}\n\`\`\``;
      }
    }

    const current = await fs.readFile(prevFile, "utf8");
    return `User's current plan:\n\n${current}`;
  }

  private async synthesize(
    task: string,
    agentPlans: Record<string, string>,
    paths: {
      agents: string;
      agentLogFile: (id: string) => string;
      agentSessionFile: (id: string) => string;
    },
    userDiff: string,
  ): Promise<string> {
    if (Object.keys(agentPlans).length === 1) {
      return Object.values(agentPlans)[0];
    }

    const synthConfig = this.config.synthesizer;
    const adapter = createSyncAdapter(synthConfig, "synthesizer");

    const synthFile = path.join(paths.agents, "synthesis_temp.md");
    await fs.mkdir(path.dirname(synthFile), { recursive: true });

    const prompt = getSynthesisPrompt({
      task,
      agentPlans,
      outputFile: synthFile,
      userDiff,
    });

    const logFile = paths.agentLogFile("synthesizer");
    await fs.mkdir(path.dirname(logFile), { recursive: true });

    const synthSessionFile = paths.agentSessionFile("synthesizer");
    await fs.mkdir(path.dirname(synthSessionFile), { recursive: true });

    const [success, _output] = await adapter.runSync({
      worktree: path.resolve(this.manager.pl4nDir, ".."),
      prompt,
      outputFile: synthFile,
      logFile,
      sessionFile: synthSessionFile,
      appendLog: true,
    });

    if (success && (await fileExists(synthFile))) {
      const result = await fs.readFile(synthFile, "utf8");
      await fs.rm(synthFile, { force: true });
      return result;
    }

    await fs.rm(synthFile, { force: true });

    let result = `# Plan: ${task}\n\n`;
    result += "## Combined from agents\n\n";
    for (const [agentId, plan] of Object.entries(agentPlans)) {
      result += `### From ${agentId}\n\n${plan}\n\n---\n\n`;
    }
    return result;
  }

  async getDiff(sessionId: string, fromTurn?: number, toTurn?: number): Promise<string> {
    const state = await this.manager.loadSession(sessionId);
    if (!state) {
      return "";
    }

    // Default to comparing previous turn with current turn
    const from = fromTurn ?? state.turn - 1;
    const to = toTurn ?? state.turn;

    // Validate turn range
    if (from < 1 || to < 1 || from >= to || to > state.turn) {
      return "";
    }

    const paths = this.manager.getPaths(sessionId);
    const fromFile = paths.turnFile(from);
    const toFile = paths.turnFile(to);

    if (!(await fileExists(fromFile)) || !(await fileExists(toFile))) {
      return "";
    }

    const fromContent = await fs.readFile(fromFile, "utf8");
    const toContent = await fs.readFile(toFile, "utf8");

    return unifiedDiff({
      fromFile: `turn-${String(from).padStart(3, "0")}.md`,
      toFile: `turn-${String(to).padStart(3, "0")}.md`,
      original: fromContent,
      edited: toContent,
    });
  }
}
