# Changelog - Janeway Dictate

## [0.1.0-beta] - 2026-03-25 (geplant)

Erster Beta-Release nach intensiver Entwicklung und Debugging.

### Features
- Push-to-Talk Speech-to-Text für GNOME/Linux
- Whisper-basierte Transkription (faster-whisper, Modelle: tiny/base/small/medium)
- GNOME Shell Extension mit Panel-Icon
  - Linksklick: Aufnahme starten/stoppen
  - Rechtsklick: Einstellungen-Menü
- 3-State Icon-Feedback: idle (Mikrofon) → recording (rot) → processing (orange)
- Automatische Zwischenablage-Kopie
- D-Bus Service für CLI-Steuerung (`--toggle`, `--start`, `--stop`, `--status`)
- Persistente Einstellungen (~/.config/janeway-dictate/settings.json)

### Architektur
- Headless Python Backend mit GLib MainLoop
- GNOME Shell Extension für UI (kein eigenes App-Fenster)
- Kommunikation über D-Bus (de.janeway.Dictate)
- Alle D-Bus Calls vollständig async (kein Desktop-Freeze)

---

## Entwicklungshistorie

### 2026-03-24 (Nacht)
- **Fix:** Transkription schneidet letzte Wörter/Sätze ab
  - Ursache: Audio wurde in 3s-Chunks zerhackt, Race Condition im Transkriptions-Thread
  - Lösung: Komplettes Audio wird gesammelt und nach Stop auf einmal transkribiert
  - beam_size von 1 auf 5 erhöht für bessere Qualität
- **Entfernt:** Live-Typing Feature (funktionierte nicht, wird später reimplementiert)

### 2026-03-24 (Abend)
- **Fix:** Modellmenü nicht klickbar (verschachtelte Submenüs → flache Liste)
- **Fix:** Icon reagiert erst nach D-Bus Roundtrip (Optimistic UI Update)
- **Neu:** 3-State Icon (idle/recording/processing)

### 2026-03-24 (Tag)
- **Fix:** Desktop-Freeze durch synchrone D-Bus Calls
  - Alle sync Calls in Extension → async umgestellt
  - Backend-Start mit `nice -n 10` für niedrigere CPU-Priorität

### 2026-03-23
- Initiale Entwicklung: Backend, Extension, D-Bus Integration
- Major Bugfix Session (11/11 Tests bestanden)
