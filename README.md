# Google Flow MCP

Clean MCP server for **Google Flow** (`labs.google/fx/tools/flow`) — a thin browser bridge that lets AI agents (Codex, Claude Code, Antigravity) control Google Flow directly using your Google Pro account.

No API. No third-party services. Just your browser, your account, your credits.

---

## What It Can Do

| Tool | What it does |
|---|---|
| `flow_open` | Navigate to Flow, or a specific project |
| `flow_snapshot` | See all UI elements and generated media on screen, including empty `contenteditable` editors |
| `flow_video_editor` | Open/inspect an existing video editor and its timeline capabilities |
| `flow_video_edit` | Prepare or submit a conversational edit in the original video asset stack |
| `flow_click` | Click any button, menu item, or card |
| `flow_type` | Type a prompt into any input field |
| `flow_upload` | Upload and associate an image, audio, video or other platform-supported material |
| `flow_download` | Save a generated image or video to disk |
| `flow_wait` | Wait for generation to finish |
| `flow_generation_status` | Actively inspect the original video submission, returning provider operation state and new-result evidence; unsupported or unbound states remain unknown |
| `flow_confirm_paid_generation` | Single-use authorization for a requested generation; optional user credit cap |

Video status distinguishes `not_started` (no submission in this MCP session),
`queued`, `running`, `succeeded`, `failed`, and `unknown`. Session-local
`not_started` does not assert that an older provider task never started.
Native Flow `scheduled`/`pending` records return `queued` plus `providerState`;
the native interface does not distinguish running from queued or expose progress.
Queries actively repeat only the observed read-only status RPC (allowlisted
`jwpduf`, `Zzl0ze`, `as29s`), never a generation POST. A failed live query returns
`unknown` with the last known nonterminal state. After restart, supply the original
`generationId`, provider `jobId` and `projectUrl` to query the named task. Recovery
does not use historical players as completion evidence.
Completed tasks support native canvas previews and both proxy thumbnail formats.
Media is bound to the original provider ID/URI; signed URLs are decoded from JSON
before use. Downloaded HTML or other unrecognized bytes are rejected instead of
being written as an MP4.

`flow_upload` accepts `filePath` and optional explicit file-input `ref`/`selector`.
Without an explicit file-input target, it also reuses verified materials by file
SHA-256 within the current Flow project and Chrome profile. A local rename or MCP
restart does not require another upload. The registry is saved in
`CHROME_USER_DATA_DIR/flow-materials.json` (the default authenticated profile is
used when unset); `FLOW_ASSET_CACHE_PATH` can override it. New uploads receive a
content-bound filename. Reuse selects the existing library card and verifies its
native media identity in the prompt's ingredient bar. A library thumbnail alone
is not attachment evidence. Receipts include `reused`, `uploadedNow`, `projectId`
and `assetName`; `uploaded: true` retains the existing “uploaded material is
available” contract and does not mean a fresh upload. Explicit `ref`/`selector`
still means an actual upload. A cached asset that is unavailable or ambiguous is
reported rather than silently creating another copy. Legacy uploads require a
verified historical upload receipt before importing their hash/name mapping;
unregistered older library items are not assumed to match local bytes by name alone.
Without an explicit target it supports both existing file inputs and the current
Add-material → Upload-media → native file chooser flow. It waits for upload
completion, selects the exact filename (including cards without extensions),
and clicks Add-to-prompt when needed. A selected file or an uploading placeholder
alone is not success. Explicit stale targets and platform rejection stop before
generation. Use `confirmUploadRights: true` only for authorized source material
when Flow presents its upload notice; the persistent do-not-show choice is untouched.

