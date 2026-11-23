# Changelog

All notable changes to Haven. Versions follow [Semantic Versioning](https://semver.org):
**major** = breaking changes, **minor** = new features, **patch** = fixes.

## [1.3.19] — 2026-11-23

### Added
- **Background apps** on the Haven Bar: a button that opens a panel listing apps running in the background, like the hidden icons on the taskbar (Discord, Steam, VPNs and so on). Click one to bring it up, or hover and press ✕ to quit it (with *Force quit* if it won't close). Links open Windows' own hidden icons and Task Manager. It's in the default layout, and you can add it in Studio → Bar.

## [1.3.18] — 2026-11-23

### Added
- **Resize tiled windows:** drag the edge between two windows and the layout keeps that size, with the neighbors making room. **Ctrl+Alt+=** grows the active window, **Ctrl+Alt+−** shrinks it, and **Ctrl+Alt+0** evens everything out.
- **Bring back moved windows** (bar right-click menu, tray, Studio → Windows): returns windows Haven moved to their own desktop and removes those desktops.

### Fixed
- Resizing a window could push another one out of the layout or onto another desktop. A resize now stops before the other windows get smaller than their minimum, and windows already on screen are never moved away. Only a window that just opened can go to its own desktop.
- The tiler could keep re-laying out windows several times a second (reacting to unrelated Windows events), wasting CPU and skipping the check that makes room for apps with a minimum size.
- A window still catching up to its new size could be mistaken for one that can't shrink.

## [1.3.17] — 2026-11-23

### Added
- **App window corners** (Studio → Windows): make every app window (Opera, Steam, Explorer…) square, slightly rounded or rounded, with tiling on or off. New windows get it as they open. *Match bar* picks the shape closest to your Haven Bar. Windows go back to normal when it's set to Default or Haven quits. Windows 11 allows these shapes only, not exact sizes.

## [1.3.16] — 2026-11-22

### Added
- **Widget corners** slider (Settings → Appearance): set how round Haven's windows and widgets are, from square (0) to very round (28px). With *Match looks* set to *Follow the bar*, it follows the bar's roundness until you pick a value yourself.

### Fixed
- Square widgets still had rounded edges and outlines, because a hidden 10px rounded mask clipped every Haven window. The mask now follows the corner setting.

## [1.3.15] — 2026-11-22

### Changed
- Widget outlines react to the mouse: they stay quiet at rest and light up in your accent color while you hover a widget.

## [1.3.14] — 2026-11-22

### Added
- **Match looks** (Studio → Bar): your desktop widgets can follow the bar (see-through amount, frosted glass, outline, corner roundness and font), or the bar can follow the widgets. Colors always match through your theme.
- Square bars now make everything square: widget tiles, cards, buttons and window corners, plus the bar's panels and the app launcher.
- README rewritten, with screenshots of the bar looks, hub, Studio, themes, tiling and launcher.

### Fixed
- A widget's outline and its background didn't line up at the corners.

## [1.3.13] — 2026-11-22

### Added
- **When there's no room** option in Studio → Windows: *Float it* (centered) or *Own desktop*. With *Own desktop*, a window that can't shrink enough to fit is moved to a new virtual desktop of its own, and that desktop is removed again when the window closes (unless you've put other windows on it).
  - It's always the newest window that can't shrink that moves, never the windows that were already tiled.
  - This uses Windows 11's internal desktop interface (24H2 and later). If that isn't available, Haven floats the window instead.

## [1.3.12] — 2026-11-22

### Changed
- Tiling no longer pops windows out when they don't fit their tile. A window that can't shrink is moved back to the first, roomiest tile, sized for it, every time (after a swap or a new window too). It only floats when there truly isn't room for it at all, and it rejoins the layout as soon as space frees up.

## [1.3.11] — 2026-11-22

### Fixed
- Apps with a minimum window size, like Steam, now tile properly instead of hanging off the screen or floating. They move to the first tile, which widens to their minimum size, and the other windows share the rest of the space. An app only floats (centered and fully on screen) if even that can't hold it.

## [1.3.10] — 2026-11-22

### Fixed
- The maximize button now toggles focus mode: press it again and the window goes back into the tiling layout (before, it stayed full-size).
- Opening a new window or switching to another tiled window now ends focus mode, so new windows no longer land on top of a full-size one.
- Steam is tiled like any other app again (it was on the *Always float* list by default). It's still floated automatically if it can't shrink to fit its tile.

## [1.3.9] — 2026-11-22

### Fixed
- Apps that resize themselves after being tiled (Opera, for one, goes back to a size it remembers) are now put back in their tile. If an app keeps fighting, it's floated instead of looping. Only the apps that own tiled windows are watched, so this costs nothing elsewhere.

## [1.3.8] — 2026-11-22

### Changed
- Smoother tiling animations: each window gets its new size once, then glides into place with a softer ease at a high frame rate, instead of being resized every frame. New windows slide up into their spot.
- Focus follows mouse is now instant: no wait, checked as soon as the pointer moves (and no work at all while it's still).
- The active-window border fades in faster.

## [1.3.7] — 2026-11-22

### Changed
- The tiling active-window border now fades in on the window you switch to, and fades back down on the one you left (instant when tiling animations are off).

## [1.3.6] — 2026-11-22

### Added
- **Focus follows mouse** for tiling (on by default, switch in Studio → Windows): rest the pointer on a tiled window and it becomes the active one, like Hyprland. It never takes focus away from menus, dialogs or Haven's pop-ups, waits while a mouse button is held, and keeps floating windows on top.

### Changed
- Switching windows from the bar or with tiling keys no longer taps Alt behind the scenes, which could open the menu bar in some apps.

## [1.3.5] — 2026-11-22

### Added
- **Focus mode** for tiling (Ctrl+Alt+Z, or the bar or tray menu): the active window animates to fill the tiled area, like Hyprland's fake fullscreen. Press it again to put the layout back.
- **Always float** list in Studio → Windows (starts with Steam). These apps open centered on top, and the rest tile around them.

### Changed
- Maximized windows now join the tiling layout. Maximizing a window while tiling is on puts it in focus mode instead.
- Windows that refuse to shrink to their tile (apps with a minimum size, like Steam) are floated in the center automatically, and everything else re-tiles around them so nothing overlaps.

## [1.3.4] — 2026-11-22

### Fixed
- The bar could end up 50px down, drawn over the top of your windows, because Windows moved it into the strip it had just reserved. The bar now stays on the screen edge, and it only makes room for the real Windows taskbar on that edge.
- A reserved strip left behind after Haven was force-closed is now cleared the next time Haven starts.

## [1.3.4] — 2026-11-22

### Fixed
- The bar could end up 50px down, drawn over the top of your windows, because Windows moved it into the strip it had just reserved. The bar now stays on the screen edge, and it only makes room for the real Windows taskbar on that edge.
- A reserved strip left behind after Haven was force-closed is now cleared the next time Haven starts.

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
