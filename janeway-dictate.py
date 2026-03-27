#!/usr/bin/env python3
"""
Janeway Dictate - Push-to-Talk Speech-to-Text für GNOME/Linux
Headless Backend mit D-Bus Service.
Die UI (Icon, Menü) wird von der GNOME Shell Extension bereitgestellt.

Copyright (c) Janeway Technology
"""

import sys
import os
import json
import argparse

# D-Bus Mainloop MUSS vor allem anderen initialisiert werden
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
DBusGMainLoop(set_as_default=True)

import gi
gi.require_version('Notify', '0.7')

from gi.repository import GLib, Notify
import subprocess
import threading
import time
import signal
import numpy as np

# Globale Variablen für lazy imports
sounddevice = None

# Konstanten
APP_NAME = "Janeway Dictate"
APP_ID = "janeway-dictate"
DBUS_SERVICE = "de.janeway.Dictate"
DBUS_PATH = "/de/janeway/Dictate"
CONFIG_DIR = os.path.expanduser("~/.config/janeway-dictate")
CONFIG_FILE = os.path.join(CONFIG_DIR, "settings.json")

# Standard-Einstellungen
DEFAULT_SETTINGS = {
    "auto_clipboard": True,
    "model": "base",
    "language": None,
}


class Settings:
    """Persistente Einstellungsverwaltung."""

    def __init__(self):
        self._settings = DEFAULT_SETTINGS.copy()
        self.load()

    def load(self):
        """Lädt Einstellungen aus Datei."""
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r') as f:
                    saved = json.load(f)
                    self._settings.update(saved)
        except Exception as e:
            print(f"Einstellungen laden fehlgeschlagen: {e}")

    def save(self):
        """Speichert Einstellungen."""
        try:
            os.makedirs(CONFIG_DIR, exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                json.dump(self._settings, f, indent=2)
        except Exception as e:
            print(f"Einstellungen speichern fehlgeschlagen: {e}")

    def get(self, key):
        return self._settings.get(key, DEFAULT_SETTINGS.get(key))

    def set(self, key, value):
        self._settings[key] = value
        self.save()


class JanewayDictateDBus(dbus.service.Object):
    """D-Bus Interface für Kommunikation mit der GNOME Shell Extension."""

    def __init__(self, app, bus, path):
        self.app = app
        dbus.service.Object.__init__(self, bus, path)

    @dbus.service.method(DBUS_SERVICE, in_signature='', out_signature='')
    def Toggle(self):
        GLib.idle_add(self.app.toggle_recording)

    @dbus.service.method(DBUS_SERVICE, in_signature='', out_signature='')
    def Start(self):
        GLib.idle_add(self.app.start_recording)

    @dbus.service.method(DBUS_SERVICE, in_signature='', out_signature='')
    def Stop(self):
        GLib.idle_add(self.app.stop_recording)

    @dbus.service.method(DBUS_SERVICE, in_signature='', out_signature='s')
    def Status(self):
        if self.app.is_recording:
            return "recording"
        elif self.app.is_processing:
            return "processing"
        else:
            return "idle"


class Transcriber:
    """Whisper-Transkription für vollständige Audio-Aufnahmen."""

    def __init__(self, model_size="base"):
        self.model_size = model_size
        self.model = None
        self.sample_rate = 16000

    def load_model(self):
        """Lädt das Whisper-Modell."""
        if self.model is None:
            print(f"Lade Whisper-Modell '{self.model_size}'...")
            from faster_whisper import WhisperModel
            self.model = WhisperModel(
                self.model_size,
                device="cpu",
                compute_type="int8"
            )
        return self.model

    def transcribe(self, audio_data):
        """Transkribiert komplette Audio-Daten."""
        if len(audio_data) < self.sample_rate * 0.3:
            return ""

        model = self.load_model()

        try:
            segments, info = model.transcribe(
                audio_data,
                language=None,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=300
                )
            )

            text = " ".join([seg.text.strip() for seg in segments])
            return text.strip()
        except Exception as e:
            print(f"Transkriptionsfehler: {e}")
            return ""


