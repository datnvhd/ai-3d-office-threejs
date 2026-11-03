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
- Use the token only to run Claude Code (`CLAUDE_CODE_OAUTH_TOKEN=<token> claude -p ...`); `getSavedClaudeToken()` in `server/claude-bridge.js` reads it for the task runner.
- Only that saved token is used: the Claude Code CLI's own (default) account on the machine is never used, and tasks do not run until an account is signed in through the app. The sign-in page opens in a new Chrome/Edge window with a throw-away profile (the CLI's `BROWSER` is pointed at a no-op so the default browser stays closed), so any account can sign in; the window and profile are removed when sign-in finishes or is cancelled. **Đăng nhập tài khoản khác** replaces the saved token.

## Important

This is a front-end prototype. Tasks are simulated locally and **not** sent to Claude Code or another LLM. To integrate a real agent backend, replace the interval-based progress simulation in `src.js` with REST/WebSocket calls to an orchestrator, and bind each agent to an authenticated isolated execution environment.

## Codex (ChatGPT) connection

The **Codex** chip in the top bar signs in to OpenAI Codex CLI with a ChatGPT account (`codex login`, handled by `server/codex-bridge.js`). Credentials stay in Codex's own `~/.codex`, so an account already signed in (e.g. through the ChatGPT VS Code extension, whose bundled `codex` binary is found automatically, or `CODEX_BIN`) is picked up without signing in again. Tasks for agents mapped to Codex (`agentEngines` in `~/.ai-3d-office/machine.json`, default: Designer) run with `codex exec --json`: read-only sandbox, or `workspace-write` when file edits are allowed. If Codex is not signed in, those steps fall back to Claude Code and say so in the log.

## Automatic workflows

With **Tự tạo luồng công việc** on (default), a request given to the **Director** goes to the Director as coordinator, who splits it into steps for the relevant agents with dependencies (`workflow-plan.js`). Examples: a login page → design → design review → frontend + backend → QA; a bug fix → dev → QA re-test. On the machine the Director plans with one Claude call; if that fails, a keyword planner is used (it is also the planner in simulation mode). A request given to any other agent always runs with that agent alone (the option is greyed out then). Each step starts when the steps it depends on are done and receives their results. If a step fails or is stopped, the steps after it stop; retrying it re-queues them.

## Model per task

**Model AI** and **Mức suy luận** (reasoning effort, `claude --effort`) on the task form default to **✨ Tự chọn**: each Claude Code task runs on the cheapest model + effort that does the job well. The model list in `workflow-plan.js` (`MODELS`) mirrors Claude Code's own catalog: price per million tokens and capability rank. In a workflow the Director picks a model and an effort (low / medium / high / xhigh; never max) for every step and says why (hover the model tag on the step). It only picks from the best value models: Haiku 5.5 ($0.1/$0.5), Sonnet 5.5 ($2/$10) and Opus 5.5 ($4/$20); Fable is not offered. Older versions (Opus 4.6–5, Sonnet 4.5–5, Haiku 4.5) can still be chosen by hand, but each is weaker and/or pricier than a newer one, e.g. Opus 4.8 ranks below Sonnet 5.5 at 2.5× the price. Choosing a model or an effort on the form forces it for every step. If the account cannot use a pinned version, the task runs once more on the newest model of that family and says so in its log. The planning call runs on Sonnet 5.5 at medium effort. Direct tasks and the keyword planner use `pickModel()` (in keyword plans only Frontend/Backend steps can go up to Opus). Codex tasks ignore these settings.

## 3D character models (GLB)

Put `.glb` files in `public/models/` to replace the built-in characters (`character-models.js`). Per agent the app looks for `<agent id>.glb` (`director`, `research`, `frontend`, `backend`, `analyst`, `designer`, `qa`), then the shared sheet file: `manager.glb` (Director), `dev.glb` (Frontend, Backend, QA), `designer.glb` (Designer, Data Analyst), `student.glb` (Research AI). Models are scaled to office height, put on the floor and should face +Z. Clips named `idle`/`walk` inside the file, or separate `<name>-idle.glb` / `<name>-walk.glb` from the same rig, are used for standing and walking. Front/side/back reference crops for image-to-3D tools are in `character/for-3d/`.

## Attachments (drag & drop files)

