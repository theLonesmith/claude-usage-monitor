# Icons

This folder needs two icon files before you build the distributable .exe:

## Required files

| File        | Size         | Used for                        |
|-------------|-------------|----------------------------------|
| `icon.ico`  | 256×256 min | Windows installer, taskbar, dock |
| `tray.png`  | 32×32        | System tray icon                 |

## How to create them (free)

1. Design your icon at https://www.canva.com or https://www.figma.com
   - Use the Claude copper color `#c97248` on a dark background
   - A diamond ◆ or "C" lettermark works well

2. Export as PNG (512×512 recommended)

3. Convert to .ico at https://convertio.co/png-ico/
   - Include sizes: 16, 32, 48, 64, 128, 256

4. Save as `assets/icon.ico` and `assets/tray.png`

## Testing without icons

The app runs fine without icon files — the tray will show a blank icon
and the installer will use a default icon. Add proper icons before sharing.
