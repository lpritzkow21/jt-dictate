#!/usr/bin/env python3
"""
JT Dictate - Push-to-Talk Speech-to-Text für GNOME/Linux
Headless Backend mit D-Bus Service.
Die UI (Icon, Menü) wird von der GNOME Shell Extension bereitgestellt.

Copyright (c) JT Tools
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
APP_NAME = "JT Dictate"
APP_ID = "jt-dictate"
DBUS_SERVICE = "de.jt.Dictate"
DBUS_PATH = "/de/jt/Dictate"
CONFIG_DIR = os.path.expanduser("~/.config/jt-dictate")
CONFIG_FILE = os.path.join(CONFIG_DIR, "settings.json")

# Standard-Einstellungen
DEFAULT_SETTINGS = {
    "auto_clipboard": True,
    "model": "base",
    "language": None,
    "sound_enabled": True,
    "sound_start_volume": 0.5,
    "sound_stop_volume": 0.5,
    "sound_finish_volume": 0.7,
    "sound_start": "click",
    "sound_stop": "click",
    "sound_finish": "gentle-ping",
    "notifications_enabled": False,
}

# Pfad zu den Built-in Sounds der Extension
SOUNDS_DIRS = [
    os.path.expanduser("~/.local/share/gnome-shell/extensions/jt-dictate@jt.tools/sounds"),
    "/usr/share/gnome-shell/extensions/jt-dictate@jt.tools/sounds",
]


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


class JtDictateDBus(dbus.service.Object):
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
        if self.app.is_loading_model:
            return "loading"
        elif self.app.is_recording:
            return "recording"
        elif self.app.is_processing:
            return "processing"
        else:
            return "idle"

    @dbus.service.signal(DBUS_SERVICE, signature='ad')
    def AudioLevels(self, levels):
        """Signal mit aktuellen Audio-Levels (Array von doubles 0.0-1.0)."""
        pass

    @dbus.service.signal(DBUS_SERVICE, signature='sd')
    def ModelProgress(self, message, progress):
        """Signal für Modell-Lade-Fortschritt (message, 0.0-1.0)."""
        pass


class Transcriber:
    """Whisper-Transkription für vollständige Audio-Aufnahmen."""

    def __init__(self, model_size="base", progress_callback=None):
        self.model_size = model_size
        self.model = None
        self.sample_rate = 16000
        self._progress_callback = progress_callback

    def _report_progress(self, message, progress):
        """Meldet Fortschritt über Callback."""
        if self._progress_callback:
            self._progress_callback(message, progress)

    def _is_model_cached(self):
        """Prüft ob das Modell bereits lokal vorhanden ist."""
        try:
            from huggingface_hub import try_to_load_from_cache
            # faster-whisper nutzt CTranslate2-Modelle von Systran
            repo_id = f"Systran/faster-whisper-{self.model_size}"
            result = try_to_load_from_cache(repo_id, "model.bin")
            return result is not None
        except Exception:
            # Falls wir den Cache-Status nicht prüfen können, nehmen wir an
            # dass es nicht gecached ist — besser einmal zu viel Progress zeigen
            return False

    def load_model(self):
        """Lädt das Whisper-Modell."""
        if self.model is None:
            cached = self._is_model_cached()

            if not cached:
                self._report_progress(
                    f"Lade Modell '{self.model_size}' herunter...", 0.0)
                print(f"Modell '{self.model_size}' wird heruntergeladen...")
            else:
                self._report_progress(
                    f"Lade Modell '{self.model_size}'...", 0.5)
                print(f"Lade Whisper-Modell '{self.model_size}' aus Cache...")

            from faster_whisper import WhisperModel
            self.model = WhisperModel(
                self.model_size,
                device="cpu",
                compute_type="int8"
            )
            self._report_progress("Modell geladen", 1.0)
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


class JtDictate:
    def __init__(self):
        self.is_recording = False
        self.is_processing = False
        self.is_loading_model = False
        self.recording_thread = None
        self._audio_buffer = []
        self._audio_lock = threading.Lock()
        self.sample_rate = 16000
        self.start_time = None
        self._mainloop = None

        # Einstellungen laden
        self.settings = Settings()

        # Transcriber mit Progress-Callback
        self.transcriber = Transcriber(
            model_size=self.settings.get("model"),
            progress_callback=self._on_model_progress,
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
            self.dbus_obj = JtDictateDBus(self, self._bus, DBUS_PATH)
            print(f"D-Bus Service gestartet: {DBUS_SERVICE}")
        except dbus.exceptions.NameExistsException:
            print(f"{APP_NAME} läuft bereits (D-Bus Name belegt).")
            sys.exit(0)
        except Exception as e:
            print(f"D-Bus Fehler: {e}")
            self.dbus_obj = None

    def _on_model_progress(self, message, progress):
        """Callback für Modell-Lade-Fortschritt."""
        if self.dbus_obj:
            GLib.idle_add(self.dbus_obj.ModelProgress, message, float(progress))
        if progress >= 1.0:
            self.is_loading_model = False

    def toggle_recording(self):
        """Startet oder stoppt die Aufnahme."""
        if self.is_loading_model:
            return  # Warte bis Modell geladen
        if self.is_recording:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self):
        """Startet die Aufnahme."""
        if self.is_recording or self.is_loading_model:
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
            self.transcriber = Transcriber(
                model_size=current_model,
                progress_callback=self._on_model_progress,
            )

        # Modell vorladen (zeigt Progress wenn Download nötig)
        if self.transcriber.model is None:
            self.is_loading_model = True
            threading.Thread(target=self._preload_model_then_record, daemon=True).start()
            return

        self._begin_recording()

    def _preload_model_then_record(self):
        """Lädt das Modell in einem separaten Thread, startet dann die Aufnahme."""
        try:
            self.transcriber.load_model()
        except Exception as e:
            self.is_loading_model = False
            GLib.idle_add(self.show_notification, "Fehler",
                          f"Modell konnte nicht geladen werden: {e}")
            print(f"Modell-Lade-Fehler: {e}")
            return
        self.is_loading_model = False
        # Starte Aufnahme im Main-Thread
        GLib.idle_add(self._begin_recording)

    def _begin_recording(self):
        """Startet die eigentliche Aufnahme (Modell bereits geladen)."""
        if self.is_recording:
            return
        self.is_recording = True
        with self._audio_lock:
            self._audio_buffer = []
        self.start_time = time.time()

        # Starte Aufnahme-Thread
        self.recording_thread = threading.Thread(target=self._record_audio)
        self.recording_thread.daemon = True
        self.recording_thread.start()

        self._play_sound("start")
        self.show_notification("Aufnahme gestartet", "Sprich jetzt...")
        print("Aufnahme gestartet...")

    def _record_audio(self):
        """Nimmt Audio auf und sammelt alle Daten in einem Buffer."""
        blocksize = 1024
        # Für Level-Berechnung: sammle Samples zwischen Level-Updates
        level_samples = []
        level_interval = 0.06  # ~60ms, passend zu 16fps Animation
        last_level_time = time.time()
        num_bands = 16  # Anzahl Frequenzbänder für Visualisierung

        try:
            with sounddevice.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype='float32',
                blocksize=blocksize
            ) as stream:
                while self.is_recording:
                    data, overflowed = stream.read(blocksize)
                    flat = data.flatten().copy()
                    with self._audio_lock:
                        self._audio_buffer.append(flat)

                    level_samples.append(flat)

                    now = time.time()
                    if now - last_level_time >= level_interval:
                        last_level_time = now
                        # Berechne Frequenzbänder via FFT
                        try:
                            chunk = np.concatenate(level_samples)
                            level_samples = []
                            levels = self._compute_band_levels(chunk, num_bands)
                            if self.dbus_obj:
                                GLib.idle_add(self.dbus_obj.AudioLevels,
                                              dbus.Array(levels, signature='d'))
                        except Exception:
                            level_samples = []

        except Exception as e:
            print(f"Aufnahme-Fehler: {e}")
            GLib.idle_add(self.show_notification, "Fehler", str(e))

    def _compute_band_levels(self, audio_chunk, num_bands):
        """Berechnet Frequenzband-Levels aus einem Audio-Chunk via FFT."""
        if len(audio_chunk) < 64:
            return [0.0] * num_bands

        # FFT berechnen
        fft = np.abs(np.fft.rfft(audio_chunk))
        # Nur relevanten Frequenzbereich (bis ~8kHz bei 16kHz Sample Rate)
        freqs = np.fft.rfftfreq(len(audio_chunk), 1.0 / self.sample_rate)

        # Logarithmische Frequenzbänder (menschliche Wahrnehmung)
        min_freq = 80
        max_freq = min(7500, self.sample_rate / 2)
        band_edges = np.logspace(
            np.log10(min_freq), np.log10(max_freq), num_bands + 1
        )

        levels = []
        for i in range(num_bands):
            low = band_edges[i]
            high = band_edges[i + 1]
            mask = (freqs >= low) & (freqs < high)
            if np.any(mask):
                band_energy = np.mean(fft[mask])
                # Normalisieren: dB-Skala, dann auf 0-1 mappen
                db = 20 * np.log10(max(band_energy, 1e-10))
                # Typischer Bereich: -60dB (Stille) bis -5dB (laut)
                normalized = max(0.0, min(1.0, (db + 55) / 50))
                levels.append(float(normalized))
            else:
                levels.append(0.0)

        return levels

    def stop_recording(self):
        """Stoppt die Aufnahme."""
        if not self.is_recording:
            return

        self.is_recording = False
        self.is_processing = True
        self._play_sound("stop")

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

                self._play_sound("finish")
                preview = final_text[:80] + "..." if len(final_text) > 80 else final_text
                GLib.idle_add(self.show_notification, "Fertig!", preview)
                print(f"\n=== Vollständiger Text ===\n{final_text}\n")
            else:
                self._play_sound("finish")
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

    def _find_sounds_dir(self):
        """Findet den Ordner mit den Built-in Sounds."""
        for d in SOUNDS_DIRS:
            if os.path.isdir(d):
                return d
        return None

    def _resolve_sound_path(self, sound_setting):
        """Löst eine Sound-Einstellung in einen Dateipfad auf."""
        if not sound_setting or sound_setting == "none":
            return None

        # builtin:xxx Format
        if sound_setting.startswith("builtin:"):
            sound_id = sound_setting.split(":", 1)[1]
            sounds_dir = self._find_sounds_dir()
            if sounds_dir:
                path = os.path.join(sounds_dir, f"{sound_id}.wav")
                if os.path.isfile(path):
                    return path
            return None

        # Direkter Dateipfad
        if os.path.isfile(sound_setting):
            return sound_setting

        # Legacy 'default' → verwende gentle-ping als Fallback
        if sound_setting == "default":
            sounds_dir = self._find_sounds_dir()
            if sounds_dir:
                path = os.path.join(sounds_dir, "gentle-ping.wav")
                if os.path.isfile(path):
                    return path
            return None

        # Bare name (z.B. 'click', 'gentle-ping') → als Built-in Sound behandeln
        sounds_dir = self._find_sounds_dir()
        if sounds_dir:
            path = os.path.join(sounds_dir, f"{sound_setting}.wav")
            if os.path.isfile(path):
                return path

        return None

    def _play_sound(self, sound_type):
        """Spielt einen Start/Stop/Finish-Sound ab."""
        try:
            if not self.settings.get("sound_enabled"):
                return
            # Per-sound volume with backwards compatibility
            volume = self.settings.get(f"sound_{sound_type}_volume")
            if volume is None:
                volume = self.settings.get("sound_volume")
            if volume is None:
                volume = 0.5
            if volume <= 0:
                return

            sound_setting = self.settings.get(f"sound_{sound_type}")
            sound_file = self._resolve_sound_path(sound_setting)

            if not sound_file:
                return

            # Datei via paplay abspielen
            subprocess.Popen(
                ["paplay", f"--volume={int(volume * 65536)}", sound_file],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except Exception:
            pass  # Sound ist nicht kritisch

    @staticmethod
    def _volume_to_db(volume):
        """Konvertiert 0.0-1.0 Volume zu dB-String für canberra."""
        import math
        if volume <= 0:
            return "-100"
        db = 20 * math.log10(volume)
        return f"{db:.0f}"

    def show_notification(self, title, message):
        """Zeigt Notification (nur wenn in Settings aktiviert)."""
        try:
            if not self.settings.get("notifications_enabled"):
                return
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
        print(f"  jt-dictate --toggle")
        print(f"  jt-dictate --status")
        print("")

        # Modell beim Start im Hintergrund vorladen
        self._preload_model()

        self._mainloop = GLib.MainLoop()
        self._mainloop.run()

    def _preload_model(self):
        """Lädt das Whisper-Modell im Hintergrund vor, damit erste Aufnahme sofort starten kann."""
        self.is_loading_model = True
        def _load():
            try:
                self.transcriber.load_model()
                print("Modell vorgeladen — bereit für Aufnahme.")
            except Exception as e:
                print(f"Modell-Vorladen fehlgeschlagen: {e}")
            finally:
                self.is_loading_model = False
        threading.Thread(target=_load, daemon=True).start()


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
  jt-dictate              Startet das Backend
  jt-dictate --toggle     Startet/Stoppt Aufnahme (für Tastenkürzel)
  jt-dictate --start      Startet Aufnahme
  jt-dictate --stop       Stoppt Aufnahme
  jt-dictate --status     Zeigt aktuellen Status
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
                app = JtDictate()
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

        app = JtDictate()
        app.run()


if __name__ == "__main__":
    main()
