# JT Dictate

Push-to-Talk Speech-to-Text for GNOME/Linux.

Click the panel icon or press a hotkey, speak, and your speech is transcribed offline using [faster-whisper](https://github.com/guillaumekln/faster-whisper). The result is copied to your clipboard.

## Features

- **Offline transcription** using faster-whisper (runs entirely on your machine)
- **GNOME Shell Extension** with panel icon (left-click to toggle, right-click for settings)
- **Recording Pill** — floating overlay widget with audio visualization during recording
- **3 animation styles**: Smooth (scale+slide), Bounce (spring physics), Minimal (in-place crossfade)
- **Processing visualization** — pill morphs to spinning circle, shows checkmark on completion
- **5 visualization types**: Bars, Waveform, Pulse, Circle, Equalizer (default: 15 bars)
- **15 built-in notification sounds** with per-sound volume control
- **Full customization** via GNOME Preferences panel (right-click → Settings → Alle Einstellungen)
- **Theme system** — 10 built-in presets (Standard, Neon, Minimal, Ocean, Sunset, Aurora, Cherry, Forest, Midnight, Rosé) + custom themes
- **Dark/Light mode** — follows GNOME system color scheme
- **Settings & theme export/import** as JSON
- **Optional GNOME notifications** (disabled by default)
- **Clipboard integration**: transcribed text is automatically copied
- **Multiple Whisper models**: tiny / base / small / medium
- **CLI control**: `--toggle`, `--start`, `--stop`, `--status` for hotkey integration
- **D-Bus service**: headless backend communicates with the extension via `de.jt.Dictate`

## Demo

Try the interactive browser simulation to preview all settings, animations and themes before installing:

**[Open Demo](https://lpritzkow21.github.io/jt-dictate/simulation.html)** *(or open `simulation.html` locally)*

- Left-click the mic icon to start/stop recording
- Right-click for the context menu
- Configure everything in Settings (Rechtsklick → Alle Einstellungen)
- Export your settings as JSON and import them after installation

## Requirements

- GNOME Shell 45+ (GNOME 45, 46, 47, 48, 49)
- Python 3.10+
- Wayland: `wl-clipboard` / X11: `xclip`

### Supported Distributions

| Distribution | Package Manager | Status |
|---|---|---|
| **Arch Linux** | pacman | Tested |
| **Fedora** | dnf | Untested |
| **Debian** | apt | Untested |
| **Ubuntu** | apt | Untested |
| **openSUSE** | zypper | Untested |

> **Note:** This extension has only been tested on Arch Linux so far. The install script supports Arch, Fedora, Debian, and Ubuntu-based systems, but there may be edge cases on untested distributions. If you run into issues, please open an issue.

## Installation

```bash
git clone https://github.com/lpritzkow21/jt-dictate.git
cd jt-dictate
./install.sh
```

The install script will:
1. Detect your distribution and package manager (pacman, dnf, apt, zypper)
2. Install system dependencies automatically
3. Create a Python virtual environment with all packages
4. Install the GNOME Shell Extension (including preferences panel)
5. Set up autostart and desktop entry

After installation:

```bash
# On Wayland: log out and back in for the extension to load
# On X11: Alt+F2 -> r -> Enter

# Start the backend
jt-dictate
```

### Manual Dependency Installation

If the install script doesn't work for your distro, install these manually:

**Arch:**
```bash
sudo pacman -S python python-pip python-gobject python-dbus libnotify portaudio wl-clipboard
```

**Fedora:**
```bash
sudo dnf install python3 python3-pip python3-gobject python3-dbus libnotify portaudio-devel wl-clipboard
```

**Debian / Ubuntu:**
```bash
sudo apt install python3 python3-pip python3-venv python3-gi python3-dbus libnotify-bin libportaudio2 portaudio19-dev wl-clipboard
```

Then run `./install.sh` again.

## Usage

### Panel Icon
- **Left-click**: Start/stop recording
- **Right-click**: Open settings menu

### Recording Pill
When recording starts, a floating pill overlay appears on screen with:
- Audio visualization (configurable type)
- Microphone icon (customizable)
- Configurable position, size, colors, and effects

### CLI
```bash
jt-dictate              # Start backend
jt-dictate --toggle     # Toggle recording (for hotkeys)
jt-dictate --start      # Start recording
jt-dictate --stop       # Stop recording
jt-dictate --status     # Show status
```

### Hotkey Setup

1. Open **Settings -> Keyboard -> Keyboard Shortcuts**
2. Scroll to **Custom Shortcuts** and click **+**
3. Set:
   - Name: `JT Dictate Toggle`
   - Command: `jt-dictate --toggle`
   - Shortcut: e.g. `Super+D`

## Customization

Open the preferences panel: **Right-click panel icon → Einstellungen → Alle Einstellungen...**

Or via terminal:
```bash
gnome-extensions prefs jt-dictate@jt.tools
```

### Appearance

| Option | Description |
|--------|-------------|
| **Pill width/height** | Size of the recording overlay (100-600 × 24-80 px) |
| **Border radius** | Corner rounding (0-40 px) |
| **Position** | Top/bottom, left/center/right |
| **Margin top** | Distance from screen edge (0-200 px) |
| **Margin horizontal** | Horizontal offset (0-200 px) |
| **Background color** | Pill background (with alpha) |
| **Border color** | Outline color (with alpha) |
| **Border width** | Outline thickness (0-5 px) |
| **Blur** | Backdrop blur intensity (0-40 px) |
| **Shadow intensity** | Drop shadow opacity (0-1) |
| **Recording color** | Icon color during recording |
| **Processing color** | Icon color during transcription |

### Visualization

| Option | Description |
|--------|-------------|
| **Type** | Bars, Waveform, Pulse, Circle, Equalizer |
| **Bar count** | Number of bars (3-20, for Bars/Equalizer) |
| **Gradient** | Color gradient left → right |
| **Color left/right** | Gradient start/end colors |

### Icon

| Option | Description |
|--------|-------------|
| **Icon** | Microphone, Record, Speaker, Music, Smiley, or custom |
| **Custom icon** | Load any SVG/PNG file |
| **Icon color** | Icon tint color |

### Themes

| Theme | Description |
|-------|-------------|
| **Default** | GNOME standard blue-to-red gradient |
| **Neon** | Bright green/pink on dark background |
| **Minimal** | Subtle white, no border/shadow |
| **Ocean** | Blue tones with cyan gradient |
| **Sunset** | Warm orange/yellow gradient |
| **System** | Follows GNOME dark/light mode |

### Export / Import

- **Settings export/import**: Save/load all settings as JSON
- **Theme export/import**: Share theme presets as JSON files

Custom themes are stored in `~/.config/jt-dictate/themes/`.

## Whisper Models

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| `tiny` | ~75 MB | Very fast | Good |
| `base` | ~150 MB | Fast | Very good |
| `small` | ~500 MB | Medium | Excellent |
| `medium` | ~1.5 GB | Slow | Outstanding |

The model is downloaded automatically on first use.

## Architecture

```
jt-dictate.py          # Headless Python backend (D-Bus service, audio, whisper)
extension/
  extension.js              # GNOME Shell Extension (panel icon, pill overlay, visualizations)
  prefs.js                  # Preferences panel (Adw/GTK4)
  metadata.json             # Extension metadata (uuid, version, shell-version)
  stylesheet.css            # Panel icon styles
install.sh                  # Installation script (multi-distro: pacman, dnf, apt, zypper)
requirements.txt            # Python dependencies
```

The backend runs as a headless GLib MainLoop process. The GNOME Shell Extension provides the UI and communicates with the backend over D-Bus. All D-Bus calls are fully async to prevent desktop freezes.

Settings are stored in `~/.config/jt-dictate/settings.json`.

## License

Copyright (c) JT Tools. MIT License.
