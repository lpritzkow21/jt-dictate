#!/bin/bash
#
# JT Dictate Installation Script
# Unterstützt: Arch, Fedora, Debian/Ubuntu und andere GNOME-Distributionen
# Copyright (c) JT Tools
#
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
BIN_LINK="$HOME/.local/bin/jt-dictate"
DESKTOP_FILE="$HOME/.config/autostart/jt-dictate.desktop"
APP_DESKTOP="$HOME/.local/share/applications/jt-dictate.desktop"
CONFIG_DIR="$HOME/.config/jt-dictate"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/jt-dictate@jt.tools"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Distro-Erkennung ───

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO_ID="$ID"
        DISTRO_ID_LIKE="$ID_LIKE"
        DISTRO_NAME="$PRETTY_NAME"
    elif [ -f /etc/arch-release ]; then
        DISTRO_ID="arch"
        DISTRO_NAME="Arch Linux"
    else
        DISTRO_ID="unknown"
        DISTRO_NAME="Unknown"
    fi

    # Bestimme Paketmanager-Familie
    if command -v pacman &> /dev/null; then
        PKG_MANAGER="pacman"
    elif command -v dnf &> /dev/null; then
        PKG_MANAGER="dnf"
    elif command -v apt &> /dev/null; then
        PKG_MANAGER="apt"
    elif command -v zypper &> /dev/null; then
        PKG_MANAGER="zypper"
    else
        PKG_MANAGER="unknown"
    fi
}

# ─── Paket-Namen pro Distro ───

get_package_names() {
    case "$PKG_MANAGER" in
        pacman)
            PKG_PYTHON="python"
            PKG_PIP="python-pip"
            PKG_GOBJECT="python-gobject"
            PKG_DBUS="python-dbus"
            PKG_NOTIFY="libnotify"
            PKG_PORTAUDIO="portaudio"
            PKG_VENV=""  # in python enthalten
            PKG_WL_CLIPBOARD="wl-clipboard"
            PKG_XCLIP="xclip"
            ;;
        dnf)
            PKG_PYTHON="python3"
            PKG_PIP="python3-pip"
            PKG_GOBJECT="python3-gobject"
            PKG_DBUS="python3-dbus"
            PKG_NOTIFY="libnotify"
            PKG_PORTAUDIO="portaudio"
            PKG_VENV=""  # in python3 enthalten
            PKG_WL_CLIPBOARD="wl-clipboard"
            PKG_XCLIP="xclip"
            ;;
        apt)
            PKG_PYTHON="python3"
            PKG_PIP="python3-pip"
            PKG_GOBJECT="python3-gi"
            PKG_DBUS="python3-dbus"
            PKG_NOTIFY="libnotify-bin gir1.2-notify-0.7"
            PKG_PORTAUDIO="libportaudio2 portaudio19-dev"
            PKG_VENV="python3-venv"
            PKG_WL_CLIPBOARD="wl-clipboard"
            PKG_XCLIP="xclip"
            ;;
        zypper)
            PKG_PYTHON="python3"
            PKG_PIP="python3-pip"
            PKG_GOBJECT="python3-gobject"
            PKG_DBUS="python3-dbus-python"
            PKG_NOTIFY="libnotify-tools"
            PKG_PORTAUDIO="portaudio"
            PKG_VENV=""
            PKG_WL_CLIPBOARD="wl-clipboard"
            PKG_XCLIP="xclip"
            ;;
        *)
            PKG_PYTHON=""
            ;;
    esac
}

# ─── Paket installiert? (distro-unabhängig über Kommandos/Dateien) ───

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 gefunden"
        return 0
    else
        echo -e "${RED}✗${NC} $1 nicht gefunden"
        return 1
    fi
}

check_python_module() {
    if python3 -c "import $1" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Python-Modul '$1' verfügbar"
        return 0
    else
        echo -e "${RED}✗${NC} Python-Modul '$1' nicht gefunden"
        return 1
    fi
}

check_library() {
    # Prüft ob eine shared library existiert
    if ldconfig -p 2>/dev/null | grep -q "$1"; then
        echo -e "${GREEN}✓${NC} Bibliothek '$1' gefunden"
        return 0
    else
        echo -e "${RED}✗${NC} Bibliothek '$1' nicht gefunden"
        return 1
    fi
}

