# My Office 3D — Three.js prototype

Interactive isometric AI office with clickable agents, task assignment form, simulated progress, camera orbit and zoom.

## Run

Needs **Node.js 22.12 or later** (Vite 7); developed and built (CI) on **Node.js 26 LTS**. With nvm: `nvm install 26` then `nvm use 26`.

```bash
npm install
npm run dev
```

Open the local Vite address shown in your terminal.

## Desktop app (Windows, Ubuntu, macOS)

```bash
npm run app    # build, then open the office in an Electron window
npm run dist   # build release/AI-3D-Office-<version>-windows-x64-setup.exe (or GitHub Actions)
```

The installer bundles Electron (and its Node), so the other machine does not need Node.js or `npm install`. It still needs the **Claude Code CLI** (on `PATH`, `~/.local/bin` or the VS Code extension), **Chrome or Edge** for sign-in and web tasks, and optionally **Codex CLI**. Each machine signs in with its own account in the app; data goes to that user's `~/.ai-3d-office` as in dev (do not copy it between machines: it holds the token).

`electron/main.js` serves `dist/` with `vite preview` on `127.0.0.1:47820` (the next free port if taken) with the same `/api` bridges as the dev server, and shows it in a window. Only one copy runs at a time; closing the window stops running tasks. Node scripts the server starts with `process.execPath` (Playwright MCP, a `.js` Codex) get `ELECTRON_RUN_AS_NODE=1` (`NODE_ENV` in `server/claude-bridge.js`). The app is not code-signed, so Windows SmartScreen shows "Windows protected your PC" on first run (**More info → Run anyway**). Launching Electron from a shell that has `ELECTRON_RUN_AS_NODE` set (e.g. a VS Code extension host) runs it as plain Node: unset it first.

### Ubuntu (22.04 and later)

```bash
npm run dist:linux   # needs Docker; writes release/ai-3d-office_<version>_ubuntu_amd64.deb (or GitHub Actions)
```

`scripts/build-linux.js` copies the sources into a `node:26-bookworm` container and installs the dependencies there, so the native modules (node-pty, esbuild, rollup) are the Linux ones; it works from Windows too. On the Ubuntu machine:

```bash
sudo apt install ./ai-3d-office_1.0.0_ubuntu_amd64.deb   # pulls in the libraries it needs
ai-3d-office                                       # or "AI 3D Office" in the app menu
```

Tested on clean Ubuntu 22.04 and 24.04 containers. The package declares `libgbm1` and `libasound2t64 | libasound2` besides electron-builder's default list (24.04 renamed the ALSA library; in the other order apt picks an OSS stand-in). On 24.04 the package installs an AppArmor profile so Chromium's sandbox works. Web tasks need **Google Chrome or Microsoft Edge** from their `.deb` (`/opt/google/chrome`, `/opt/microsoft/msedge`); snap Chromium is not supported by Playwright. Started from the app menu, the app takes `PATH` from the user's interactive login shell so `claude`/`codex` installed through nvm or `npm -g` are found.

### macOS (12 Monterey and later, Apple Silicon and Intel)

```bash
npm run dist:mac            # on a Mac: release/AI-3D-Office-<version>-macos-<arm64|x64>.dmg for this Mac's chip
npm run dist:mac -- --ci    # from any OS: GitHub Actions builds both chips (needs gh signed in, branch pushed)
```

A `.dmg` can only be built on macOS. `npm ci` installs the native modules (node-pty, esbuild, rollup) of the Mac's own chip; to build for the other chip, `scripts/build-mac.js` adds that chip's native packages at the versions in `package-lock.json` (the packaged app loads the ones of the chip it runs on). `.github/workflows/build-mac.yml` builds both dmg files on `macos-15-intel`, because GitHub's Apple Silicon runners are often queued for a long time: the Intel app is started with `AI_OFFICE_SELFTEST=1` (serves the page and the machine API, prints them, quits); the Apple Silicon app, which an Intel Mac cannot start, is checked to be arm64 throughout (main executable, Electron framework, node-pty/esbuild/rollup binaries). The dmg files are kept as the run's artifacts (`gh run download --name ai-3d-office-macos-arm64`). It also runs on tags `v*`.

Signing (`scripts/build-mac.js`): with a **Developer ID Application** certificate (in the keychain, or `CSC_LINK`/`CSC_KEY_PASSWORD`; in CI the secrets `MAC_CERT_P12_BASE64`/`MAC_CERT_PASSWORD`) the app is signed with the hardened runtime (`electron/entitlements.mac.plist`: JIT, unsigned native modules and child CLIs), and notarized when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set. Without a certificate it is signed ad-hoc: it runs, but Gatekeeper blocks the first open of a downloaded copy. Right-click the app → **Open** (macOS 15: System Settings → Privacy & Security → **Open Anyway**), or `xattr -dr com.apple.quarantine "/Applications/AI 3D Office.app"`.

