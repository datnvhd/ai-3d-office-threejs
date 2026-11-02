# My Office 3D — Three.js prototype

Interactive isometric AI office with clickable agents, task assignment form, simulated progress, camera orbit and zoom.

## Run

```bash
npm install
npm run dev
```

Open the local Vite address shown in your terminal.

## Claude Code connection

The top bar shows whether the app is connected to Claude Code. The dev server (`server/claude-bridge.js`) finds the Claude Code CLI (`CLAUDE_BIN`, `PATH`, `~/.local/bin`, or the VS Code extension's bundled binary) and exposes `/api/claude/*`:

- **Đăng nhập qua web** runs `claude setup-token` in a pseudo-terminal, which opens the Claude sign-in page. When sign-in finishes (or the code shown on the page is pasted into the dialog), the long-lived token is captured, verified with a one-line `claude -p` call, and saved to `~/.ai-3d-office/claude-auth.json`.
- The token stays on the server machine; the browser only sees a masked value. The API answers only requests from `localhost` and requires the `X-AI-Office` header on writes.
- Use the token only to run Claude Code (`CLAUDE_CODE_OAUTH_TOKEN=<token> claude -p ...`); `getSavedClaudeToken()` in `server/claude-bridge.js` reads it for a future task runner.

## Important

This is a front-end prototype. Tasks are simulated locally and **not** sent to Claude Code or another LLM. To integrate a real agent backend, replace the interval-based progress simulation in `src.js` with REST/WebSocket calls to an orchestrator, and bind each agent to an authenticated isolated execution environment.

## Codex (ChatGPT) connection

The **Codex** chip in the top bar signs in to OpenAI Codex CLI with a ChatGPT account (`codex login`, handled by `server/codex-bridge.js`). Credentials stay in Codex's own `~/.codex`. Tasks for agents mapped to Codex (`agentEngines` in `~/.ai-3d-office/machine.json`, default: Designer) run with `codex exec --json`: read-only sandbox, or `workspace-write` when file edits are allowed. If Codex is not signed in, those steps fall back to Claude Code and say so in the log.

## Automatic workflows

With **Tự tạo luồng công việc** on (default), any request, whoever it is assigned to, first goes to the Director, who splits it into steps for the relevant agents with dependencies (`workflow-plan.js`). Examples: a login page → design → design review → frontend + backend → QA; a bug fix → dev → QA re-test. On the machine the Director plans with one Claude call; if that fails, a keyword planner is used (it is also the planner in simulation mode). Each step starts when the steps it depends on are done and receives their results. If a step fails or is stopped, the steps after it stop; retrying it re-queues them.

## 3D character models (GLB)

Put `.glb` files in `public/models/` to replace the built-in characters (`character-models.js`). Per agent the app looks for `<agent id>.glb` (`director`, `research`, `frontend`, `backend`, `analyst`, `designer`, `qa`), then the shared sheet file: `manager.glb` (Director), `dev.glb` (Frontend, Backend, QA), `designer.glb` (Designer, Data Analyst), `student.glb` (Research AI). Models are scaled to office height, put on the floor and should face +Z. Clips named `idle`/`walk` inside the file, or separate `<name>-idle.glb` / `<name>-walk.glb` from the same rig, are used for standing and walking. Front/side/back reference crops for image-to-3D tools are in `character/for-3d/`.

## Attachments (drag & drop files)

Drop files on the task box — or use **📎 Đính kèm tệp** — to send them with the request (`POST /api/machine/upload`, then the task POST carries the ids). Supported: PDF, Word (`.docx`), images (PNG/JPG/GIF/WebP) and text (`.txt`/`.md`/`.csv`); up to 6 files, 25MB each. Images and PDFs are read by the agent from disk; `.docx` and text files are extracted to plain text and inlined in the prompt (so both Claude Code and Codex get them, and Codex also receives images via `-i`). Files are copied into `<workdir>/.ai-office-files/<task id>/` for the run and removed when the task (or its workflow) is deleted. Attachments flow to every step of an auto workflow. Only used on the **Máy cá nhân** runner, not in simulation.
