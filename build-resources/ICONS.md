# EditPro build icons

The packaging icons are generated from `icon.svg` and committed so
`electron-builder` can run without a local design toolchain.

| File | Platform | Notes |
|------|----------|-------|
| `icon.svg` | Source | Original EditPro mark. Edit this, then regenerate. |
| `icon.icns` | macOS | Multi-resolution ICNS (up to 1024px) |
| `icon.ico` | Windows | Multi-resolution ICO: 16, 24, 32, 48, 64, 128, 256 |
| `icon.png` | Master raster | 1024×1024 PNG |
| `icons/` | Linux | PNGs named `{size}x{size}.png` |

Linux sizes: 16, 24, 32, 48, 64, 96, 128, 256, 512, 1024.

Regenerate after changing the SVG:

```bash
npm run generate:icons
```

`package.json` points macOS at `build-resources/icon.icns`, Windows at
`build-resources/icon.ico`, and Linux at `build-resources/icons`.
