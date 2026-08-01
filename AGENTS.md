# AGENTS.md — How to work in this repo

## Environment

- Bun 1.x
- TypeScript 5.x

## Quick Start

bun install
bun run src/index.ts --help

## Repo Commands

bun run lint       # oxlint
bun run format     # Biome format
bun run typecheck  # tsc --noEmit
bun run test       # bun test
bun run build      # bun build

## Git Rules

- Check `git status`/`git diff` before commits
- Atomic commits; push only when asked
- Never destructive ops (`reset --hard`, `force push`) without explicit consent
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`

## Critical Thinking

- Read more code when stuck
- Document unexpected behavior
- Call out conflicts between instructions

## Engineering

- Small files (<500 LOC), descriptive paths, current header comments (agents navigate via filesystem and read line-by-line)
- Fix root causes, not symptoms
- Simplicity > cleverness (even if it means bigger refactors)
- 100% test coverage (forces edge-case thinking)
- Run `bun run lint && bun run test` after each batch of code changes
- Oracle: bundles a prompt plus the right files so another AI (GPT 5 Pro + more) can answer. Use when really stuck. Run `npx -y @steipete/oracle --help` once per session before first use.

## UI Testing

Use the `dev-browser` skill for testing web UI changes. It provides headless browser
automation with Playwright. Start server, take screenshots, verify DOM state.

## Project Overview

Pl4n is a multi-agent ensemble planning CLI. It orchestrates multiple AI agents
(Claude Code, OpenAI Codex, opencode) to collaboratively create implementation
plans for tasks, with human-in-the-loop review.

See `README.md` for full documentation.

## Commands

pl4n init "task description"        # Start planning session (blocks until complete)
pl4n continue --session <id>        # Start next turn after user edits (blocks)
pl4n approve --session <id>         # Lock plan as final
pl4n status --session <id>          # Check progress
pl4n list                           # List all sessions
pl4n clean --session <id>           # Remove session
pl4n diff --session <id>            # Show changes between turns
pl4n server start|stop|status       # Manage web editor server
Server auth defaults to strict `t=` query param tokens; trusted mode is configured via
`~/.pl4n/config.yaml` with IPv4 `auth.trusted_cidrs`.

## Architecture

src/
├── cli.ts          # CLI commands (sade)
├── models.ts       # Data models (SessionState, Phase, etc.)
├── session.ts      # Session management
├── orchestrator.ts # Turn orchestration (draft → peer review → synthesis)
├── prompts.ts      # Agent prompt templates
├── names.ts        # Human-friendly name generator
├── server/         # Web editor server + auth
└── web/            # Editor UI assets
└── adapters/
    ├── base.ts     # AgentAdapter interface
    ├── claude.ts   # Claude Code adapter (with session continuation)
    ├── codex.ts    # Codex CLI adapter (with session continuation)
    └── opencode.ts # opencode CLI adapter (with session continuation)

## Session File Structure

.pl4n/sessions/swift-river/      # Human-friendly session ID
├── meta.yaml                     # Task description, timestamp
├── state.yaml                    # Turn, phase, agent_plan_ids mapping
├── input.md                      # Original task input
├── plans/                        # Agent plan files
│   ├── sunny-glade.md            # Agent's persistent plan (plan_id)
│   └── amber-marsh.md            # Another agent's plan
├── turns/
│   ├── 001.md                    # Turn 1 synthesis (user edits this)
│   ├── 001.snapshot.md           # Pre-edit snapshot (for diffing)
│   ├── 001/                      # Debug snapshots
│   │   ├── sunny-glade-draft.md
│   │   └── sunny-glade-reviewed.md
│   └── ...
├── agents/                       # Agent runtime data
│   ├── sunny-glade/
│   │   ├── agent.log             # Session-wide debug log (appended)
│   │   └── session.txt           # CLI session ID for --resume
│   ├── amber-marsh/
│   │   ├── agent.log
│   │   └── session.txt
│   └── synthesizer/
│       ├── agent.log
│       └── session.txt
└── PLAN.md                       # Symlink to approved turn
