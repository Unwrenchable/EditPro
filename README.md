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
npm run build:web        # Browser bundle (WebCodecs, ffmpeg.wasm, transformers.js)
npm run build:mobile     # Web bundle copied into the Android and iOS projects
npm run fetch:ffmpeg     # Optional: download ffmpeg.wasm core into public/ffmpeg
```

### Browser, phone, and desktop

The React UI talks to a platform bridge (`src/platform`). In Electron that bridge is the existing preload IPC. In a browser tab and in the Capacitor shell it is an in-process implementation. On Android and iOS the system file picker and share sheet replace the browser input.

| Need | Desktop | Browser |
|------|---------|---------|
| Export | Bundled ffmpeg | ffmpeg.wasm when `/ffmpeg` or jsDelivr can load the core, then WebCodecs, then MediaRecorder. The dialog says which engine ran. |
| Proxies and GPU decode | Desktop ffmpeg | The original file plays. The playback bar says proxies are a desktop feature. |
| Speech transcription | No Whisper binary in this build | transformers.js (Whisper-tiny) on the device, after the weights download once. Audio is not uploaded. |
| Updates | electron-updater on signed installs | Refresh the page, or download a desktop installer. |

`npm run dev` is the browser session. `npm run dev:electron` is the desktop app. `npm run build` stays the desktop renderer (wasm engines are stubbed so the packaged app does not carry them). `npm run build:web` is the static bundle those engines are allowed to load in.

That web bundle is an installable PWA. `public/manifest.webmanifest`, `public/sw.js`, and `public/icons/` are the install metadata and offline shell. The service worker registers only in a production web or Capacitor build, so the desktop app keeps `worker-src 'none'`. Phones, tablets, and windows narrower than 800px get a stacked layout and a simplified timeline (scrub, pinch zoom, trim, split, delete). A mouse or trackpad keeps the multitrack timeline. `vercel.json` builds with `npm run build:web` and publishes `dist` as a static site.

### Android and iOS

`android/` and `ios/` are Capacitor 8 projects around the web build. `npm run build:mobile` runs `build:web` and `cap sync`. Open them with `npm run cap:android` (Android Studio) or `npm run cap:ios` (Xcode, macOS). Export, proxies, and transcription behave like the browser: native ffmpeg and Whisper are desktop features, and the UI says so.

GitHub Actions workflow `Mobile` builds an unsigned debug APK on Ubuntu and an unsigned iOS Simulator app on macOS. Neither artifact is a store build.

#### Play Store

1. Create the app in Play Console with package name `com.editpro.app`.
2. Create an upload key and keep the keystore out of git:

   ```bash
   keytool -genkeypair -v -keystore editpro-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```

3. Create `android/keystore.properties` (gitignored; do not commit the `.jks` either). Paths are relative to the `android/` directory:

   ```
   storeFile=../editpro-upload.jks
   storePassword=***
   keyAlias=upload
   keyPassword=***
   ```

   `android/app/build.gradle` reads that file when it exists and signs `bundleRelease`. Without it, `assembleDebug` stays unsigned.
4. `cd android && ./gradlew bundleRelease` produces `android/app/build/outputs/bundle/release/app-release.aab`.
5. Enroll in Play App Signing, upload the AAB to an internal testing track, then promote to production. Play re-signs the download with the app signing key.

#### App Store and TestFlight

1. Enroll in the Apple Developer Program and register the App ID `com.editpro.app`.
2. Create an Apple Distribution certificate and an App Store provisioning profile for that App ID.
3. In Xcode, open `ios/App/App.xcodeproj`, set the team under Signing & Capabilities, and leave the bundle id as `com.editpro.app`.
4. Product → Archive. In the Organizer, Distribute App → App Store Connect → Upload. The same archive is the TestFlight build.
5. In App Store Connect, wait for processing, add the build to TestFlight, then submit the version for review when the store listing is ready.

A command-line upload uses an archive with signing enabled (the CI job turns signing off):

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/EditPro.xcarchive archive
xcodebuild -exportArchive -archivePath build/EditPro.xcarchive \
  -exportPath build/export -exportOptionsPlist ios/ExportOptions.plist
```

`ios/ExportOptions.plist` in this repo uses `method` `app-store-connect` and `signingStyle` `automatic`. Fill in your team id before exporting. TestFlight receives the uploaded IPA; internal testers can install after processing, and external testers need a short Beta App Review.

### Project structure

```
EditPro/
├── android/               Capacitor Android project
├── ios/                   Capacitor iOS project
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
│   │   └── useNativeFiles.ts   Platform file open/save
│   ├── platform/               Desktop IPC and browser/mobile host
│   ├── pwa/                    Install metadata, service worker, touch layout
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

EditPro uses the [agent-tools](https://github.com/Unwrenchable/agent-tools) governance framework. That repo is a Python 3.11+ package; the `agentx` command is the console script declared in its `pyproject.toml`.

From this repository root:

```bash
pip install git+https://github.com/Unwrenchable/agent-tools.git
python -m pip install requests                     # imported at CLI startup; not declared in the package
agentx list                                        # package agents plus this repo's .agentx/agents.json
agentx find photo                                  # find photo-related agents
agentx check editpro-electron-engineer --profile power
agentx recommend editpro-photo-engine
```

`agentx` starts at the current directory and walks up to the git root, then merges [`.agentx/agents.json`](.agentx/agents.json) over the package registry (same `id` replaces the package entry). Run it here so the `editpro-*` agents show up. If the install put `agentx` in a user scripts directory that is not on `PATH`, the same commands work as `python -m agent_tools.cli`. The `requests` install is required with the current git package: importing `agentx` loads a provider module that imports `requests`, and `pyproject.toml` does not list it.

| Agent | Responsibility |
|-------|---------------|
| `editpro-orchestrator` | Routes work across the specialist agents and tracks releases |
| `editpro-photo-engine` | Photo adjustments, CSS filter pipeline, canvas export |
| `editpro-video-engine` | Playback, timeline and keyframes, audio, titles, transitions, color, export presets |
| `editpro-electron-engineer` | Main process, IPC, `app://` / `media://`, file grants, dialogs, updater |
| `editpro-ui-engineer` | React components, dark theme, accessibility |
| `editpro-test-engineer` | Vitest + Testing Library unit and component tests |
| `editpro-browser-test-engineer` | Electron and Playwright checks of the running UI |
| `editpro-release-engineer` | electron-builder packaging, GitHub Releases, portable builds |
| `editpro-security-engineer` | Read-only IPC, CSP, protocol, and grant audit |
| `editpro-cybersecurity-expert` | Finds, reports, and patches Electron security gaps |

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
