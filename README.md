# Pl4n (Bun + TypeScript)

Multi-agent ensemble planning CLI. Orchestrates multiple AI agents (Claude Code, OpenAI Codex) to collaboratively create implementation plans with human-in-the-loop review.

## Why Pl4n?

"A droid is only as good as its plan." Planning with multiple models produces more robust plans through:

- **Diversity**: Different models notice different things when exploring codebases
- **Peer review**: Agents critique each other's drafts before synthesis
- **Iteration**: Human feedback refines plans across multiple turns

## Install

From source:

```bash
bun install
bun run src/index.ts --help
```

## Quick Start

```bash
# Start a planning session (blocks until first turn is complete)
bun run src/index.ts init "Add user authentication"

# Review and edit the plan
# Edit .pl4n/sessions/<id>/turns/001.md

# Continue to next turn (blocks until agents complete)
bun run src/index.ts continue --session <session_id>

# Approve when satisfied
bun run src/index.ts approve --session <session_id>
```

## Web Editor

Pl4n can launch a lightweight web editor for reviewing and editing plans. When `init` or
`continue` completes, the server starts (if needed) and an `edit_url` is included in the
JSON output.

```bash
# Default behavior: start server and emit edit_url
bun run src/index.ts init "Add user authentication"

# Disable web editor
PL4N_WEB=0 bun run src/index.ts init "Add user authentication"
```

Manual server control:

```bash
pl4n server start            # start daemon
pl4n server stop             # stop daemon
pl4n server status           # check running status
pl4n server start --restart  # kill existing server, then start
pl4n server start --foreground   # run in foreground (dev)
pl4n server start --workspace /path/to/root  # scan a specific workspace
pl4n server start --bind 127.0.0.1           # bind address
```

For remote access (Tailscale/VPN), override the host used in URLs:

```bash
PL4N_HOST=100.x.x.x bun run src/index.ts init "Add user authentication"
```

Troubleshooting:
- If the browser cannot connect, check local firewall settings and that the port is reachable.
- If port 3456 (or `PL4N_PORT`) is taken, the server will try the next available port.
- Clipboard copy is best-effort; the URL is always printed in JSON output.

Server configuration lives in `~/.pl4n/config.yaml`:

```yaml
workspaces:
  - /Users/you/code
  - /Users/you/work
bind: 0.0.0.0
port: 3456
auth:
  mode: strict
```

Auth modes:
- `strict` (default) requires a `t` query param token for UI and API requests (the CLI provides `edit_url` with tokens).
- `trusted` skips token checks for allowlisted client IPs; other clients still need tokens.

For LAN + Tailscale access without tokens, use trusted mode with a CIDR allowlist:

```yaml
auth:
  mode: trusted
  trusted_cidrs:
    - 127.0.0.0/8
    - 10.0.0.0/8
    - 172.16.0.0/12
    - 192.168.0.0/16
    - 100.64.0.0/10
```

If `trusted_cidrs` is omitted, Pl4n defaults to the list shown above. CIDRs must be IPv4
(`::1` and IPv4-mapped IPv6 are supported; other IPv6 ranges are not).

You can also set a single workspace via `PL4N_WORKSPACE=/path/to/root`.
Server env overrides: `PL4N_BIND=0.0.0.0`, `PL4N_HOME=/custom/.pl4n`.

The server UI starts at `/projects` and links to project-scoped session lists and editors.

## How It Works

### Turn-Based Planning

Each turn follows this flow:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   DRAFT     │ -> │ PEER REVIEW │ -> │  SYNTHESIS  │ -> │ USER REVIEW │
│             │    │             │    │             │    │             │
│ Each agent  │    │ Agents      │    │ Merge into  │    │ Human edits │
│ writes plan │    │ review peer │    │ unified     │    │ turns/001.md│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

1. **Draft**: Each agent explores the codebase and writes an independent plan
2. **Peer Review**: Agents review each other's drafts and refine their own
3. **Synthesis**: Plans are merged into a unified proposal
4. **User Review**: Human edits `turns/NNN.md`, then calls `continue` or `approve`

### Session Continuation

Agents maintain context across turns via CLI session continuation:
- Claude Code: `--resume <session_id>`
- Codex: `resume <thread_id>`

This means agents accumulate codebase knowledge rather than starting fresh each turn.

### User Feedback as Diff

When you edit `turns/001.md` and call `continue`, agents receive your changes as a diff. They interpret your edits naturally:
- Deletions = remove this
- Additions = add this requirement
- Comments = feedback to address

## Commands

| Command | Description |
|---------|-------------|
| `pl4n init "task"` | Start new planning session (blocks until first turn complete) |
| `pl4n status --session <id>` | Check progress without blocking |
| `pl4n continue --session <id>` | Start next turn after your edits (blocks until complete) |
| `pl4n approve --session <id>` | Lock plan as final |
| `pl4n list` | List all sessions |
| `pl4n clean --session <id>` | Remove session data |
| `pl4n diff --session <id>` | Show changes between turns |
| `pl4n server start\|stop\|status` | Manage web editor server |

## File Structure

