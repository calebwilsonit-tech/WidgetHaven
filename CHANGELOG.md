# Changelog

All notable changes to Haven. Versions follow [Semantic Versioning](https://semver.org):
**major** = breaking changes, **minor** = new features, **patch** = fixes.

## [1.3.3] — 2026-11-22

### Added
- **Tiling presets** in Studio → Windows: Hyprland default, Tight, Airy, Focus, Wide master, Calm, Seamless and No animation. Each sets the layout, gaps, main width, animation and active border in one click.
- More ways to turn tiling on: a **Tile windows (beta)** switch in the bar's right-click menu, and a *Tiling windows (beta)* row in Settings → Widgets (alongside the tray checkbox and the switch in Studio).

## [1.3.2] — 2026-11-22

### Added
- Notifications slide away one after another when you dismiss them or press **Clear all**, and the bell rings in when the list is empty.

### Changed
- Even spacing for desktop widgets: the gap to the screen edges (and to the bar) now matches the gap between widgets, using your *Gap between widgets* setting. It stays even when the bar or taskbar changes the usable area.

### Fixed
- Widget tiles could still overlap after the bar reserved its strip, because Windows moved them again after Haven had refit them. Haven now refits once the reservation settles, and places windows where Windows really has them.
- The bar re-reserved its strip whenever it was notified of its own change, causing needless repeated work.

## [1.3.1] — 2026-11-22

### Added
- **Flat Blocks**, a new bar look: a flat dark strip with square blocks, monospace text and small accent highlights.

### Changed
- The bar looks now cover a real spread of shapes: 9 square or nearly square, 6 slightly rounded and 6 round. Square looks also get square desktop buttons and app highlights.
- Bar islands have more room around their icons. Single-icon buttons (Wi-Fi, notifications, power…) are now wider rounded rectangles instead of tight circles.

### Fixed
- **Clear all** in the notifications panel now really clears them, and the list stays empty when you reopen it.
- With exactly one notification, the notifications panel showed nothing.

## [1.3.0] — 2026-11-22

### Added
- **Haven panels for the bar.** Bar buttons now open Haven's own themed panels instead of the Windows ones:
  - **Clock:** a calendar.
  - **Bell:** your real Windows notifications. Dismiss one or clear all; the bell shows how many are waiting.
  - **Network:** your Wi-Fi networks, with connect and disconnect.
  - **Volume:** a volume slider with what's playing.
  - **Battery:** battery details and screen brightness.
  - **CPU & memory:** system use and the apps using the most memory.
  - **Power:** a confirm-twice power menu.
  - **Theme:** a theme picker.
  - **Quick settings:** brightness, volume, live wallpaper, taskbar, bar position, screenshot and more.
- **20 bar looks** in Studio → Bar, each with a live preview. They include Mocha Islands, Rainbow Pills, Tokyo Neon, Barely There, Gruvbox Retro, Nord Frost, Outrun, Brutalist, Paper, Terminal, Glass Menubar, Bottom Dock, Arcade and more. They can switch to a matching theme too.
- **New bar styles:** colorful, outline, underline, minimal, neon, soft chips, brutalist, gradient and monochrome, plus capitals and module separators.
- **Windows taskbar control** at the top of the Bar tab: **Show**, **Auto-hide** or **Hidden** (completely gone). The taskbar always comes back when the bar is turned off or Haven quits.
- **Tiling windows (beta)** in Studio → Windows. Off by default.
  - Hyprland-style automatic tiling with dwindle and master layouts, adjustable gaps, animated movement, and your theme's accent on the active window's border.
  - Drag one window onto another to swap them.
  - Keys: Ctrl+Alt+arrows to focus, with Shift to swap, Ctrl+Alt+F to float, Ctrl+Alt+P to pause.
  - It only runs when windows open, close or move, so it costs nothing when idle.
- **App launcher:** **Win+S** (replacing Windows search; can be switched off) or **Alt+Space** opens an animated search for your apps, games and files.

### Changed
- The bar's buttons have more breathing room around their hover highlight.
- The main Haven window is now solid even when your desktop widgets are see-through (Settings → Appearance → *Solid Haven window*).

### Fixed
- Desktop widget tiles overlapped after the bar took its strip of the screen. Widgets now remember where they sit as a share of the screen and refit cleanly whenever the usable area changes.

## [1.2.0] — 2026-11-22

### Added
- **Haven Bar** (tray → *Haven Bar*, or **Ctrl+Alt+B**): a status bar in the style of Linux setups like Hyprland.
  - Your virtual desktops as buttons: click to jump, scroll to flip through them, + to add one, and right-click to close one. Desktops with open windows look brighter.
  - Open apps on the current desktop: click to switch to an app or minimize it, middle-click to close it.
  - Clock and date, now playing (with play/pause and skip), CPU and memory, volume (scroll to change, click to mute), network, battery, notifications, quick settings, hidden tray icons and a power menu.
  - Optional modules: active window title, your Haven favorites, and a theme switcher.
  - Styles: Islands, Pills, Floating or Edge to edge, at the top or bottom. Height, gaps, roundness, opacity, frosted glass (a blur of your wallpaper), outline, shadow, glow and font are all adjustable.
  - Drag modules between the left, middle and right in Studio → *Bar*, with a live preview.
  - Reserves its own strip of the screen so maximized windows stop under it, and hides for fullscreen games and videos.
  - Can auto-hide the Windows taskbar while it's on, and restores the taskbar when you turn the bar off.
  - Shortcuts: Ctrl+Alt+1…9 jumps to a desktop and Ctrl+Alt+T switches theme.
- **Themes** (Studio → *Themes*, the tray, or the bar's right-click menu): one click recolors the bar, Haven, your Studio widgets and the live wallpaper.
  - **Auto** follows your wallpaper, as Haven always has.
  - Built in: Mocha, Tokyo Night, Rosé, Gruvbox, Nord, Dracula, Everforest, Synthwave, Mono, Latte and Paper, each with a matching live wallpaper scene.
  - Save your current look as a theme, optionally with your wallpaper picture, live wallpaper and bar layout.
  - Give each virtual desktop its own theme, which switches as you move between desktops.
  - Optionally switch Windows apps between light and dark mode to match.

### Changed
- The live wallpaper no longer restarts when the bar or the taskbar changes the usable screen area.

## [1.1.1] — 2026-11-22

### Fixed
- Studio's layer option was easy to mistake for a screen position ("Floating"), which kept a widget above every app. It now reads **Desktop only** / **Above all apps**, with a clearer explanation.

## [1.1.0] — 2026-11-22

### Added
- **Haven Studio** (tray → *Haven Studio…*, or a widget's `⋯` menu): design your own desktop widgets.
  - Clocks: digital, analog, flip-clock and word clock, plus date, custom text and countdowns. Stack as many as you like in one widget.
  - Any installed font, 12 bundled fonts, or your own .ttf/.otf files. Size, weight, spacing, italic and caps.
  - Solid, gradient or wallpaper-matched colors, with glow, shadow, outline, card or frosted backgrounds.
  - 12 starting looks: Minimal, Neon, Wallpaper match, Retro flip, Elegant, Big bold, Word clock, Analog, Terminal, Pixel, Handwritten and Countdown.
  - Save your own designs, and export or import `.havenwidget` files to share them.
  - Snaps like the other widgets. Anchor spots (center, top middle, corners…) keep a widget in place as its text changes width or your resolution changes.
  - Each widget can sit on the desktop or float above windows, with optional click-through.
  - Ctrl + scroll on a widget resizes it, and Ctrl+Z undoes edits in the editor.
- **Live wallpaper** (Studio → *Live wallpaper*): animated wallpaper behind your desktop icons.
  - Scenes: Aurora, Liquid, Synthwave, Night sky and Bokeh.
  - Effects over your own wallpaper: Rain, Snow, Fireflies and Breathe.
  - Or a looping video, an image or an animated GIF.
  - Colors follow your wallpaper. Speed, amount and frame rate are adjustable, and it works on all screens or just the main one.
  - Pauses automatically for fullscreen games and apps, on battery and when locked. Turning it off brings your normal wallpaper straight back.

## [1.0.1] — 2026-11-22

### Fixed
- Right-click menus in widgets are now real Windows menus, so they're no longer cut off at the widget's edges.
- Settings, Customize, Layouts, Rename, Launch options, Add link and group editing open from a widget in their
  own full-size panel window instead of being squeezed inside the widget. Sliders still preview live on the widget.

## [1.0.0] — 2026-11-22

First release.

### Library
- Finds Start-menu apps, Steam games (with cover art), Epic games, Microsoft Store / Xbox apps, desktop items and Windows' recent files.
- Sharp 256px icons, fuzzy search with initials matching, `=` calculator and `g` / `yt` / `w` / `r` / `gh` web search.
- Favorites, groups, links, notes, hide / rename / run as admin / launch options, backup and restore.

### Desktop widgets
- Lives on the desktop behind your windows, survives Win+D, starts with Windows, summon with Ctrl+Alt+Space.
- Split any tab or group into its own widget; layouts (Grid, Side column, Bottom dock, Gamer, Focus, Corner) and edge layouts that keep the center of the wallpaper clear (Frame the center, Right edge, Left edge, Split edges, Four corners); save your own.
- Snapping with smart guides (edges, centers, even gaps), Shift for snap zones, Alt to place freely — all switchable.

### Look
- Accent colors follow the wallpaper; light/dark follows wallpaper brightness.
- Customize per widget or all: preset looks, scale, opacity, tile size, blur, text backing, accent / button / tint colors, border.
- Text and icons stay readable on any wallpaper (adaptive ink, outline, backing plates).

### Options
- "Show recently used" toggle for Jump back in / Continue playing.
