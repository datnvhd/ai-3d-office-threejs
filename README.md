# My Office 3D — Three.js prototype

Interactive isometric AI office with clickable agents, task assignment form, simulated progress, camera orbit and zoom.

## Run

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

`scripts/build-linux.js` copies the sources into a `node:22-bookworm` container and installs the dependencies there, so the native modules (node-pty, esbuild, rollup) are the Linux ones; it works from Windows too. On the Ubuntu machine:

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

A `.dmg` can only be built on macOS, and `npm ci` installs the native modules (node-pty, esbuild, rollup) of the Mac's own chip, so each chip is built on its own machine. `.github/workflows/build-mac.yml` does that on `macos-15` (arm64) and `macos-15-intel` (x64), then starts the packaged app with `AI_OFFICE_SELFTEST=1` (serves the page and the machine API, prints them, quits) before keeping the dmg as the run's artifact (`gh run download --name ai-3d-office-macos-arm64`). It also runs on tags `v*`.

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

## Remote access (another computer opens this office)

For a team that keeps one machine running the agents (for example a Mac mini that builds and tests iOS apps), **TRUY CẬP TỪ XA** in the **Máy cá nhân** window lets other computers on the LAN or a VPN (e.g. Tailscale) open the same office in a browser. Off by default.

- `server/remote-access.js` listens on `0.0.0.0:47821` (next free port if taken) and forwards to the local server; the agents, files and accounts stay on this machine. The window lists one link per network address: `http://<ip>:47821/?key=<access key>`.
- The 128-bit key is checked once in the link and then kept in an HttpOnly, SameSite=Strict cookie; 20 wrong keys from one address in 10 minutes are refused. **Đổi mã** makes old links and cookies stop working; turning it off closes the port.
- Forwarded requests carry a per-process secret header (`isRemoteReq()`), so the bridges know them from this machine's own window. A remote viewer can give and follow tasks, answer, review diffs and change the working folder or permission mode, but cannot sign in to Claude/Codex, add or change saved web passwords, fill a task's login form, or change remote access itself (blocked both in the forwarder and in the bridges); the access key is never sent to it.
- It is plain HTTP: use it inside the office network or a VPN, not on the open internet. macOS may ask once to allow incoming connections.

## Installers from GitHub Actions

Three workflows build the installers on GitHub's own machines, start the packaged app with `AI_OFFICE_SELFTEST=1` (serves the page and the machine API, prints them, quits) and keep the files as the run's **Artifacts** (Summary page of the run, at the bottom; signed-in users of the repo can download them for 90 days):

| Workflow | Runner | File | Check |
|---|---|---|---|
| Windows installer (.exe) | windows-latest | `AI-3D-Office-<version>-windows-x64-setup.exe` | unpacked app self-test (waits for the app only, not daemons such as adb) |
| Ubuntu installer (.deb) | ubuntu-22.04 | `ai-3d-office_<version>_ubuntu_amd64.deb` | installed with apt on a clean Ubuntu 24.04 runner, then self-test under Xvfb |
| macOS installer (.dmg) | macos-15, macos-15-intel | `AI-3D-Office-<version>-macos-arm64.dmg`, `…-macos-x64.dmg` | codesign verify + self-test |

All three run on a pushed tag `v*` (e.g. `git tag v1.0.1 && git push origin v1.0.1`), and from the Actions tab (**Run workflow**) once the files are on the default branch.
