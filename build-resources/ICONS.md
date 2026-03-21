# EditPro Build Icons

Place your app icons here before packaging:

| File | Platform | Size |
|------|----------|------|
| `icon.icns` | macOS | 512x512 (multi-resolution) |
| `icon.ico` | Windows | 256x256 (multi-resolution) |
| `icon.png` | Linux (primary) | 512x512 PNG |
| `icons/` | Linux (directory) | 16, 32, 48, 64, 128, 256, 512 px PNGs named `{size}x{size}.png` |

Generate from a 1024x1024 PNG source using:
```bash
# macOS .icns
sips -z 512 512 icon-source.png --out icon.png
iconutil -c icns icon.iconset  # requires macOS

# Windows .ico (using ImageMagick)
convert icon-source.png -resize 256x256 icon.ico

# Linux directory
mkdir icons
for size in 16 32 48 64 128 256 512; do
  convert icon-source.png -resize ${size}x${size} icons/${size}x${size}.png
done
```
