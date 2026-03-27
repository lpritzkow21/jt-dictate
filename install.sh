#!/bin/bash
#
# Janeway Dictate Installation Script für Arch-basierte Systeme
# Copyright (c) Janeway Technology
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
BIN_LINK="$HOME/.local/bin/janeway-dictate"
DESKTOP_FILE="$HOME/.config/autostart/janeway-dictate.desktop"
APP_DESKTOP="$HOME/.local/share/applications/janeway-dictate.desktop"
CONFIG_DIR="$HOME/.config/janeway-dictate"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/janeway-dictate@janeway.technology"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Janeway Dictate Installer für Arch-basierte Systeme    ║"
echo "║              Speech-to-Text für GNOME/Linux              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 gefunden"
        return 0
    else
        echo -e "${RED}✗${NC} $1 nicht gefunden"
        return 1
    fi
}

echo "1. Prüfe System-Abhängigkeiten..."
echo ""

MISSING_PKGS=()

# Prüfe Python
if ! check_command python3; then
    MISSING_PKGS+=("python")
fi

# Prüfe pip
if ! check_command pip; then
    MISSING_PKGS+=("python-pip")
fi

# Prüfe für Wayland
if [ -n "$WAYLAND_DISPLAY" ]; then
    echo -e "${YELLOW}ℹ${NC} Wayland erkannt"
    if ! check_command wl-copy; then
        MISSING_PKGS+=("wl-clipboard")
    fi
else
    echo -e "${YELLOW}ℹ${NC} X11 erkannt"
    if ! check_command xclip; then
        MISSING_PKGS+=("xclip")
    fi
fi

# GTK Abhängigkeiten
echo ""
echo "Prüfe GTK-Bibliotheken..."

SYSTEM_PKGS=(
    "python-gobject"
    "python-dbus"
    "libnotify"
    "portaudio"  # für sounddevice
)

for pkg in "${SYSTEM_PKGS[@]}"; do
    if ! pacman -Qi "$pkg" &> /dev/null; then
        MISSING_PKGS+=("$pkg")
    else
        echo -e "${GREEN}✓${NC} $pkg installiert"
    fi
done

# Fehlende Pakete installieren
if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}Folgende Pakete werden installiert:${NC}"
    printf '%s\n' "${MISSING_PKGS[@]}"
    echo ""
    read -p "Mit pacman installieren? [J/n] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Abgebrochen. Bitte installiere die Pakete manuell."
        exit 1
    fi
    sudo pacman -S --needed "${MISSING_PKGS[@]}"
fi

echo ""
echo "2. Erstelle Python Virtual Environment..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv --system-site-packages "$VENV_DIR"
    echo -e "${GREEN}✓${NC} venv erstellt: $VENV_DIR"
else
    echo -e "${YELLOW}ℹ${NC} venv existiert bereits"
fi

echo ""
echo "3. Installiere Python-Pakete..."

# Verwende explizit den venv-pip um PEP 668 Fehler zu vermeiden
"$VENV_DIR/bin/pip" install --upgrade pip wheel

# Installiere requirements
"$VENV_DIR/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"

echo -e "${GREEN}✓${NC} Python-Pakete installiert"

echo ""
echo "4. Erstelle ausführbare Scripts..."

# Haupt-Launcher
mkdir -p "$(dirname "$BIN_LINK")"
cat > "$BIN_LINK" << EOF
#!/bin/bash
source "$VENV_DIR/bin/activate"
python3 "$SCRIPT_DIR/janeway-dictate.py" "\$@"
EOF
chmod +x "$BIN_LINK"
echo -e "${GREEN}✓${NC} Launcher erstellt: $BIN_LINK"

echo ""
echo "5. Installiere GNOME Shell Extension..."

# Extension installieren
mkdir -p "$EXTENSION_DIR"
\cp "$SCRIPT_DIR/extension/metadata.json" "$EXTENSION_DIR/"
\cp "$SCRIPT_DIR/extension/extension.js" "$EXTENSION_DIR/"
\cp "$SCRIPT_DIR/extension/stylesheet.css" "$EXTENSION_DIR/"

echo -e "${GREEN}✓${NC} Extension installiert: $EXTENSION_DIR"

# Extension aktivieren
gnome-extensions enable janeway-dictate@janeway.technology 2>/dev/null || true
echo -e "${GREEN}✓${NC} Extension aktiviert"

echo ""
echo "6. Erstelle Desktop-Einträge..."

# Autostart für Backend
mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=Janeway Dictate Backend
Comment=Speech-to-Text Backend Service
Exec=$BIN_LINK
Icon=audio-input-microphone
Terminal=false
Categories=Utility;Audio;
X-GNOME-Autostart-enabled=true
StartupNotify=false
NoDisplay=true
EOF
echo -e "${GREEN}✓${NC} Autostart erstellt: $DESKTOP_FILE"

# Application Desktop Entry
mkdir -p "$(dirname "$APP_DESKTOP")"
cat > "$APP_DESKTOP" << EOF
[Desktop Entry]
Type=Application
Name=Janeway Dictate
Comment=Speech-to-Text für GNOME/Linux
Exec=$BIN_LINK
Icon=audio-input-microphone
Terminal=false
Categories=Utility;Audio;Accessibility;
Keywords=speech;voice;dictate;transcribe;stt;whisper;
EOF
echo -e "${GREEN}✓${NC} App-Eintrag erstellt: $APP_DESKTOP"

# Config-Verzeichnis erstellen
mkdir -p "$CONFIG_DIR"
echo -e "${GREEN}✓${NC} Config-Verzeichnis: $CONFIG_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                Installation abgeschlossen!               ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo -e "${CYAN}Nächste Schritte:${NC}"
echo ""
echo -e "  ${YELLOW}1. GNOME Shell neu laden:${NC}"
echo "     Wayland: Abmelden und wieder anmelden"
echo "     X11:     Alt+F2 → 'r' eingeben → Enter"
echo ""
echo -e "  ${YELLOW}2. Backend starten:${NC}"
echo "     ${GREEN}janeway-dictate${NC}"
echo "     (Startet automatisch beim nächsten Login)"
echo ""
echo -e "${CYAN}Steuerung:${NC}"
echo ""
echo "  - ${GREEN}Linksklick${NC} auf Icon: Aufnahme starten/stoppen"
echo "  - ${GREEN}Rechtsklick${NC} auf Icon: Menü mit Einstellungen"
echo ""
echo -e "${CYAN}Tastenkürzel einrichten (optional):${NC}"
echo ""
echo "  1. Öffne: Einstellungen → Tastatur → Tastaturkürzel"
echo "  2. Scrolle zu 'Eigene Tastaturkürzel' → '+'"
echo ""
echo "     Name:    Janeway Dictate Toggle"
echo "     Befehl:  ${GREEN}janeway-dictate --toggle${NC}"
echo "     Kürzel:  (z.B. Super+D)"
echo ""
echo -e "${CYAN}CLI-Befehle:${NC}"
echo ""
echo "  janeway-dictate           # Backend starten"
echo "  janeway-dictate --toggle  # Toggle Aufnahme"
echo "  janeway-dictate --start   # Aufnahme starten"
echo "  janeway-dictate --stop    # Aufnahme stoppen"
echo "  janeway-dictate --status  # Status anzeigen"
echo ""
echo -e "${YELLOW}Hinweis:${NC} Beim ersten Start wird das Whisper-Modell"
echo "heruntergeladen (~150MB für 'base'). Das dauert einmalig."
echo ""
