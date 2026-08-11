# Google Flow MCP

Clean MCP server for **Google Flow** (`labs.google/fx/tools/flow`) — a thin browser bridge that lets AI agents (Codex, Claude Code, Antigravity) control Google Flow directly using your Google Pro account.

No API. No third-party services. Just your browser, your account, your credits.

---

## What It Can Do

| Tool | What it does |
|---|---|
| `flow_open` | Navigate to Flow, or a specific project |
| `flow_snapshot` | See all UI elements and generated media on screen |
| `flow_click` | Click any button, menu item, or card |
| `flow_type` | Type a prompt into any input field |
| `flow_upload` | Upload a local file (reference image, etc.) |
| `flow_download` | Save a generated image or video to disk |
| `flow_wait` | Wait for generation to finish |
| `flow_confirm_paid_generation` | Authorize a paid Veo/Omni generation (safety guard) |

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

For **paid Veo video generation**, the agent will call `flow_confirm_paid_generation` first and ask your approval.

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