```
.pl4n/
├── pl4n.yaml                        # Agent/tool configuration
└── sessions/
    └── swift-river/                  # Human-friendly session ID
        ├── meta.yaml                 # Task description, timestamp
        ├── state.yaml                # Turn, phase, agent_plan_ids mapping
        ├── plans/
        │   ├── sunny-glade.md         # Agent's persistent plan (plan_id)
        │   └── amber-marsh.md         # Another agent's plan
        ├── turns/
        │   ├── 001.md                # Turn 1 synthesis (USER EDITS THIS)
        │   ├── 001.snapshot.md       # Pre-edit snapshot (for diffing)
        │   ├── 001-autosave.md       # Web editor autosave (cleared on save/continue)
        │   ├── 001/                  # Debug snapshots
        │   │   ├── sunny-glade-draft.md
        │   │   └── sunny-glade-reviewed.md
        │   ├── 002.md
        │   └── ...
        │
        ├── agents/
        │   ├── sunny-glade/
        │   │   ├── agent.log         # Session-wide debug log (appended)
        │   │   └── session.txt       # CLI session ID for --resume
        │   ├── amber-marsh/
        │   │   ├── agent.log
        │   │   └── session.txt
        │   └── synthesizer/
        │       ├── agent.log
        │       └── session.txt
        │
        └── PLAN.md                   # Symlink to approved turn
```

Global server state:

```
~/.pl4n/
├── config.yaml                       # Server config (workspaces, bind, port)
├── token                             # Global auth token for the web UI
├── server.json                       # PID/port metadata for the daemon
└── server.log                        # Server logs
```

**Key points:**
- Plan IDs (`sunny-glade`, `amber-marsh`) are opaque names mapped to agents in `state.yaml`
- Agents read/write their persistent plan file (e.g., `sunny-glade.md`)
- After synthesis, all agent plan files are synced to the canonical state
- Debug logs span the entire session (appended each turn)
- `meta.yaml` stores a `config` snapshot from `.pl4n/pl4n.yaml` at session init

## Configuration

Edit `.pl4n/pl4n.yaml` (or `.pl4n/pl4n.yml`) to configure agents:

```yaml
claude:
  allowed_tools:
    - Read
    - Edit
    - Write
  # See .pl4n/pl4n.yaml for the full default list
codex:
  full_auto: true
  search: true
opencode:
  agent: plan
agents:
  - id: opus
    type: claude
    model: opus
    enabled: true
  - id: codex
    type: codex
    model: gpt-5.2-codex
    thinking: xhigh
    enabled: true
  - id: free
    type: opencode
    model: opencode/deepseek-v4-flash-free
    enabled: true
synthesizer:
  id: synthesizer
  type: claude
  model: opus
  enabled: true
```

If the file is missing, built-in defaults are used: two agents — `opus` (claude, model
`opus`, thinking `ultrathink`) and `codex` (model `gpt-5.2-codex`, thinking `xhigh`) — with a
claude `opus` synthesizer. Config is per-project; there is no global agent configuration.
For Codex agents, `thinking` maps to `model_reasoning_effort` (valid values: none, minimal, low, medium, high, xhigh).
Codex constraints live under `codex` (defaults) or `agents[].codex` (overrides), with keys:
`full_auto`, `sandbox`, `approval_policy`, `dangerously_bypass`, `add_dir`, `search`, `config`, and `mcp`.
`config` and `mcp` are serialized to JSON and passed via `--config`.
For Claude agents, `claude.allowed_tools` maps to `--allowedTools`, and `claude.add_dir` maps to
`--add-dir`. Claude's allowlist is best-effort; shell commands can still write if they redirect
output. Override defaults per agent with `agents[].claude` or `agents[].codex`.
Opencode agents run any model the local `opencode` CLI has configured (format `provider/model`).
`opencode.agent` selects the opencode agent (default `plan`, which is read-only; the adapter
captures its text output and writes the plan file itself). `thinking` maps to `--variant`
(provider-specific reasoning effort, e.g. low, high, max; values are passed through unvalidated).
Note: non-plan opencode agents run with whatever permissions the local opencode CLI grants —
pl4n imposes no constraints on them (unlike `claude.allowed_tools` or the codex sandbox flags).
If you pass `--pl4n-dir`, the config is loaded from that directory.

## Architecture

```
src/
├── cli.ts          # CLI commands (sade)
├── models.ts       # Data models (SessionState, Phase, AgentConfig)
├── session.ts      # Session lifecycle management
├── orchestrator.ts # Turn orchestration (draft -> peer review -> synthesis)
├── prompts.ts      # Agent prompt templates
├── names.ts        # Human-friendly name generator
└── adapters/
    ├── base.ts     # AgentAdapter interface
    ├── claude.ts   # Claude Code adapter (subprocess, --resume)
    ├── codex.ts    # Codex CLI adapter (subprocess, resume)
    └── opencode.ts # opencode CLI adapter (subprocess, --session)
```

## Development

```bash
bun install
```

Run tests and checks:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Build the web editor assets:

```bash
bun run build:web
```

## Design Decisions

- **File-based protocol**: Agents communicate via files, making the system agent-agnostic
- **Turn-based iteration**: Each turn produces a numbered synthesis file
- **Opaque plan IDs**: Prevents models from confusing which file belongs to which agent
- **Session continuation**: Agents preserve codebase exploration context across turns
- **No special syntax**: Users edit plans naturally; agents interpret the diff