Drop files on the task box — or use **📎 Đính kèm tệp** — to send them with the request (`POST /api/machine/upload`, then the task POST carries the ids). Supported: PDF, Word (`.docx`), images (PNG/JPG/GIF/WebP) and text (`.txt`/`.md`/`.csv`); up to 6 files, 25MB each. Images and PDFs are read by the agent from disk; `.docx` and text files are extracted to plain text and inlined in the prompt (so both Claude Code and Codex get them, and Codex also receives images via `-i`). Files are copied into `<workdir>/.ai-office-files/<task id>/` for the run and removed when the task (or its workflow) is deleted. Attachments flow to every step of an auto workflow. Only used on the **Máy cá nhân** runner, not in simulation.

## WebMCP (tools for in-browser AI agents)

`webmcp.js` registers the office as [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools, so an AI agent running in the browser (e.g. a Chrome extension such as Google's example agent or the Model Context Tool Inspector) can use it:

| Tool | What it does |
|---|---|
| `list_agents` | agents (id, name, role) and how many tasks each is running |
| `list_tasks` | tasks, newest first; filter by `status` (running / done / error) and `agent` |
| `get_task` | one task with its full result or error, model, cost and timing |
| `assign_task` | give a task to an agent (same as the **Giao việc** button; options left out use the page's current settings) |
| `ask_task` | ask a follow-up question about a finished machine task (same conversation); `get_task` then shows the `thread` of questions and answers |
| `cancel_task` / `retry_task` | stop a running machine task / run a failed or stopped one again |
| `set_scene` | change the scenery outside (`day`, `sunset`, `campus`) |

`assign_task`, `ask_task`, `cancel_task` and `retry_task` are marked `consequentialHint`, so the browser asks the user before running them: on **Máy cá nhân** a task runs Claude Code / Codex for real. Tools are only visible to the page's own origin. WebMCP is experimental: it needs Chrome 149+ with the origin trial, or `chrome://flags/#enable-webmcp-testing` for local development. In other browsers nothing is registered and the app works as before. Attachments and the site picker are not available through the tools.

## Follow-up questions (Hỏi thêm)

A finished task on **Máy cá nhân** can be asked more without explaining it again: **💬 Hỏi thêm** on the result card, or the box under **HỎI THÊM** in the progress popup (Enter sends, Shift+Enter adds a line). The question continues the task's own conversation: Claude Code tasks keep their session id and run `claude -p --resume <id>`; Codex tasks keep their thread id and run `codex exec resume <id>`. Both use the task's original folder, permissions, model and web tools. If the session can no longer be opened, the question is sent once more with a recap of the task, its result and earlier questions. Answers are shown as a thread under the result (up to 30 per task) and their cost and turns are added to the task's totals; a failed or stopped question leaves the task done with the error on that question. Not available for simulated tasks or the Director's planning step (ask the steps it created instead). `POST /api/machine/tasks/:id/ask {text}` is the API.

## Opening local files in web tasks

Playwright MCP blocks `file://` URLs (allowing them would open the whole disk to the agent's browser). Instead, a web task opens files from its working folder over http: `http://localhost:<port>/api/machine/preview/<task id>/<relative path>`, e.g. `.../preview/39/sungroup-landing/index.html`. The prompt tells the agent this; CSS, JS and images load normally. Only files inside that task's folder are served (paths outside get 403) and, like the rest of `/api/machine`, only to this computer.

## Sending work back (trả lại để sửa)

Any workflow step can send earlier steps back to be fixed: QA → dev when a test fails, the Director → designer/devs when a review does not pass, a dev → designer when the design cannot be built, and so on. Each step's prompt lists the earlier steps (#1, #2… in plan order); the agent writes its full review, then ends with a `rework` block (`{"to":[3],"reason":"…"}`), parsed by `parseRework()` in `workflow-plan.js`. The server then:

1. adds a **· sửa lại** step for each target, which continues that agent's own session (`--resume` / `codex exec resume`) and gets the review as input; steps between the target and the reviewer are redone too;
2. adds the reviewer again as **· vòng N**, after the fixes, to check everything again;
3. makes steps that were already waiting (e.g. a hand-over after QA) wait for the newest versions instead.

Each step can send back at most `MAX_REWORK` (3) times; if it still does not pass, that step ends with an error and the workflow stops for the user to decide (retry it, or ask it a follow-up). In simulation, QA or the Director sends back once 40% of the time.
