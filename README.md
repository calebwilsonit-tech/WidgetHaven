# Haven — desktop organizer widget

A glassy widget that lives on your Windows desktop and organizes your apps, games, files, folders and links.
Its accent colors (and light/dark mode) follow your wallpaper automatically.

## Install

Download **`Haven-Setup-<version>.exe`** from the
[latest release](https://github.com/calebwilsonit-tech/WidgetHaven/releases/latest) and run it. It installs per-user (no admin needed), adds Desktop
and Start-menu shortcuts, and starts Haven when it's done. Prefer not to install? Use
**`Haven-Portable-<version>.exe`** instead.

> The installer isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC" —
> click **More info → Run anyway**.

Uninstall from **Settings → Apps → Installed apps → Haven**. Your favorites, groups and layouts are kept in
`%APPDATA%\Haven` so a reinstall or update picks up right where you left off.

## Develop

```
npm install
npm start
```

> npm 11 blocks install scripts, so if `npm start` says "Electron failed to install correctly",
> run `npm install-scripts approve electron` and `npm install` again.

## Build the installer

```
npm run dist          # dist/Haven-Setup-<version>.exe + dist/Haven-Portable-<version>.exe
npm run icon          # regenerate build/icon.png if the logo changes
```

## Releasing a new version

1. Note the changes under a new heading in `CHANGELOG.md`.
2. `npm run release:patch` (fixes) or `npm run release:minor` (new features) — bumps the version in
   `package.json`, commits, tags it (e.g. `v1.0.1`) and builds the installers.
3. `git push --follow-tags`, then attach the files from `dist/` to the GitHub release for that tag.

## Highlights

- **Desktop widget mode** (default): sits behind your windows, survives Win+D, no taskbar button. Lock its position from Settings or the tray icon.
- **Split widgets**: tray icon → *Split into widgets* (or the layers button / right-click any sidebar tab → *Pop out*) puts each tab or group on the desktop as its own widget. Each widget's `⋯` menu has *Transparency & size* (opacity 0–100%, blur on/off, tile size), and the `⇅` button changes what it shows. *Merge widgets back* restores the single window.
- **Customize** (`⋯` → *Customize look*): preset looks (Glass, Frosted, Clear, Outline, Bold, Tinted, Midnight) or save your own; Scale, Opacity and Tile size sliders; text backing Off/Subtle/Solid; apply to one widget or all.
- **Layouts** (`⋯` → *Layouts*): Grid, Side column, Bottom dock, Gamer, Focus, Corner — or save your current arrangement.
- **Snapping** (Settings → Widgets → Snapping): widgets snap to screen edges/center and to each other's edges, centers and an even gap, with PowerPoint-style smart guides. Hold **Shift** while dragging to drop into a zone (Quarters, Three columns, Halves, Right stack, Focus center, Six grid); hold **Alt** to place freely. Every part can be switched off.
- **Readable anywhere**: when see-through, each widget reads the wallpaper patch behind it and picks outlined light/dark text plus label backing, even over mixed bright/dark images.
- **Wallpaper theming**: accent + glow colors are pulled from your wallpaper and update when it changes.
- **Auto-discovery**: Start menu apps, Steam (with cover art), Epic, Microsoft Store/Xbox, desktop items, Windows recent files.
- **Search everything** (`Ctrl+Alt+Space` from anywhere): fuzzy + initials matching, `=12*8` calculator, `g`/`yt`/`w`/`r`/`gh` web search.
- **Favorites & groups** with drag-and-drop ordering, drop files from Explorer to add, rename, hide, run as admin, launch arguments.
- Notes scratchpad, backup/restore, start with Windows, keyboard shortcuts (see Settings → Shortcuts).

Data lives in `%APPDATA%\Haven`.