On the Mac: open the dmg, drag **AI 3D Office** to Applications. It needs the same CLIs as elsewhere (Claude Code, optionally Codex) and Chrome or Edge (in `/Applications` or `~/Applications`). The app takes `PATH` from the login shell (zsh) and also looks in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.maestro/bin` and the Android SDK (`~/Library/Android/sdk`). Other disks show under `/Volumes` in the folder picker. Task processes run in their own process group, so stopping a task (or the task ending) also stops what it started: Metro, a simulator build, the browser. For iOS checks install **Xcode** (with a simulator runtime); see [React Native apps](#react-native-apps).

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

Drop files on the task box — or use **📎 Đính kèm tệp** — to send them with the request (`POST /api/machine/upload`, then the task POST carries the ids). Supported: PDF, Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`/`.xlsm`), audio (`.mp3`/`.m4a`/`.wav`, e.g. video music), images (PNG/JPG/GIF/WebP) and text (`.txt`/`.md`/`.csv`/`.tsv`/`.json`/`.xml`/`.html`/`.log`/`.yaml`/`.ini`/`.sql`); old `.xls`/`.doc` are passed as files for the agent to convert. Up to 6 files, 25MB each. Images and PDFs are read by the agent from disk; `.docx`, `.pptx` and text files are extracted to plain text and inlined in the prompt (so both Claude Code and Codex get them, and Codex also receives images via `-i`). An Excel workbook is split into one CSV per sheet (`<file>.sheets/<sheet name>.csv`, dates as ISO, formulas as their saved value) and the prompt lists every sheet with its size and a preview, so a request can name the sheet it wants (`server/file-extract.js`, no extra packages). Files are copied into `<workdir>/.ai-office-files/<task id>/` for the run and removed when the task (or its workflow) is deleted. Attachments flow to every step of an auto workflow. Only used on the **Máy cá nhân** runner, not in simulation.

### Google Sheets / Docs / Slides / Drive links