install_packages() {
    local pkgs=("$@")
    if [ ${#pkgs[@]} -eq 0 ]; then
        return 0
    fi

    echo ""
    echo -e "${YELLOW}Folgende Pakete werden installiert:${NC}"
    printf '  %s\n' "${pkgs[@]}"
    echo ""

    local mgr_name=""
    case "$PKG_MANAGER" in
        pacman) mgr_name="pacman" ;;
        dnf)    mgr_name="dnf" ;;
        apt)    mgr_name="apt" ;;
        zypper) mgr_name="zypper" ;;
    esac

    read -p "Mit $mgr_name installieren? [J/n] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo ""
        echo -e "${YELLOW}Bitte installiere die Pakete manuell:${NC}"
        case "$PKG_MANAGER" in
            pacman) echo "  sudo pacman -S ${pkgs[*]}" ;;
            dnf)    echo "  sudo dnf install ${pkgs[*]}" ;;
            apt)    echo "  sudo apt install ${pkgs[*]}" ;;
            zypper) echo "  sudo zypper install ${pkgs[*]}" ;;
        esac
        echo ""
        exit 1
    fi

    case "$PKG_MANAGER" in
        pacman) sudo pacman -S --needed "${pkgs[@]}" ;;
        dnf)    sudo dnf install -y "${pkgs[@]}" ;;
        apt)    sudo apt update && sudo apt install -y "${pkgs[@]}" ;;
        zypper) sudo zypper install -y "${pkgs[@]}" ;;
    esac
}

# ─── GNOME Shell Version prüfen ───

check_gnome_version() {
    local gnome_version
    gnome_version=$(gnome-shell --version 2>/dev/null | grep -oP '\d+' | head -1)

    if [ -z "$gnome_version" ]; then
        echo -e "${YELLOW}⚠${NC}  GNOME Shell nicht gefunden — Extension benötigt GNOME 45+"
        return 1
    fi

    if [ "$gnome_version" -lt 45 ]; then
        echo -e "${RED}✗${NC} GNOME Shell $gnome_version erkannt — mindestens Version 45 benötigt"
        return 1
    fi

    echo -e "${GREEN}✓${NC} GNOME Shell $gnome_version erkannt"
    return 0
}

# ─── Hauptprogramm ───

detect_distro
get_package_names

echo "╔══════════════════════════════════════════════════════════╗"
echo "║          JT Dictate Installer                       ║"
echo "║          Speech-to-Text für GNOME/Linux                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo -e "System: ${CYAN}${DISTRO_NAME}${NC} (Paketmanager: ${CYAN}${PKG_MANAGER}${NC})"
echo ""

# Prüfe ob Distro unterstützt wird
if [ "$PKG_MANAGER" = "unknown" ]; then
    echo -e "${RED}Kein unterstützter Paketmanager gefunden.${NC}"
    echo ""
    echo "Unterstützt: pacman (Arch), dnf (Fedora), apt (Debian/Ubuntu), zypper (openSUSE)"
    echo ""
    echo "Du kannst die Abhängigkeiten manuell installieren:"
    echo "  - Python 3.10+ mit venv und pip"
    echo "  - python-gobject / python-dbus / libnotify / portaudio"
    echo "  - wl-clipboard (Wayland) oder xclip (X11)"
    echo ""
    echo "Danach erneut ./install.sh ausführen."
    exit 1
fi

echo "1. Prüfe System-Abhängigkeiten..."
echo ""

MISSING_PKGS=()

# GNOME Shell Version
check_gnome_version || true

echo ""

# Python
if ! check_command python3; then
    MISSING_PKGS+=($PKG_PYTHON)
fi

# pip
if ! check_command pip3 && ! check_command pip; then
    MISSING_PKGS+=($PKG_PIP)
fi

# venv (Debian/Ubuntu braucht separates Paket)
if [ -n "$PKG_VENV" ]; then
    if ! python3 -m venv --help &>/dev/null; then
        echo -e "${RED}✗${NC} python3-venv nicht verfügbar"
        MISSING_PKGS+=($PKG_VENV)
    else
        echo -e "${GREEN}✓${NC} python3 venv verfügbar"
    fi
fi

# Clipboard
if [ -n "$WAYLAND_DISPLAY" ]; then
    echo -e "${YELLOW}ℹ${NC}  Wayland erkannt"
    if ! check_command wl-copy; then
        MISSING_PKGS+=($PKG_WL_CLIPBOARD)
    fi
else
    echo -e "${YELLOW}ℹ${NC}  X11 erkannt"
    if ! check_command xclip; then
        MISSING_PKGS+=($PKG_XCLIP)
    fi
fi

echo ""
echo "Prüfe System-Bibliotheken..."

# GObject Introspection / PyGObject
if ! check_python_module gi; then
    MISSING_PKGS+=($PKG_GOBJECT)
fi

# D-Bus Python bindings
if ! check_python_module dbus; then
    MISSING_PKGS+=($PKG_DBUS)
