# ✦ EditPro

**Professional photo and video editing — one app, every platform.**

EditPro is an open-source, cross-platform desktop editor built with Electron + React + TypeScript. It runs natively on **macOS**, **Windows**, and **Linux**, ships as a portable executable (USB/download-ready, no installation required), and packs the features you'd expect from industry-standard tools like Adobe Lightroom, Photoshop, Premiere Pro, and DaVinci Resolve — in a single, free, plug-and-play package.

---

## ✨ Features

### 📷 Photo Editing

| Panel | Controls |
|-------|----------|
| **Presets** | 9 built-in filters: Original, B&W, Sepia, Vivid, Cool, Warm, Fade, Dramatic, Matte |
| **Light** | Exposure, Brightness, Contrast, Highlights, Shadows, Whites, Blacks |
| **Color** | Saturation, Vibrance, Temperature, Tint, Hue |
| **Detail** | Sharpness, Noise Reduction, Clarity, Texture, Dehaze |
| **Effects** | Vignette, Grain, Fade |
| **Transform** | Rotate 90°/−90°, Flip Horizontal/Vertical |
| **Export** | PNG (lossless), JPEG, WebP with quality control |

### 🎬 Video Editing

| Panel | Controls |
|-------|----------|
| **Color Grading** | Brightness, Contrast, Saturation, Highlights, Shadows, Temperature |
| **Timeline** | Seek bar, trim In/Out points, clip duration readout |
| **Playback** | Play/Pause, time display, playback speed (0.25× – 2×), volume, mute |
| **Effects** | Transitions: Cut, Fade, Dissolve, Wipe, Slide, Zoom |
| **Audio** | Track inspector, audio controls |
| **Formats** | MP4, WebM, MOV, AVI, MKV, M4V, FLV, WMV |

### 🖥 Cross-Platform Desktop

- **macOS** — Native `.dmg` installer, Apple Silicon (arm64) + Intel (x64), macOS app menu, `Cmd+O`/`Cmd+E` shortcuts
- **Windows** — NSIS installer (with Start Menu + Desktop shortcuts) and **portable `.exe`** (runs from USB, no install needed)
- **Linux** — `.AppImage` (universal, no install) and `.deb` (Debian/Ubuntu)
- **Native file dialogs** — uses OS-native open/save pickers on all platforms
- **Dark theme** — consistent professional dark UI across all OSes
- **Updates** — checks GitHub Releases on launch and every four hours. Signed macOS and Windows installs can download and restart from the prompt. Unsigned, portable, and Linux builds open the release page instead.

---

## 🚀 Quick Start

### Run from source

```bash
git clone https://github.com/Unwrenchable/EditPro.git
cd EditPro
npm install
npm run dev                 # browser mode (Vite dev server)
npm run dev:electron        # Electron desktop app (hot-reload)
```

### Download a release (plug-and-play)