Links to Google files in a request (up to 5) are downloaded when the task is created and attached like dropped files (`server/google-bridge.js`): a Sheet as `.xlsx` (so every sheet is read by name; with the Sheets API on, the prompt also says which sheet the link's `gid` opens), a Doc as `.docx`, Slides as `.pptx`, a Drive file as itself. Folders are not supported.

- Files shared **"anyone with the link"** download without an account.
- Other files need a Google account: the **Google** chip in the top bar signs in with read-only Drive access (`drive.readonly`, OAuth for a desktop app with a loopback redirect and PKCE, opened in the default browser). It needs an OAuth client from your own Google Cloud project (Drive API on, consent screen with your email as a test user, client type **Desktop app**): paste its ID and secret (or the downloaded JSON) in the chip, or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The refresh token is kept in `~/.ai-3d-office/google-auth.json` and never reaches the page or the AI.
- When a link needs an account that is not signed in (or the signed-in account cannot open it), the task is not created: the API answers 409 and the page opens the Google chip with the reason, so the user signs in (or switches account) and assigns the task again. Signing in only works on the machine running the app.

## Math video agent (short math explainers, MP4)

The **Math Video** agent (team **Video**) makes vertical 9:16 math shorts (1080×1920, 30–60 s) for secondary-school students: a narration script, a Manim animation (geometry, graphs, functions…), a Vietnamese voice, word-by-word captions and an MP4, in TikTok / Shorts / Reels formats (opening hook, 3-second quiz with countdown, common mistake, quick trick, recap card). Any agent whose team is `Video` (or whose role mentions video) works this way; its prompt carries the guide in `videoGuide()` (`server/machine-bridge.js`).

- **Toolbox** (`server/video-kit.js`): a private Python 3.12 in `~/.ai-3d-office/video-kit/venv` with Manim, edge-tts (Microsoft neural voices `vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`, needs Internet) and a bundled ffmpeg (imageio-ffmpeg). Installed the first time a video task runs (about a minute; with `uv` if present, else the machine's Python 3.10–3.13). A `mathvid` launcher goes on PATH for the agents; the team's **Video toán** kit allows it.
- **`mathvid`** (`server/video-kit/mathvid.py`): `build script.json scene.py --out x.mp4 [--draft] [--music m.mp3]` runs narration (cached per segment, retried when the voice service drops), Manim render (60 fps), mux (voice + optional ducked music + burned-in captions, loudness −14 LUFS, H.264/AAC, constant frame rate, a keyframe every second, index at the front) and a 12-frame contact sheet the agent looks at to check its work. Work files stay in `.mathvid/` (skipped by the change tracker).
- **Speed** (`"speed": 1.25` in script.json or `--speed`): applied while making the video, not afterwards — the voice is sped up with the same pitch, the timings shrink, and every Manim animation and pause runs that much faster (`Short.play/wait`), so no frame is dropped.
- **Scenes** use `server/video-kit/mathvid_style.py`: a 9×16-unit frame, palette, Vietnamese fonts, Unicode formulas (`M("x^2")` → x²; LaTeX is used only when installed), narration sync (`self.at(id)`, `self.hold(id)`, `self.left(id)` from `timings.json`) and trend blocks (`hook`, `quiz`, `reveal`, `wrong`, `recap`, progress bar). `server/video-kit/examples/pytago/` is a complete example.
- **Creative videos** (confessions, Valentine, birthdays, anniversaries, thanks to teachers…): the agent picks this mode from the request. Scenes set `theme = "romantic" | "birthday" | "galaxy" | "sunset"` and use the effects in `server/video-kit/mathvid_fx.py` (glow, the heart equation drawn by a glowing pen, heartbeat, dots gathering into a shape, typed text, sparkles, fireworks, floating hearts, glowing graphs, end title). They usually have no voice (`"voice": "none"`, each segment a `duration`) and an original backing track synthesised by `mathvid` (`"music": "romantic" | "dreamy" | "happy" | "upbeat"`, no copyright). Example: `server/video-kit/examples/to-tinh/`. The Director gives such requests to the video agent alone (no research/QA steps).
- Output goes to `<workdir>/video-toan/viec-<task or workflow id>/` (writable even in read-only mode, like design mockups). The result card plays the MP4 and offers the downloads. Audio files (`.mp3/.m4a/.wav`) can be attached as background music.
- **Workflows**: a video request to the Director goes research (facts + script) → Math Video (render) → QA (checks the frames, maths and spelling, can send it back). Codex tasks get network access in their sandbox for the voice.

## Tokens per task

Every run of a task adds its tokens to `task.tokens` (`input`, `cacheRead`, `cacheWrite`, `output`, `total`, `runs`, `models`): the first run, answers to its questions, follow-up questions, retries and a workflow's planning step. Claude Code's `result` event gives `modelUsage` per model (the main model plus helpers such as Haiku); Codex's `turn.completed` gives `usage`, whose `input_tokens` includes the cached part (stored as `cacheRead`). The task lists (office result cards, phone list) show `🔢 28K token` with the breakdown on hover; a workflow card shows the total of all its steps. Tasks run before this was added have no count.

## AI plan quota

The **Máy cá nhân** window (section *Hạn mức gói AI*) shows what is left of each plan's usage windows, with bars, reset times and the agents assigned to that AI; the selected agent's panel shows the same in one line. `GET /api/machine/quota` (`?fresh=1` re-reads; button **⟲ Kiểm tra quota**) comes from `server/ai-quota.js`:

- **Codex (ChatGPT)**: `codex app-server` → `account/rateLimits/read` (5-hour and weekly %, plan, free reset credits). No usage is spent and Codex reads its own login.
- **Claude**: the plan's limits only come back as response headers (`anthropic-ratelimit-unified-5h/7d-utilization`, `-reset`), so the app sends one 1-token Haiku request with the saved token. The answer is cached for 5 minutes (Codex 2 minutes) and the page re-reads every 10 minutes.

## Downloading what a task produced

Files a task created or edited (from its before/after picture of the working folder) can be downloaded: the result shows a **File kết quả** box where each name downloads that file, plus **Tải tất cả (.zip)** when there are several; file paths the agent writes in its answer as `code` become download links too, and so do the names in the task's change list. `GET /api/machine/tasks/:id/file?path=<path>` serves only a file in that task's change list that still exists inside its working folder; `GET /api/machine/tasks/:id/files.zip` zips them all (up to 300MB). Nothing is offered once the task is undone. Works on the phone page and through remote access too.

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

## Skills (gõ /)

Agents use the skills on the machine (folders with a `SKILL.md`): personal Claude Code skills in `~/.claude/skills`, Codex skills in `~/.codex/skills` and `~/.agents/skills`, and the working folder's `.claude/skills` (`server/skills.js`).

- **Automatic:** Claude Code loads `~/.claude/skills` and the project's skills itself; every prompt also lists the skills the running CLI does not load on its own (name, description, path), so a Codex task can use a Claude skill and the other way round when it fits.
- **On request:** type `/` in the task box, the **HỎI THÊM** box, the answer box when an agent asks you something (or the phone page's boxes) to get the list; ↑↓ to move, Enter/Tab to insert `/name`, Esc to close. **🧩 Skill** under the task box and 🧩 next to **Gửi** in the follow-up and answer boxes open the same list. A `/name` in a request, a follow-up or an answer puts that skill's whole `SKILL.md` into the prompt (Claude Code and Codex alike) and is passed to every step of a workflow.
- **Import:** the last row of the list imports a `.zip` / `.skill` (one or more folders with a `SKILL.md`) or a single `SKILL.md` (needs `name:` in its front matter) into `~/.claude/skills/<name>`, replacing a skill of the same name. ✕ on a personal skill removes its folder. Import and remove only work on the computer running the app, not through remote access.

API: `GET /api/machine/skills`, `POST /api/machine/skills/import` (raw body, file name in `X-Filename`), `DELETE /api/machine/skills/:name`.

## Opening local files in web tasks

Playwright MCP blocks `file://` URLs (allowing them would open the whole disk to the agent's browser). Instead, a web task opens files from its working folder over http: `http://localhost:<port>/api/machine/preview/<task id>/<relative path>`, e.g. `.../preview/39/sungroup-landing/index.html`. The prompt tells the agent this; CSS, JS and images load normally. Only files inside that task's folder are served (paths outside get 403) and, like the rest of `/api/machine`, only to this computer.

## Sending work back (trả lại để sửa)

Any workflow step can send earlier steps back to be fixed: QA → dev when a test fails, the Director → designer/devs when a review does not pass, a dev → designer when the design cannot be built, and so on. Each step's prompt lists the earlier steps (#1, #2… in plan order); the agent writes its full review, then ends with a `rework` block (`{"to":[3],"reason":"…"}`), parsed by `parseRework()` in `workflow-plan.js`. The server then:

1. adds a **· sửa lại** step for each target, which continues that agent's own session (`--resume` / `codex exec resume`) and gets the review as input; steps between the target and the reviewer are redone too;
2. adds the reviewer again as **· vòng N**, after the fixes, to check everything again;
3. makes steps that were already waiting (e.g. a hand-over after QA) wait for the newest versions instead.

Fix steps and re-check rounds jump the queue and may use 2 slots beyond the normal limit of 2 parallel tasks, so a sent-back agent starts right away instead of waiting for unrelated work.

A finished step can also send back from a follow-up: ask the QA step **Hỏi thêm** "check again, send it back to dev if it still fails", and it re-checks the folder as it is now. If it ends with a `rework` block, the same fix steps and a new re-check round are queued (the fix steps get the user's request and that re-check's findings); the step's own result stays and its answer says where the work went. Follow-up send-backs count toward the same limit.

Each step can send back at most `MAX_REWORK` (3) times; if it still does not pass, that step ends with an error and the workflow stops for the user to decide (retry it, or ask it a follow-up). In simulation, QA or the Director sends back once 40% of the time.

## Adding, editing and deleting agents

**＋ Thêm** at the end of the agent picker adds an agent: name, short role, a description of what it does and how (sent with every task it gets, and shown to the Director when it plans workflows), a look (developer, designer, manager, young) and a colour. **✎** next to the selected agent edits its name, role and description (built-in agents too; their look stays); **🗑** deletes it. The Director cannot be deleted. Old tasks of a deleted agent are kept.

The list is saved on the server in `~/.ai-3d-office/agents.json` (`GET/POST /api/machine/agents`), so every browser on this machine sees the same office; without that file the 7 built-in agents are used. The office has 36 desks: the 7 built-in ones, 24 in the added rows and 5 older stand-still ones (back row by the windows, back-to-back desks in the glass room). A new agent takes a free built-in desk first (one freed by deleting an agent), then the added rows, then the stand-still desks; custom agents already at a stand-still desk move to a free desk in the added rows. Agents at the stand-still desks stay put; all others walk around. Adding, deleting or changing an agent's look reloads the page. Custom agents run on Claude Code; a custom `public/models/<agent id>.glb` or the GLB of their look is used when present.

## Office layout

The office floor is 22.4 × 16 m (office coordinates x∈[-5.6,16.8], z∈[-4,12], see `ROOM` in `office.js`); the office group is shifted so its centre sits at the world origin, in the middle of the city block (`outdoor.js` roads moved out to fit). The original room is the back-left quarter (its former glass room no longer has glass walls). The added space has four rows of six desks (right and front-right), a closed meeting room (about 6.6 × 6.2 m, the outer wall with its window as one side) with a long table and a wall screen, a break area with two sofas, and a coffee corner with a water dispenser. Agents walk there along the aisles in `wander.js` (spine at x=5.9, one aisle per desk row) and stop at the sofas, the coffee corner, the ends of the desk aisles or a colleague's desk; about a third of them can be away from their desk at once.

## Planning meetings

While the Director plans a workflow (and for a 20-second briefing after), the Director walks to the head of the meeting table and one idle colleague per role (e.g. one frontend dev, one backend dev, one BA, one QA…) joins, up to 10 people (`updateMeeting()` in `src.js`, seats in `wander.js`). Anyone given a step gets busy and goes back to their desk; the others leave when the briefing ends. Agents at the stand-still desks do not join. Works for both the personal machine and simulation.

## Teams, levels and leaders

Every agent has a **team** and a **level**: Leader, Senior, Middle or Junior (set in the ✎ / ＋ Thêm form; shown as Lead/Sr/Mid/Jr in the picker). Each team always has exactly one Leader: `normalizeLeaders()` in `workflow-plan.js` promotes the most senior member when a team has none and turns extra Leaders into Seniors; choosing someone as Leader in the form makes the previous one Senior. Built-in agents are the Leaders of their own teams (Ban điều hành, Research, Frontend, Backend, Data, Design, QA).

Work goes to the matching level. The Director's planning prompt lists everyone's team and level and asks for hard or risky steps → Senior (or the Leader), normal steps → Middle, simple repetitive steps → Junior, reviews → the team's Leader, and different people for parallel steps of one team. The keyword planner (fallback and simulation) does the same with `staff()`: difficulty comes from the step's model pick (Opus = hard, Haiku = easy) and "duyệt/tổng hợp" steps are reviews. Each agent's prompt says its team and level and what that level means.

## At the desk

At its desk an agent always sits on the chair facing the screen and types (from page load on, working or not); it only gets up to stroll, visit a colleague or join a planning meeting (`setSit()` in `characters.js`, `tosit`/`sitting` states in `wander.js`). Name labels above agents are hidden; click an agent (or its button in the picker) to select it.

## Speech bubbles

A bubble over an agent says what it just took on ("📥 Tiếp nhận: …"); when it finishes it says who it hands over to ("Tôi đã xong, chuyển đến QA Tester 4"), that it sent work back ("↩ Chưa đạt, trả lại …"), or, when the whole job is done, "Tôi đã xong ✅" and the result opens in the progress popup. The Director says who the plan goes to. Jobs that were already there when the page opened are not announced.

## Pasting images and dropping files

Paste a screenshot or copied file into the task box (Ctrl+V; pasted images are named `anh-dan-<time>.png`), or drop files anywhere on the left panel; they are attached like **📎 Đính kèm tệp**.

## Toolkits for the IT team

The **Máy cá nhân** window has **BỘ CÔNG CỤ CHO ĐỘI IT**: per team, which kits of shell commands its agents may run through Claude Code's Bash tool (`TOOLKITS` / `DEFAULT_TEAM_KITS` in `server/machine-bridge.js`, saved as `teamKits` in `~/.ai-3d-office/machine.json`):

| Kit | Commands | Default teams |
|---|---|---|
| Xem file | ls, cat, find, grep, rg, tree… | all |
| Git | status, diff, log, show, blame; add/commit/checkout/stash when edits are allowed | Frontend, Backend, QA, Ban điều hành |
| Node.js ✎ | npm, pnpm, yarn, npx, node, tsc, eslint, prettier | Frontend, Backend |
| Python ✎ | python, pip, pytest | Backend, Data |
| Chạy test ✎ | npm test, vitest, jest, playwright test, pytest | Frontend, Backend, QA |
| GitHub CLI | gh issue/pr/run view & list; create/comment when edits are allowed | Frontend, Backend |
| Tài liệu & sơ đồ ✎ | Mermaid CLI, pandoc | BA |
| Mobile (RN) | xcrun simctl, xcodebuild, adb, emulator, maestro (looking, tests, screenshots); expo, react-native, pod install, gradlew when edits are allowed. Only given when the working folder is a React Native app | Frontend, QA (added to saved lists that have Node.js or Chạy test) |
| Trình duyệt | web tools (Playwright) on for every task of the team | QA, Design |

The permission mode (read-only or file edits) is the one set in the **Máy cá nhân** window when a task runs, and again each time it carries on: answering its question, asking more, retrying, and later workflow steps. Switching to edits after an agent said it could not write takes effect on the next answer or retry; the agent is told the mode changed and the log shows it.

✎ kits only apply when the permission mode allows edits; in read-only mode only the looking commands are allowed. `git push`, `git reset --hard`, `git clean`, `rm -rf`, `npm publish` and deleting repos/releases are always blocked. Each agent's prompt lists the commands it may use; anything else asks for approval and is therefore refused. (Claude Code itself still lets a few harmless read-only commands through, such as `whoami` or `--version`.) Codex agents use their own sandbox instead.

## Asking back when information is missing

Every agent is told: if important information is missing and no sensible assumption can be made, don't guess — stop and end the answer with a `question` block (`{"question":"…","options":["…","…"]}`, parsed by `parseQuestion()` in `workflow-plan.js`); if it can assume, it goes on and states the assumption. The Director's planner may answer `{"question":…,"options":[…]}` instead of a plan when the request is too vague.

The task then shows **Chờ bạn trả lời** (status `waiting`): the agent's bubble shows the question, the result card (and the workflow card, and the progress popup) shows the options as buttons plus a box for your own answer (Enter sends). Later workflow steps wait. Answering (`POST /api/machine/tasks/:id/answer {text}`) continues the same Claude/Codex session (or re-sends the task with the exchange if the session is gone); for the planner the answer is added to the request and the plan is made again. Each task can ask up to `MAX_CLARIFY` (3) times; after that the agent is told to assume. The exchange is listed under **ĐÃ TRAO ĐỔI** in the popup. In simulation, a request of fewer than six words makes the agent ask once.

## Office life

- **Monitors run** while their agent sits at the desk: code scrolling (Frontend/Backend), tests passing (QA), a document being typed (BA, Research), live charts (others). Four shared animated canvases in `office.js` (`WORK`), one overlay per desk (`addWorkScreen`), switched by wander's `desk` event.
- **Staff stay at their desk** and only get up now and then (every few minutes) or for a meeting. **Leaders do rounds**: they walk to members of their team — mostly those who are working — ask how it goes or cheer them on (speech bubbles, the member answers), and about one round in three they first fetch a drink at the pantry or coffee corner and leave it on the member's desk. The Director visits the team Leaders. (`patrol()` in `wander.js`, `wanderEvent()` in `src.js`.)
- **Meeting room TV**: while the Director plans (and during the briefing) it shows the plan — who attends, then each step with its owner and level laid out by phase (dependency depth), progress and steps per team; otherwise a work report of done / in progress / failed tasks per team (`drawBoard()` in `src.js`).

## No leftover .md files

Agents are told not to write .md files (reports, notes, plans) unless asked and to put that content in their answer. As a safety net the server lists the working folder's .md files before each run and deletes the new ones afterwards, unless the request asked for a markdown/README/file (`cleanMd()` in `server/machine-bridge.js`; skips node_modules, dist, hidden folders…). Files that existed before the run are never touched; what was removed is noted in the task log ("🧹 Đã xóa …").

## Design images for developers

Design agents (team Design, the built-in Designer, or a role about design/UI/mockups) are told to draw each screen, state or component as a standalone HTML (or SVG) file in `<workdir>/.ai-office-design/<task id>/` (`01-dang-nhap.html`, `02-dang-nhap-mobile.html`…; desktop frame 1440px, files with "mobile" in the name 390px; `<title>` names the image). When the task ends the server opens them in a headless Chrome/Edge (playwright-core) and saves a PNG of each (`shootDesigns()` in `server/machine-bridge.js`). That folder belongs to the app, so a design task writes there even in read-only mode: Claude Code gets an `Edit(.ai-office-design/<task id>/**)` rule only, Codex runs `workspace-write` with that folder as its workspace (the project is read by its full path). Other project files stay read-only.

The progress popup of the design task shows the images (click for full size) with **Dev code theo ảnh này** per image (all marked by default) and **💻 Giao dev code theo N ảnh đã chọn**, which picks a free Frontend developer and attaches the marked images to the next task. Later steps of the same workflow (review, dev, QA) get the marked images of the newest design step automatically. Their prompt lists each image with its PNG and HTML paths and asks them to open the images (Claude Code's Read tool shows images) and follow them; Codex agents also get the images attached with `-i`. Deleting a task removes its design folder.

Codex on Windows: its default workspace-write sandbox still blocked every write, so tasks that needed to write files (like the Designer's screens) could not; `codexExec` now enables Codex's `experimental_windows_sandbox` on Windows whenever writes are allowed.

## React Native apps

When the working folder is a React Native app (`react-native` or `expo` in `package.json`, in the folder itself, one level down such as `mobile/`, or in a monorepo's `apps/*`/`packages/*`), `server/mobile.js` tells every agent so and what this machine can run it on (Xcode and its iOS simulators on macOS, Android SDK with its emulators and connected devices, Maestro). The **Máy cá nhân** window shows the same under **KIỂM THỬ APP MOBILE**, and the health check lists it (it never fails the check).

- **Designer**: phone frames only (file names with `mobile`, 390px), iOS/Android conventions.
- **Developers**: React Native components rather than HTML/CSS, `npx expo install` for native libraries, static checks before finishing.
- **QA**: three levels, each when possible, and says which ran and which were skipped and why:
  1. static: `tsc --noEmit`, `eslint`, `jest` (any OS);
  2. Expo web: `npx expo start --web` in the background, then the browser (opened as an iPhone 15 with touch for RN projects) to use the app and take screenshots (any OS; close to but not the same as native);
  3. native: `npx expo run:ios` / `react-native run-ios` on the iOS Simulator (**macOS only**), `run:android` on an emulator or device, Maestro flows in `.maestro/`. Screenshots (`xcrun simctl io booted screenshot`, `adb exec-out screencap`) go to the task's run folder and show under **Ảnh chụp** in the progress popup, next to the designer's images to compare.
- The Director's plan is told the project is a mobile app and what the machine can test.

Building and running in a simulator needs the edit permission mode (it creates `ios/`/`android/`, installs Pods); such tasks get 45 minutes instead of 20. iOS can only be checked on a Mac: on Windows/Linux QA does levels 1–2 and Android. `Pods`, `DerivedData`, `.expo` and `.cxx` are skipped by the before/after snapshot. Mobile checks are written for Claude Code agents; Codex's sandbox may block simulators and the network.

## Remote access (phone or another computer opens this office)

For a team that keeps one machine running the agents (for example a Mac mini that builds and tests iOS apps), **TRUY CẬP TỪ XA · ĐIỆN THOẠI & MÁY KHÁC** in the **Máy cá nhân** window lets a phone or another computer open the same office in a browser. Both kinds are off by default; each link has a **Mã QR** button for the phone to scan.

- **Cùng mạng** (same Wi-Fi/LAN): `server/remote-access.js` listens on `0.0.0.0:47821` (next free port if taken) and forwards to the local server; the agents, files and accounts stay on this machine. One link per network address, `http://<ip>:47821/?key=<access key>` (adapters of VMs, WSL and containers are left out). The 128-bit key is checked once in the link and then kept in an HttpOnly, SameSite=Strict cookie; 20 wrong keys from one address in 15 minutes are refused. Plain HTTP: for a trusted network only.
- **Mọi mạng** (4G, another Wi-Fi): a Cloudflare quick tunnel (`server/tunnel.js`) gives an `https://….trycloudflare.com` link without an account, an open router port or a fixed IP. `cloudflared` is the official release, downloaded into `~/.ai-3d-office/tools` and checked against its sha256 the first time. Because the link is on the internet it needs a **password** set in the window (8+ characters, scrypt hash in `machine.json`) besides the key in the link: the tunnel points at a second remote server on `127.0.0.1` only, which asks for the password, limits wrong tries (10 per device and 100 in total per period), and keeps the device signed in for 30 days with a Secure cookie that stops working when the key or the password changes. The link changes each time the app starts or the tunnel drops (it restarts by itself); open the window again for the new one.
- **Đổi mã** makes every old link and signed-in device stop working; switching a kind off closes it.
- Forwarded requests carry a per-process secret header (`isRemoteReq()`), so the bridges know them from this machine's own window. A remote viewer can give and follow tasks, answer, allow or deny commands, review diffs and change the working folder or permission mode, but cannot sign in to Claude/Codex, add or change saved web passwords, fill a task's login form, change remote access, auto-run permissions or AI updates (blocked both in the forwarder and in the bridges); the access key is never sent to it. Windows/macOS may ask once to allow incoming connections.

### Phone page

A phone (touch screen up to 900 px wide) opening the office gets `m.html` (`mobile.js`, `mobile.css`): no 3D scene, about 25 KB of script, only the AI list, the task box (priority, model, the Director's workflow switch) and the results. Tapping a result opens it full screen: the answer, questions with their options, permission requests (Cho phép / Luôn cho phép / Từ chối), stop, retry, follow-up questions and the log; the phone's Back button closes it. It polls every 2 s while something runs, every 7 s otherwise, and not at all while the page is hidden. **Bản 3D** opens the full office for that browser tab, laid out for the phone: the 3D office on top (the camera picture is shifted so the office sits in the free part; one finger turns it, two fingers zoom, a tap on an agent opens its tasks), a sheet below with the **✍ Giao việc** and **📋 Kết quả** tabs (the agents as one swipeable row; the result tab counts running tasks; giving a task switches to it), and a tap on the open tab folds the sheet away to show the whole office. No shadows and a lower render resolution there keep it smooth; windows open full screen. **Bản gọn** goes back to the light page.

## Installers from GitHub Actions

Three workflows build the installers on GitHub's own machines, start the packaged app with `AI_OFFICE_SELFTEST=1` (serves the page and the machine API, prints them, quits) and keep the files as the run's **Artifacts** (Summary page of the run, at the bottom; signed-in users of the repo can download them for 90 days):

| Workflow | Runner | File | Check |
|---|---|---|---|
| Windows installer (.exe) | windows-latest | `AI-3D-Office-<version>-windows-x64-setup.exe` | unpacked app self-test (waits for the app only, not daemons such as adb) |
| Ubuntu installer (.deb) | ubuntu-22.04 | `ai-3d-office_<version>_ubuntu_amd64.deb` | installed with apt on a clean Ubuntu 24.04 runner, then self-test under Xvfb |
| macOS installer (.dmg) | macos-15-intel (both chips) | `AI-3D-Office-<version>-macos-arm64.dmg`, `…-macos-x64.dmg` | codesign verify; x64 self-test; arm64 architecture check |

All three run on a pushed tag `v*` (e.g. `git tag v1.0.1 && git push origin v1.0.1`), and from the Actions tab (**Run workflow**) once the files are on the default branch.

## AI plan usage limits (Claude ↔ Codex)

When a run is refused because the plan's usage limit is used up (Claude: 5-hour, daily or weekly limit; ChatGPT/Codex: 5-hour or weekly), `server/ai-limits.js` reads the CLI's message and when it resets (epoch, `resets 3pm`, `resets Nov 10, 8am`, `try again in 2 days 3 hours`, `resets_in_seconds`; unknown → retry after 1 hour, a bare HTTP 429 → 10 minutes). The task runner then:

- remembers the limit in `machine.json` (kept across restarts) and uses that engine again once the reset time has passed;
- puts the task back in the queue on the **other** engine: Claude used up → Codex, Codex used up → Claude Code. Follow-ups and answers carry on there with the exchange recapped; the log says why (`Claude hết hạn mức đến 23:00: việc này chạy bằng Codex.`);
- sends new tasks of that engine straight to the other one while the limit lasts; the Director plans with Codex when Claude is used up;
- when **both** are used up, stops the task (and the Director's planning) with one message giving both reset times, turns the **Máy cá nhân** chip red ("hết hạn mức AI") and shows a toast once.

**HẠN MỨC GÓI AI** in the Máy cá nhân window shows each plan's state, **Dùng lại ngay** (after upgrading the plan or an early reset) and **Tự chuyển sang AI còn hạn mức** (on by default; off: the task stops with the limit message instead). The health check lists it too. Switching needs the other CLI installed and signed in.

## Letting chosen agents run commands without asking

By default every command outside the team's toolkits (and every file edit Claude Code wants to confirm) waits for the user to click **Cho phép** in the page. **QUYỀN TỰ CHẠY LỆNH CỦA TỪNG AI** in the **Máy cá nhân** window sets, per agent:

| Level | What runs without asking |
|---|---|
| **Hỏi mỗi lần** (default) | nothing beyond the toolkits |
| **Tự chạy lệnh** | shell commands; file edits still follow the permission mode |
| **Tự cho phép tất cả** | shell commands, file edits **inside the working folder** (even in read-only mode) and the other tools; edits outside the folder still ask |

Whatever the level, commands that look destructive or reach outside the machine still ask (recursive delete, `sudo`/`runas`, `curl … \| sh`, shutdown/reboot, disk tools, registry writes, `git push/reset --hard/clean`, `npm publish`), and the always-blocked commands (`DENY_CMDS`) never run. The task log shows each action that was allowed automatically (`✅ Tự cho phép …`). The setting lives in `machine.json` (`agentAuto`), applies to workflow steps by their agent, can only be changed on this machine (not through remote access), and asks for confirmation when raised. Codex tasks do not ask at all (Codex's own sandbox decides), so this applies to Claude Code agents.