class JanewayDictate:
    def __init__(self):
        self.is_recording = False
        self.is_processing = False
        self.recording_thread = None
        self._audio_buffer = []
        self._audio_lock = threading.Lock()
        self.sample_rate = 16000
        self.start_time = None
        self._mainloop = None

        # Einstellungen laden
        self.settings = Settings()

        # Transcriber
        self.transcriber = Transcriber(
            model_size=self.settings.get("model"),
        )

        # Notification initialisieren
        Notify.init(APP_ID)

        # D-Bus Service registrieren
        self.setup_dbus()

    def setup_dbus(self):
        """Richtet D-Bus Service ein."""
        try:
            self._bus = dbus.SessionBus()

            # Erst prüfen ob schon eine Instanz läuft
            try:
                proxy = self._bus.get_object(DBUS_SERVICE, DBUS_PATH)
                interface = dbus.Interface(proxy, DBUS_SERVICE)
                interface.Status()
                # Wenn wir hier ankommen, läuft eine gesunde Instanz
                print(f"{APP_NAME} läuft bereits (D-Bus erreichbar).")
                sys.exit(0)
            except dbus.exceptions.DBusException:
                # Keine laufende Instanz oder sie antwortet nicht -> wir übernehmen
                pass

            # WICHTIG: BusName muss als Instanz-Variable gespeichert werden,
            # sonst wird es garbage-collected und der Name wird freigegeben!
            self._dbus_name = dbus.service.BusName(
                DBUS_SERVICE, self._bus,
                do_not_queue=True,
                replace_existing=True,
                allow_replacement=False
            )
            self.dbus_obj = JanewayDictateDBus(self, self._bus, DBUS_PATH)
            print(f"D-Bus Service gestartet: {DBUS_SERVICE}")
        except dbus.exceptions.NameExistsException:
            print(f"{APP_NAME} läuft bereits (D-Bus Name belegt).")
            sys.exit(0)
        except Exception as e:
            print(f"D-Bus Fehler: {e}")
            self.dbus_obj = None

    def toggle_recording(self):
        """Startet oder stoppt die Aufnahme."""
        if self.is_recording:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self):
        """Startet die Aufnahme."""
        if self.is_recording:
            return

        global sounddevice
        if sounddevice is None:
            import sounddevice as sd
            sounddevice = sd

        # Settings neu laden (könnten von Extension geändert worden sein)
        self.settings.load()

        # Modell ggf. mit neuem Model-Size neu laden
        current_model = self.settings.get("model")
        if current_model != self.transcriber.model_size:
            self.transcriber = Transcriber(model_size=current_model)

        self.is_recording = True
        with self._audio_lock:
            self._audio_buffer = []
        self.start_time = time.time()

        # Starte Aufnahme-Thread
        self.recording_thread = threading.Thread(target=self._record_audio)
        self.recording_thread.daemon = True
        self.recording_thread.start()

        self.show_notification("Aufnahme gestartet", "Sprich jetzt...")
        print("Aufnahme gestartet...")

    def _record_audio(self):
        """Nimmt Audio auf und sammelt alle Daten in einem Buffer."""
        blocksize = 1024

        try:
            with sounddevice.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype='float32',
                blocksize=blocksize
            ) as stream:
                while self.is_recording:
                    data, overflowed = stream.read(blocksize)
                    with self._audio_lock:
                        self._audio_buffer.append(data.flatten().copy())

        except Exception as e:
            print(f"Aufnahme-Fehler: {e}")
            GLib.idle_add(self.show_notification, "Fehler", str(e))

    def stop_recording(self):
        """Stoppt die Aufnahme."""
        if not self.is_recording:
            return

        self.is_recording = False
        self.is_processing = True

        # Finalisierung in separatem Thread, damit D-Bus sofort antwortet
        threading.Thread(target=self._finalize_recording, daemon=True).start()

    def _finalize_recording(self):
        """Wartet auf Recording-Thread, transkribiert dann alles auf einmal."""
        try:
            # Warte auf Recording-Thread
            if self.recording_thread:
                self.recording_thread.join(timeout=5.0)
                if self.recording_thread.is_alive():
                    print("Warnung: Recording-Thread noch aktiv")
                self.recording_thread = None

            # Audio zusammenbauen
            with self._audio_lock:
                if not self._audio_buffer:
                    GLib.idle_add(self.show_notification, "Hinweis", "Keine Audio-Daten aufgenommen")
                    return
                audio_data = np.concatenate(self._audio_buffer)
                self._audio_buffer = []

            duration = len(audio_data) / self.sample_rate
            print(f"Aufnahme beendet: {duration:.1f}s Audio, transkribiere...")

            # Gesamtes Audio auf einmal transkribieren
            final_text = self.transcriber.transcribe(audio_data)

            # Settings neu laden
            self.settings.load()

            if final_text:
                if self.settings.get("auto_clipboard"):
                    self.copy_to_clipboard(final_text)

                preview = final_text[:80] + "..." if len(final_text) > 80 else final_text
                GLib.idle_add(self.show_notification, "Fertig!", preview)
                print(f"\n=== Vollständiger Text ===\n{final_text}\n")
            else:
                GLib.idle_add(self.show_notification, "Hinweis", "Kein Text erkannt")
        finally:
            self.is_processing = False

    def copy_to_clipboard(self, text):
        """Kopiert in Clipboard."""
        try:
            if os.environ.get("WAYLAND_DISPLAY"):
                cmd = ["wl-copy"]
            else:
                cmd = ["xclip", "-selection", "clipboard"]
            subprocess.run(cmd, input=text, text=True, timeout=3,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    def show_notification(self, title, message):
        """Zeigt Notification."""
        try:
            n = Notify.Notification.new(f"{APP_NAME}: {title}", message, "audio-input-microphone")
            n.show()
        except Exception:
            pass

    def quit(self):
        """Beendet die App."""
        if self.is_recording:
            self.is_recording = False
        Notify.uninit()
        if self._mainloop:
            self._mainloop.quit()

    def run(self):
        """Startet die GLib Hauptschleife (headless, kein GTK)."""
        signal.signal(signal.SIGINT, lambda s, f: GLib.idle_add(self.quit))
        signal.signal(signal.SIGTERM, lambda s, f: GLib.idle_add(self.quit))

        print("=" * 50)
        print(f"{APP_NAME} - Backend Service")
        print("=" * 50)
        print("")
        print("Backend läuft headless (kein eigenes Icon).")
        print("Die UI wird von der GNOME Shell Extension bereitgestellt.")
        print("")
        print(f"D-Bus: {DBUS_SERVICE}")
        print("")
        print("Steuerung über GNOME Shell Extension oder CLI:")
        print(f"  janeway-dictate --toggle")
        print(f"  janeway-dictate --status")
        print("")

        self._mainloop = GLib.MainLoop()
        self._mainloop.run()


def send_dbus_command(command):
    """Sendet einen Befehl an die laufende Instanz."""
    try:
        bus = dbus.SessionBus()
        proxy = bus.get_object(DBUS_SERVICE, DBUS_PATH)
        interface = dbus.Interface(proxy, DBUS_SERVICE)

        if command == "toggle":
            interface.Toggle()
            print("Toggle-Signal gesendet.")
        elif command == "start":
            interface.Start()
            print("Start-Signal gesendet.")
        elif command == "stop":
            interface.Stop()
            print("Stop-Signal gesendet.")
        elif command == "status":
            status = interface.Status()
            print(f"Status: {status}")
        return True
    except dbus.exceptions.DBusException:
        return False


def main():
    parser = argparse.ArgumentParser(
        description=f"{APP_NAME} - Speech-to-Text Backend für GNOME/Linux",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Beispiele:
  janeway-dictate              Startet das Backend
  janeway-dictate --toggle     Startet/Stoppt Aufnahme (für Tastenkürzel)
  janeway-dictate --start      Startet Aufnahme
  janeway-dictate --stop       Stoppt Aufnahme
  janeway-dictate --status     Zeigt aktuellen Status
"""
    )

    parser.add_argument('--toggle', action='store_true',
                        help='Toggle Aufnahme (Start/Stop)')
    parser.add_argument('--start', action='store_true',
                        help='Aufnahme starten')
    parser.add_argument('--stop', action='store_true',
                        help='Aufnahme stoppen')
    parser.add_argument('--status', action='store_true',
                        help='Status anzeigen')

    args = parser.parse_args()

    # Wenn ein Befehl gegeben wurde, an laufende Instanz senden
    if args.toggle or args.start or args.stop or args.status:
        command = None
        if args.toggle:
            command = "toggle"
        elif args.start:
            command = "start"
        elif args.stop:
            command = "stop"
        elif args.status:
            command = "status"

        if send_dbus_command(command):
            sys.exit(0)
        else:
            if command in ["toggle", "start"]:
                print("Keine laufende Instanz gefunden. Starte Backend...")
                app = JanewayDictate()
                GLib.timeout_add(500, app.start_recording)
                app.run()
            else:
                print("Keine laufende Instanz gefunden.")
                sys.exit(1)
    else:
        # Normaler Start - prüfe ob bereits läuft
        try:
            bus = dbus.SessionBus()
            proxy = bus.get_object(DBUS_SERVICE, DBUS_PATH)
            print(f"{APP_NAME} läuft bereits. Verwende --toggle zum Starten/Stoppen.")
            sys.exit(0)
        except dbus.exceptions.DBusException:
            pass

        app = JanewayDictate()
        app.run()


if __name__ == "__main__":
    main()