Go to [Releases](https://github.com/Unwrenchable/EditPro/releases) and grab the file for your OS:

| OS | File | Notes |
|----|------|-------|
| macOS (Apple Silicon) | `EditPro-x.x.x-arm64.dmg` | Mount and drag to Applications |
| macOS (Intel) | `EditPro-x.x.x-x64.dmg` | Mount and drag to Applications |
| Windows — Installer | `EditPro-Setup-x.x.x.exe` | Standard installer with Start Menu shortcut |
| Windows — Portable | `EditPro-Portable-x.x.x.exe` | **No install needed** — run directly from USB drive |
| Linux — Universal | `EditPro-x.x.x-x86_64.AppImage` | `chmod +x` then run directly |
| Linux — Debian/Ubuntu | `editpro_x.x.x_amd64.deb` | `sudo dpkg -i editpro_*.deb` |

### USB / Portable mode (Windows)

1. Copy `EditPro-Portable-x.x.x.exe` to your USB drive
2. Double-click to run — no installation, no admin rights required
3. All settings stored locally alongside the exe

---

## 🛠 Development

### Requirements

- Node.js ≥ 18
- npm ≥ 9

### Scripts

```bash
npm run dev              # Vite dev server (browser)
npm run dev:electron     # Electron + Vite hot-reload desktop mode
npm run build            # Production Vite build (renderer only)
npm run build:electron   # Full build (renderer + Electron main process)
npm run dist             # Package for current platform
npm run dist:mac         # Package for macOS (.dmg + .zip)
npm run dist:win         # Package for Windows (.exe installer + portable)
npm run dist:linux       # Package for Linux (.AppImage + .deb)
npm run generate:icons   # Rebuild app icons from build-resources/icon.svg
npm test                 # Run Vitest test suite
npm run lint             # ESLint
```

### Project structure

```
EditPro/
├── electron/              Electron main process + preload
│   ├── main.ts            BrowserWindow, IPC handlers, app menu
│   ├── preload.ts         Secure contextBridge IPC bridge
│   └── tsconfig.json      TypeScript config for Electron
├── src/
│   ├── components/
│   │   ├── layout/        TopBar
│   │   ├── photo/         PhotoDropZone, PhotoAdjustmentPanel, PhotoEditor
│   │   └── video/         VideoDropZone, VideoTimeline, VideoControls,
│   │                      VideoAdjustmentPanel, VideoEditor
│   ├── hooks/
│   │   ├── usePhotoEditor.ts
│   │   ├── useVideoEditor.ts
│   │   └── useNativeFiles.ts   Electron/browser file I/O bridge
│   ├── types/
│   │   ├── index.ts            PhotoAdjustments, VideoEditorState, etc.
│   │   └── electron.d.ts       window.editpro IPC bridge types
│   ├── utils/
│   │   ├── imageFilters.ts     CSS filter pipeline, export
│   │   └── videoUtils.ts       formatTime, buildVideoFilter, clamp
│   └── test/                   Vitest + Testing Library tests
├── build-resources/       App icon source and generated icons (see ICONS.md)
├── LICENSE                MIT license
├── .agentx/               Agent-tools registry (multi-agent governance)
│   ├── agents.json        8 specialist agent definitions
│   ├── access_profiles.json
│   └── README.md
├── dist/                  Vite renderer build output (gitignored)
├── dist-electron/         Electron main-process build (gitignored)
├── release/               electron-builder packages (gitignored)
├── package.json
└── vite.config.ts
```

### App icons

Packaging icons are already in [`build-resources/`](build-resources/ICONS.md). The source artwork is `build-resources/icon.svg`. After editing it, run `npm run generate:icons` and commit the generated `.ico`, `.icns`, and `icons/` files.

### Code signing

Release builds in [`.github/workflows/release.yml`](.github/workflows/release.yml) sign only when GitHub Actions secrets are present. With none of them set, the workflow still publishes unsigned artifacts.

| Secret | When it is used |
|--------|-----------------|
| `CSC_LINK` | Base64-encoded `.p12` / `.pfx`, or an `https://` URL to the certificate. Signs macOS and Windows. |
| `CSC_KEY_PASSWORD` | Password for `CSC_LINK`. |
| `WIN_CSC_LINK` | Optional Windows certificate when it differs from `CSC_LINK`. |
| `WIN_CSC_KEY_PASSWORD` | Password for `WIN_CSC_LINK`. |
| `APPLE_ID` | Apple ID email. Notarization, together with the two secrets below. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID. |
| `APPLE_TEAM_ID` | 10-character Apple Team ID. |
| `APPLE_API_KEY` | Alternative notarization: contents of the App Store Connect `.p8` key (raw PEM or base64). |
| `APPLE_API_KEY_ID` | Key ID for `APPLE_API_KEY`. |
| `APPLE_API_ISSUER` | Issuer UUID for `APPLE_API_KEY`. |

Use either the Apple ID trio or the API-key trio. Linux packages are not signed by these secrets.

### Updates

Packaged builds include an update check:

- **Help → Check for Updates…** looks immediately.
- Automatic checks run on launch and every four hours. Turn them off in **Settings** (macOS app menu, or Help → Settings on Windows and Linux).
- A signed macOS app or signed Windows installer can **Download & install**, show download progress, then **Restart to update**. electron-updater uses the GitHub Releases feed (`latest-mac.yml`, `latest.yml`).
- Unsigned builds, the Windows portable exe, and Linux AppImage or deb packages offer **Download from the website**, which opens the GitHub release. **Remind me later** and **Skip this version** are always available.
- The release workflow publishes the installers together with `latest*.yml` and blockmap files.

The first launch shows a short welcome. **Help → Open Log File** opens a crash log after you opt in (welcome screen or Settings). Logs stay on the computer. **About EditPro** shows the running version.

---

## 🤖 Agent-Tools Integration

EditPro uses the [agent-tools](https://github.com/Unwrenchable/agent-tools) governance framework for multi-agent development.

```bash
pip install -e path/to/agent-tools
agentx list                                        # see all EditPro agents
agentx find photo                                  # find photo-related agents
agentx check editpro-electron-engineer --profile power
agentx recommend editpro-photo-engine
```

Eight specialist agents are defined in [`.agentx/agents.json`](.agentx/agents.json):

| Agent | Responsibility |
|-------|---------------|
| `editpro-orchestrator` | Coordinates all agents, routes tasks, tracks releases |
| `editpro-photo-engine` | Photo adjustments, filter pipeline, canvas export |
| `editpro-video-engine` | Video playback, timeline, trim, color grading |
| `editpro-electron-engineer` | Electron main process, IPC, native dialogs, menus |
| `editpro-ui-engineer` | React components, CSS, dark theme, accessibility |
| `editpro-test-engineer` | Vitest + Testing Library unit/integration/component tests |
| `editpro-release-engineer` | electron-builder packaging, GitHub Releases, portable builds |
| `editpro-security-engineer` | IPC audit, CSP, contextIsolation, dependency scanning |

---

## 🔒 Security

- `nodeIntegration: false` in all BrowserWindows
- `contextIsolation: true` — renderer cannot access Node.js APIs directly
- `sandbox: true` — renderer process runs in OS sandbox
- All IPC handlers in `electron/main.ts` validate input before use
- Only `https://` URLs are passed to `shell.openExternal`
- Run `npm audit` at any time to check for dependency vulnerabilities

---

## 🗺 Roadmap

- [ ] Histogram display (live RGB waveform)
- [ ] Layers panel (compositing)
- [ ] RAW file decoding (libraw/dcraw via native module)
- [ ] Batch photo export
- [ ] Multi-track video timeline (A/V separation)
- [x] Auto-updater (electron-updater, with a GitHub Releases fallback)
- [ ] GPU-accelerated processing (WebGL filters)
- [ ] Plugin system

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and distribute. Copyright © 2026 Jax Harlan.
