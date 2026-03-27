# Janeway Dictate

Push-to-Talk Speech-to-Text for GNOME/Linux.

Click the panel icon or press a hotkey, speak, and your speech is transcribed offline using [faster-whisper](https://github.com/guillaumekln/faster-whisper). The result is copied to your clipboard.

## Features

- **Offline transcription** using faster-whisper (runs entirely on your machine)
- **GNOME Shell Extension** with panel icon (left-click to toggle, right-click for settings)
- **3-state feedback**: idle (microphone) -> recording (red) -> processing (orange)
- **Clipboard integration**: transcribed text is automatically copied
- **Multiple Whisper models**: tiny / base / small / medium
- **CLI control**: `--toggle`, `--start`, `--stop`, `--status` for hotkey integration
- **D-Bus service**: headless backend communicates with the extension via `de.janeway.Dictate`

## Requirements

- Arch Linux / Manjaro (install script uses `pacman`)
- GNOME Shell 45-49
- Python 3.10+
- Wayland: `wl-clipboard` / X11: `xclip`

## Installation

```bash
git clone https://github.com/janeway-technology/janeway-dictate.git
cd janeway-dictate
./install.sh
```

The install script will:
1. Install system dependencies via `pacman`
2. Create a Python virtual environment with all packages
3. Install the GNOME Shell Extension
4. Set up autostart and desktop entry

After installation:

```bash
# Enable the extension
gnome-extensions enable janeway-dictate@janeway.technology

# On Wayland: log out and back in for the extension to load
# On X11: Alt+F2 -> r -> Enter

# Start the backend
janeway-dictate
```

## Usage

### Panel Icon
- **Left-click**: Start/stop recording
- **Right-click**: Open settings menu

### CLI
```bash
janeway-dictate              # Start backend
janeway-dictate --toggle     # Toggle recording (for hotkeys)
janeway-dictate --start      # Start recording
janeway-dictate --stop       # Stop recording
janeway-dictate --status     # Show status
```

### Hotkey Setup

1. Open **Settings -> Keyboard -> Keyboard Shortcuts**
2. Scroll to **Custom Shortcuts** and click **+**
3. Set:
   - Name: `Janeway Dictate Toggle`
   - Command: `janeway-dictate --toggle`
   - Shortcut: e.g. `Super+D`

## Settings

Right-click the panel icon -> Settings:

| Option | Description |
|--------|-------------|
| **Auto clipboard** | Copy transcribed text to clipboard after recording |
| **Whisper model** | tiny / base / small / medium |

Settings are stored in `~/.config/janeway-dictate/settings.json`.

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
janeway-dictate.py        # Headless Python backend (D-Bus service, audio, whisper)
extension/
  extension.js            # GNOME Shell Extension (panel icon, menu, D-Bus client)
  metadata.json
  stylesheet.css
install.sh                # Installation script (Arch-based systems)
start.sh                  # Quick-start helper
```

The backend runs as a headless GLib MainLoop process. The GNOME Shell Extension provides the UI and communicates with the backend over D-Bus. All D-Bus calls are fully async to prevent desktop freezes.

## License

Copyright (c) Janeway Technology. MIT License.