fi

# libnotify (braucht sowohl notify-send als auch GI-Bindings)
if ! check_command notify-send; then
    MISSING_PKGS+=($PKG_NOTIFY)
elif ! python3 -c "import gi; gi.require_version('Notify', '0.7'); from gi.repository import Notify" 2>/dev/null; then
    echo -e "${RED}✗${NC} Notify GI-Bindings nicht gefunden"
    MISSING_PKGS+=($PKG_NOTIFY)
fi

# PortAudio
if ! check_library libportaudio; then
    # Mehrere Pakete möglich (apt braucht dev + lib)
    for pkg in $PKG_PORTAUDIO; do
        MISSING_PKGS+=("$pkg")
    done
fi

# Fehlende Pakete installieren
if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    install_packages "${MISSING_PKGS[@]}"
fi

echo ""
echo "2. Erstelle Python Virtual Environment..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv --system-site-packages "$VENV_DIR"
    echo -e "${GREEN}✓${NC} venv erstellt: $VENV_DIR"
else
    echo -e "${YELLOW}ℹ${NC}  venv existiert bereits"
fi

echo ""
echo "3. Installiere Python-Pakete..."

# Verwende explizit den venv-pip um PEP 668 Fehler zu vermeiden
"$VENV_DIR/bin/pip" install --upgrade pip wheel --quiet

# Installiere requirements
"$VENV_DIR/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" --quiet

echo -e "${GREEN}✓${NC} Python-Pakete installiert"

echo ""
echo "4. Erstelle ausführbare Scripts..."

# Haupt-Launcher
mkdir -p "$(dirname "$BIN_LINK")"
cat > "$BIN_LINK" << EOF
#!/bin/bash
source "$VENV_DIR/bin/activate"
python3 "$SCRIPT_DIR/jt-dictate.py" "\$@"
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
\cp "$SCRIPT_DIR/extension/prefs.js" "$EXTENSION_DIR/"

echo -e "${GREEN}✓${NC} Extension installiert: $EXTENSION_DIR"

# Extension aktivieren
if gnome-extensions enable jt-dictate@jt.tools 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Extension aktiviert"
else
    echo -e "${YELLOW}ℹ${NC}  Extension wird nach GNOME Shell Neustart aktiviert"
fi

echo ""
echo "6. Erstelle Desktop-Einträge..."

# Autostart für Backend
mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=JT Dictate Backend
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
Name=JT Dictate
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
echo "║               Installation abgeschlossen!                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo -e "${CYAN}Nächste Schritte:${NC}"
echo ""
echo -e "  ${YELLOW}1. GNOME Shell neu laden:${NC}"
echo "     Wayland: Abmelden und wieder anmelden"
echo "     X11:     Alt+F2 → 'r' eingeben → Enter"
echo ""
echo -e "  ${YELLOW}2. Backend starten:${NC}"
echo "     ${GREEN}jt-dictate${NC}"
echo "     (Startet automatisch beim nächsten Login)"
echo ""
echo -e "${CYAN}Steuerung:${NC}"
echo ""
echo "  - ${GREEN}Linksklick${NC} auf Icon: Aufnahme starten/stoppen"
echo "  - ${GREEN}Rechtsklick${NC} auf Icon: Menü mit Einstellungen"
echo ""
echo -e "${CYAN}Einstellungen:${NC}"
echo ""
echo "  - ${GREEN}Rechtsklick${NC} → Einstellungen → Alle Einstellungen..."
echo "  - Oder: gnome-extensions prefs jt-dictate@jt.tools"
echo ""
echo -e "${CYAN}Tastenkürzel einrichten (optional):${NC}"
echo ""
echo "  1. Öffne: Einstellungen → Tastatur → Tastaturkürzel"
echo "  2. Scrolle zu 'Eigene Tastaturkürzel' → '+'"
echo ""
echo "     Name:    JT Dictate Toggle"
echo "     Befehl:  ${GREEN}jt-dictate --toggle${NC}"
echo "     Kürzel:  (z.B. Super+D)"
echo ""
echo -e "${CYAN}CLI-Befehle:${NC}"
echo ""
echo "  jt-dictate           # Backend starten"
echo "  jt-dictate --toggle  # Toggle Aufnahme"
echo "  jt-dictate --start   # Aufnahme starten"
echo "  jt-dictate --stop    # Aufnahme stoppen"
echo "  jt-dictate --status  # Status anzeigen"
echo ""
echo -e "${YELLOW}Hinweis:${NC} Beim ersten Start wird das Whisper-Modell"
echo "heruntergeladen (~150MB für 'base'). Das dauert einmalig."
echo ""
