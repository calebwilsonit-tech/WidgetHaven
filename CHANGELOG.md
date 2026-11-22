# Changelog

All notable changes to Haven. Versions follow [Semantic Versioning](https://semver.org):
**major** = breaking changes, **minor** = new features, **patch** = fixes.

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
