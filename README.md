# Google Flow MCP

Clean MCP server for **Google Flow** (`labs.google/fx/tools/flow`) — a thin browser bridge that lets AI agents (Codex, Claude Code, Antigravity) control Google Flow directly using your Google Pro account.

No API. No third-party services. Just your browser, your account, your credits.

---

## What It Can Do

| Tool | What it does |
|---|---|
| `flow_open` | Navigate to Flow, or a specific project |
| `flow_snapshot` | See all UI elements and generated media on screen, including empty `contenteditable` editors |
| `flow_click` | Click any button, menu item, or card |
| `flow_type` | Type a prompt into any input field |
| `flow_upload` | Upload and associate an image, audio, video or other platform-supported material |
| `flow_download` | Save a generated image or video to disk |
| `flow_wait` | Wait for generation to finish |
| `flow_confirm_paid_generation` | Single-use authorization for a requested generation; optional user credit cap |

`flow_upload` accepts `filePath` and optional explicit file-input `ref`/`selector`.
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

```bash
npm run dev        # Run without building (tsx)
npm run build      # Compile to dist/
npm run typecheck  # Type check only
npm run login      # One-time Chrome Google login
```

---

## License

MIT
