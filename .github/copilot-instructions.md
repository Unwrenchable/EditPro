# EditPro — GitHub Copilot Instructions

EditPro is a cross-platform desktop image and video editor built with **Electron 41**, **React 19**, **TypeScript 5.9** (strict mode), and **Vite 8**. Tests run with **Vitest 4** and **@testing-library/react 16**.

## Project layout

| Path | Purpose |
|------|---------|
| `src/` | React renderer — all UI and business logic |
| `src/components/photo/` | Photo editor components |
| `src/components/video/` | Video editor components |
| `src/components/layout/` | App shell, TopBar |
| `src/hooks/` | `usePhotoEditor`, `useVideoEditor`, `useNativeFiles` |
| `src/utils/imageFilters.ts` | Pure photo-filter math (`buildCSSFilter`) |
| `src/utils/videoUtils.ts` | Pure video-filter math (`buildLumetriFilter`, `clamp`, `formatTime`) |
| `src/types/index.ts` | All shared TypeScript types |
| `src/test/` | Vitest unit + component tests |
| `electron/main.ts` | Electron main process, IPC handlers, app menu |
| `electron/preload.ts` | `contextBridge` IPC bridge (`window.editpro`) |

## TypeScript conventions

- **Strict mode** is on — `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- Use `import type { … }` for every type-only import (`verbatimModuleSyntax` is enabled).
- No `any` — use proper types or `unknown` with a type guard.
- ESM only (`"type": "module"`) — use `import`/`export`, never `require()`.

## React conventions

- Functional components only; no class components.
- Wrap every event-handler prop in `useCallback` so refs stay stable across re-renders.
- Never create an `HTMLVideoElement` ref inside a hook — the component creates the ref and passes it in (see `useVideoEditor`).
- Add **ARIA labels** (`aria-label`, `role`, `title`) to every interactive element.

## CSS / styling

- Dark theme only. CSS custom properties are defined in `src/index.css`.
- Follow existing class names in `src/App.css` — do not add inline styles for layout or color that could be expressed as a CSS class.

## Photo editing

- All filter math lives in `src/utils/imageFilters.ts` (`buildCSSFilter`).
- Photo state shape: `PhotoEditorState` → `src/types/index.ts`.
- Adjustment values range −100 to 100 (or 0–100 for non-negative controls like `sharpness`, `grain`).

## Video editing

- Color grading state is `LumetriColor` (basic tone + 12-point curves + 3 color wheels) — never flat `brightness`/`contrast`/`saturation` fields at the top level of `VideoEditorState`.
- CSS filter is built by `buildLumetriFilter(lut: LumetriColor)` in `videoUtils.ts` — this is the single source of truth.
- `buildVideoFilter(b, c, s)` is a legacy helper kept only for backward-compatible tests; do not use it for new features.
- `VideoEditorState` fields: `file`, `videoUrl`, `duration`, `currentTime`, `isPlaying`, `trimStart`, `trimEnd`, `playbackRate`, `volume`, `isMuted`, `lumetri`, `audio`, `markers`, `autoReframe`, `timelineZoom`.
- Keyboard shortcuts live in `VideoEditor.tsx` (`useEffect`): `Space`/`K`/`L`/`J`, `←`/`→`, `I`/`O`, `M`.

## Electron / IPC

- Security model: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — **never change these**.
- Expose only safe, typed methods via `contextBridge` in `electron/preload.ts`.
- IPC channel naming convention: `dialog:*`, `fs:*`, `app:*`, `shell:*`, `menu:*`.
- Only `https://` URLs are allowed through `shell:openExternal`.
- Never accept arbitrary file paths from the renderer without validation in the main process.

## Testing

- Tests live in `src/test/` following the `describe / it / expect` pattern.
- Run with `npm test` (Vitest, jsdom environment).
- Component tests use `@testing-library/react`; mock DOM APIs that are unavailable in jsdom.
- Every new public utility function or meaningful code path should have a unit test.

## Build & lint commands

```bash
npm test          # Vitest unit + component tests
npm run build     # TypeScript check + Vite build
npm run lint      # ESLint (typescript-eslint + react-hooks)
npm run dev       # Vite dev server → http://localhost:5173
npm run dev:electron  # Full Electron app (requires a display)
```
