import { promises as fs } from "fs";

import type { AgentConfig } from "../models";
import { AgentAdapter, AgentHandle } from "./base";
import { readSessionId, readSessionIdSync, writeSessionId } from "./session-file";
import { streamToLog } from "./stream-utils";

const DEFAULT_OPENCODE_AGENT = "plan";

function buildCmd(config: AgentConfig, prompt: string, sessionId?: string | null): string[] {
  const cmd = ["opencode", "run", "--format", "json"];
  if (config.model) {
    cmd.push("--model", config.model);
  }
  cmd.push("--agent", config.opencode?.agent ?? DEFAULT_OPENCODE_AGENT);
  if (config.thinking) {
    cmd.push("--variant", config.thinking);
  }
  if (sessionId) {
    cmd.push("--session", sessionId);
  }
  cmd.push(prompt);
  return cmd;
}

function parseOpencodeOutput(stdout: string): {
  sessionId: string | null;
  finalOutput: string;
  hasEvents: boolean;
  hasTextParts: boolean;
} {
  let sessionId: string | null = null;
  let hasEvents = false;
  const texts: { messageId: string; text: string }[] = [];

  for (const line of stdout.trim().split("\n")) {
    if (!line) {
      continue;
    }
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      hasEvents = true;
      if (typeof event.sessionID === "string" && event.sessionID.length > 0) {
        sessionId = event.sessionID;
      }
      if (event.type !== "text") {
        continue;
      }
      const part = event.part;
      if (
        typeof part === "object" &&
        part !== null &&
        typeof (part as Record<string, unknown>).text === "string" &&
        ((part as Record<string, unknown>).text as string).length > 0
      ) {
        const record = part as Record<string, unknown>;
        texts.push({
          messageId: typeof record.messageID === "string" ? record.messageID : "",
          text: record.text as string,
        });
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  if (texts.length === 0) {
    return { sessionId, finalOutput: stdout, hasEvents, hasTextParts: false };
  }

  // A message may span multiple text parts; keep every part of the final message
  const lastMessageId = texts[texts.length - 1].messageId;
  const finalOutput = texts
    .filter((entry) => entry.messageId === lastMessageId)
    .map((entry) => entry.text)
    .join("\n\n");
  return { sessionId, finalOutput, hasEvents, hasTextParts: true };
}

function shouldPreferOutput(config: AgentConfig): boolean {
  // The built-in plan agent is read-only and cannot write the output file itself
  return (config.opencode?.agent ?? DEFAULT_OPENCODE_AGENT) === "plan";
}

export class OpencodeCLIAdapter extends AgentAdapter {
  spawn(params: {
    worktree: string;
    prompt: string;
    outputFile: string;
    logFile: string;
    sessionFile?: string;
  }): AgentHandle {
    const { worktree, prompt, logFile, sessionFile } = params;
    const sessionId = readSessionIdSync(sessionFile);
    const cmd = buildCmd(this.config, prompt, sessionId);
    const proc = Bun.spawn({
      cmd,
      cwd: worktree,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    void streamToLog({ stdout: proc.stdout, stderr: proc.stderr, logFile, appendLog: false });
    return new AgentHandle(this.config.id, proc, logFile);
  }

  getName(): string {
    return `Opencode CLI (${this.config.model})`;
  }
}

export class OpencodeCLISyncAdapter extends AgentAdapter {
  spawn(params: {
    worktree: string;
    prompt: string;
    outputFile: string;
    logFile: string;
    sessionFile?: string;
  }): AgentHandle {
    const { worktree, prompt, logFile, sessionFile } = params;
    const sessionId = readSessionIdSync(sessionFile);
    const cmd = buildCmd(this.config, prompt, sessionId);
    const proc = Bun.spawn({
      cmd,
      cwd: worktree,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    void streamToLog({ stdout: proc.stdout, stderr: proc.stderr, logFile, appendLog: false });
    return new AgentHandle(this.config.id, proc, logFile);
  }

  async runSync(params: {
    worktree: string;
    prompt: string;
    outputFile: string;
    logFile: string;
    sessionFile?: string;
    appendLog?: boolean;
  }): Promise<[boolean, string]> {
    const sessionId = await readSessionId(params.sessionFile);
    const cmd = buildCmd(this.config, params.prompt, sessionId);

    const proc = Bun.spawn({
      cmd,
      cwd: params.worktree,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const outputPromise = streamToLog({
      stdout: proc.stdout,
      stderr: proc.stderr,
      logFile: params.logFile,
      appendLog: params.appendLog ?? false,
    });

    try {
      await proc.exited;
    } catch {
      // handled below
    }

    const { stdoutText, stderrText } = await outputPromise;
    const fullOutput = stdoutText + stderrText;

    const parsed = parseOpencodeOutput(stdoutText || fullOutput);
    await writeSessionId(params.sessionFile, parsed.sessionId);

    if (proc.exitCode === 0) {
      // A parseable event stream with no text parts means the run produced no
      // usable output; failing beats writing raw JSON events into the plan file.
      if (parsed.hasEvents && !parsed.hasTextParts) {
        return [false, "no text output in event stream"];
      }
      const finalOutput = parsed.finalOutput;
      if (shouldPreferOutput(this.config) && finalOutput.trim().length > 0) {
        try {
          await fs.writeFile(params.outputFile, finalOutput, "utf8");
        } catch {
          // fall through with output
        }
        return [true, finalOutput];
      }
      try {
        const file = Bun.file(params.outputFile);
        const exists = await file.exists();
        if (!exists) {
          await fs.writeFile(params.outputFile, finalOutput, "utf8");
          return [true, finalOutput];
        }

        const stat = await fs.stat(params.outputFile);
        if (stat.size === 0) {
          await fs.writeFile(params.outputFile, finalOutput, "utf8");
          return [true, finalOutput];
        }

        return [true, await fs.readFile(params.outputFile, "utf8")];
      } catch {
        return [true, finalOutput];
      }
    }

    return [false, fullOutput || "Unknown error"];
  }

  getName(): string {
    return `Opencode CLI Sync (${this.config.model})`;
  }
}