Real UI validation on 2026-10-11 verified image and MP4 association. A WAV selected
in the ordinary video material picker was not accepted as an associated asset;
the bridge failed explicitly rather than reporting success or generating.
Google documents raw audio input separately under Flow Music's Add → Audio entry
([official help](https://support.google.com/flow/answer/17084348?co=GENIE.Platform%3DDesktop&hl=en)).
That separate audio entry has not been verified by this bridge. Platform-supported
materials depend on the current workspace; a common upload API does not imply
every file type is supported in every composer.

Generation requests use `flow_confirm_paid_generation({confirm:true})`; there is
no default credit ceiling. Pass `maxBudgetCredits` only for an explicit user cap.
Give a brief pricing notice when useful and continue the authorized production.

---

## Setup

### 1. Install & Build

```bash
cd "/Volumes/Xstorage/MCP - Googel Flow 2"
npm install
npm run build
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` — set `LOCAL_STORAGE_ROOT` to wherever you want images saved.

### 3. One-Time Google Login

```bash
npm run login
```

Chrome opens. Sign into your Google account and navigate to `labs.google/fx/tools/flow`.
Close the script with Ctrl+C when done. Your session persists forever (or until Google forces re-auth).

---

## Platform Integration

### Antigravity IDE

Add to `~/.gemini/antigravity-ide/mcp_config.json`:

```json
{
  "mcpServers": {
    "google-flow": {
      "command": "node",
      "args": ["/Volumes/Xstorage/MCP - Googel Flow 2/dist/index.js"],
      "env": {
        "LOCAL_STORAGE_ROOT": "/Volumes/Xstorage/Media",
        "HEADLESS": "false"
      }
    }
  }
}
```

### Codex (ChatGPT Desktop)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.google-flow]
command = "node"
args = ["/Volumes/Xstorage/MCP - Googel Flow 2/dist/index.js"]
startup_timeout_sec = 30

[mcp_servers.google-flow.env]
LOCAL_STORAGE_ROOT = "/Volumes/Xstorage/Media"
HEADLESS = "false"
```

Restart Codex to pick up.

### Claude Code (Desktop App)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-flow": {
      "command": "node",
      "args": ["/Volumes/Xstorage/MCP - Googel Flow 2/dist/index.js"],
      "env": {
        "LOCAL_STORAGE_ROOT": "/Volumes/Xstorage/Media",
        "HEADLESS": "false"
      }
    }
  }
}
```

Restart Claude to pick up.

---

## Example Agent Workflow

Tell the agent (Codex, Claude, Antigravity):

> "Open Google Flow, type this prompt into the image composer: 'cinematic wide shot of ancient Greece at sunset, photorealistic', generate the image, wait for it to finish, and download it to /Volumes/Xstorage/Media"

The agent will chain:
```
flow_open → flow_snapshot → flow_type → flow_click → flow_wait → flow_download
```

Generation prompts are typed without keyboard submission. The agent snapshots the page again, selects the visible enabled Generate control, and uses one trusted `flow_click`; paid video clicks require `flow_confirm_paid_generation` and either a successful recognized Flow generation POST or the same submit control changing from enabled to disabled before `flow_wait` may begin. A missing acknowledgement fails quickly instead of entering the long media wait.

---

## Development

### Edit an existing video

`flow_video_editor` opens/inspects the original asset editor using `projectId`
and the `assetId` observed in its `/project/<id>/edit/<assetId>` URL. This is
the editor/asset stack ID, not necessarily the generation job ID. Continue
the existing conversation with `flow_video_edit`:

```json
{"projectId":"<project UUID>","assetId":"<editor asset UUID>","instruction":"把画面中的黑色衣服变成白色"}
```

The default prepares a draft and reports its readback. It preserves a different
unsent draft, keeps the selected model and history, and uploads no references.
With `submit:true` and a caller-persisted `generationId`, it makes one submission
through the existing paid confirmation/acknowledgement path. Reconcile an
unknown attempt rather than repeating it. Submission and model output on this
new edit route have not yet been validated with a paid generation.

Optional `scope:{"startSeconds":2,"endSeconds":4}` requests a time interval in
the prompt; omitting `endSeconds` requests the frame at that time. The receipt
explicitly reports `temporalScopeMode:"prompt_request_only"`. This is **not**
an enforced edit mask. Native scene trim handles do not establish that edits
outside the interval remain unchanged. Single-frame-only edits and exact range
editing are unverified; do not describe this prompt option as precise editing.
The live warehouse editor currently shows zero-duration playback even though
its clip thumbnails and edit composer load, so timeline/frame positioning was
not verified. Google documents segment selection for video editing and saving
paused frames separately: [Flow editing help](https://support.google.com/flow/answer/16935718?hl=en).

```bash
npm run dev        # Run without building (tsx)
npm run build      # Compile to dist/
npm run typecheck  # Type check only
npm run login      # One-time Chrome Google login
```

---

## License

MIT
