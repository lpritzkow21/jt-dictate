// SPDX-FileCopyrightText: Janeway Technology
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DBUS_NAME = 'de.janeway.Dictate';
const DBUS_PATH = '/de/janeway/Dictate';
const DBUS_INTERFACE = 'de.janeway.Dictate';

const DictateInterfaceXml = `
<node>
  <interface name="${DBUS_INTERFACE}">
    <method name="Toggle"/>
    <method name="Start"/>
    <method name="Stop"/>
    <method name="Status">
      <arg type="s" direction="out"/>
    </method>
  </interface>
</node>
`;

const DictateNodeInfo = Gio.DBusNodeInfo.new_for_xml(DictateInterfaceXml);
const DictateIfaceInfo = DictateNodeInfo.lookup_interface(DBUS_INTERFACE);

// D-Bus Call Timeout in ms — kurz halten damit GNOME Shell nie lange hängt
const DBUS_TIMEOUT_MS = 2000;

const DictateIndicator = GObject.registerClass(
class DictateIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Janeway Dictate', false);

        this._extension = extension;
        this._isRecording = false;
        this._proxy = null;
        this._proxyReady = false;
        this._statusCheckId = null;
        this._reconnectIds = [];
        this._destroyed = false;
        this._backendStarting = false;
        this._toggleInFlight = false;

        // Icon
        this._icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // Menü (für Rechtsklick)
        this._buildMenu();

        // D-Bus Proxy erstellen
        this._connectProxy();

        // Status regelmäßig prüfen
        this._startStatusCheck();
    }

    _connectProxy() {
        if (this._destroyed) return;

        this._proxyReady = false;
        this._proxy = null;

        // Gio.DBusProxy.new() ist vollständig async — kein synchroner
        // Introspect-Call der GNOME Shell blockieren könnte.
        Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            DictateIfaceInfo,
            DBUS_NAME,
            DBUS_PATH,
            DBUS_INTERFACE,
            null,
            (source, result) => {
                if (this._destroyed) return;
                try {
                    let proxy = Gio.DBusProxy.new_finish(result);
                    if (proxy.get_name_owner() !== null) {
                        this._proxy = proxy;
                        this._proxy.set_default_timeout(DBUS_TIMEOUT_MS);
                        this._proxyReady = true;
                        this._backendStarting = false;
                    }
                } catch (e) {
                    // Proxy-Erstellung fehlgeschlagen — ignorieren, nächster Poll probiert erneut
                }
            }
        );
    }

    _ensureProxy() {
        if (this._destroyed) return;
        if (!this._proxy || !this._proxyReady) {
            this._connectProxy();
        }
    }

    _buildMenu() {
        this._statusItem = new PopupMenu.PopupMenuItem('Bereit', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._toggleItem = new PopupMenu.PopupMenuItem('Aufnahme starten');
        this._toggleItem.connect('activate', () => this._toggle());
        this.menu.addMenuItem(this._toggleItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let settingsMenu = new PopupMenu.PopupSubMenuMenuItem('Einstellungen');

        this._autoClipboardItem = new PopupMenu.PopupSwitchMenuItem('Automatisch in Zwischenablage', true);
        this._autoClipboardItem.connect('toggled', (item) => {
            this._setSetting('auto_clipboard', item.state);
        });
        settingsMenu.menu.addMenuItem(this._autoClipboardItem);

        settingsMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Modell-Label direkt im Settings-Menü (kein verschachteltes Submenü,
        // da GNOME Shell Probleme mit doppelt verschachtelten Submenüs hat)
        let modelLabel = new PopupMenu.PopupMenuItem('Whisper-Modell:', {reactive: false});
        settingsMenu.menu.addMenuItem(modelLabel);

        this._modelItems = {};
        for (const model of ['tiny', 'base', 'small', 'medium']) {
            let item = new PopupMenu.PopupMenuItem(`  ${model}`);
            item.connect('activate', () => this._setModel(model));
            settingsMenu.menu.addMenuItem(item);
            this._modelItems[model] = item;
        }
        this._markModel('base');

        this.menu.addMenuItem(settingsMenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let startBackendItem = new PopupMenu.PopupMenuItem('Backend starten');
        startBackendItem.connect('activate', () => this._startBackend());
        this.menu.addMenuItem(startBackendItem);

        this._loadSettings();
    }

    _markModel(activeModel) {
        for (const [name, item] of Object.entries(this._modelItems)) {
            item.setOrnament(name === activeModel
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NONE);
        }
    }

    _loadSettings() {
        let configPath = GLib.build_filenamev([
            GLib.get_home_dir(), '.config', 'janeway-dictate', 'settings.json',
        ]);
        let file = Gio.File.new_for_path(configPath);

        file.load_contents_async(null, (f, res) => {
            try {
                let [success, contents] = f.load_contents_finish(res);
                if (success) {
                    let settings = JSON.parse(new TextDecoder().decode(contents));
                    this._autoClipboardItem.setToggleState(settings.auto_clipboard ?? true);
                    this._markModel(settings.model ?? 'base');
                }
            } catch (e) {
                // Datei existiert nicht oder ist ungültig — defaults beibehalten
            }
        });
    }

    _setSetting(key, value) {
        // In-Memory Cache aktualisieren
        if (!this._settingsCache) this._settingsCache = {};
        this._settingsCache[key] = value;

        // Async auf Disk schreiben
        let configDir = GLib.build_filenamev([
            GLib.get_home_dir(), '.config', 'janeway-dictate',
        ]);
        let configPath = GLib.build_filenamev([configDir, 'settings.json']);
        let file = Gio.File.new_for_path(configPath);

        GLib.mkdir_with_parents(configDir, 0o755);

        file.load_contents_async(null, (f, res) => {
            let settings = {};
            try {
                let [success, contents] = f.load_contents_finish(res);
                if (success)
                    settings = JSON.parse(new TextDecoder().decode(contents));
            } catch (e) {
                // File doesn't exist yet, start fresh
            }

            // Alle gecachten Werte übernehmen
            Object.assign(settings, this._settingsCache);

            let data = new TextEncoder().encode(JSON.stringify(settings, null, 2));
            file.replace_contents_async(
                data, null, false, Gio.FileCreateFlags.NONE, null,
                (f2, res2) => {
                    try {
                        f2.replace_contents_finish(res2);
                    } catch (e) {
                        log(`Janeway Dictate: Error saving setting: ${e}`);
                    }
                }
            );
        });
    }

    _setModel(model) {
        this._setSetting('model', model);
        this._markModel(model);
        Main.notify('Janeway Dictate', `Modell '${model}' wird beim nächsten Start geladen`);
    }

    /**
     * Prüft ob der D-Bus Name aktuell einen Owner hat (async).
     * Ruft callback(true/false) auf.
     */
    _isBackendOnBus(callback) {
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'NameHasOwner',
            new GLib.Variant('(s)', [DBUS_NAME]),
            new GLib.VariantType('(b)'),
            Gio.DBusCallFlags.NONE,
            500,
            null,
            (connection, result) => {
                try {
                    let reply = connection.call_finish(result);
                    callback(reply.get_child_value(0).get_boolean());
                } catch (e) {
                    callback(false);
                }
            }
        );
    }

    _startBackend() {
        if (this._destroyed) return;

        // Verhindere mehrfaches Starten
        if (this._backendStarting) return;

        // Prüfe ob Backend schon auf dem Bus ist (async)
        this._isBackendOnBus((onBus) => {
            if (this._destroyed) return;

            if (onBus) {
                this._connectProxy();
                return;
            }

            this._backendStarting = true;

            try {
                // nice -n 10: Backend mit niedrigerer CPU-Priorität starten,
                // damit Whisper-Inferenz GNOME Shell nicht aushungert.
                GLib.spawn_command_line_async('nice -n 10 janeway-dictate');
                Main.notify('Janeway Dictate', 'Backend wird gestartet...');

                // Reconnect-Versuche nach Backend-Start
                let attempts = 0;
                const tryConnect = () => {
                    if (this._destroyed) return GLib.SOURCE_REMOVE;

                    attempts++;

                    this._isBackendOnBus((found) => {
                        if (this._destroyed) return;

                        if (found) {
                            this._connectProxy();
                            this._backendStarting = false;
                            return;
                        }

                        if (attempts < 10) {
                            let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, tryConnect);
                            this._reconnectIds.push(id);
                        } else {
                            this._backendStarting = false;
                            Main.notify('Janeway Dictate', 'Backend konnte nicht gestartet werden.');
                        }
                    });
                    return GLib.SOURCE_REMOVE;
                };

                let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, tryConnect);
                this._reconnectIds.push(id);
            } catch (e) {
                this._backendStarting = false;
                Main.notify('Janeway Dictate', `Fehler beim Starten: ${e.message}`);
            }
        });
    }

    _toggle() {
        // Debounce: verhindere Doppelklick / schnelle Wiederholung
        if (this._toggleInFlight) return;

        if (!this._proxyReady) {
            Main.notify('Janeway Dictate', 'Backend nicht erreichbar. Starte Backend...');
            this._startBackend();
            return;
        }

        this._toggleInFlight = true;

        // Optimistic UI Update: Icon sofort wechseln, nicht auf D-Bus warten
        if (this._isRecording) {
            // Stoppen geklickt → sofort Processing-State zeigen
            this._setProcessingState();
        } else {
            // Starten geklickt → sofort Recording-State zeigen
            this._setRecordingState(true);
        }

        this._proxy.call(
            'Toggle', null,
            Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null,
            (proxy, result) => {
                this._toggleInFlight = false;
                if (this._destroyed) return;

                try {
                    proxy.call_finish(result);
                    this._updateStatus();
                } catch (e) {
                    // Optimistic Update rückgängig machen
                    this._setRecordingState(false);
                    Main.notify('Janeway Dictate', 'Backend nicht erreichbar. Starte Backend...');
                    this._proxyReady = false;
                    this._proxy = null;
                    this._startBackend();
                }
            }
        );
    }

    _updateStatus() {
        if (this._destroyed) return;

        if (!this._proxyReady) {
            this._setRecordingState(false);
            if (this._backendStarting) {
                this._statusItem.label.text = 'Backend startet...';
            } else {
                this._statusItem.label.text = 'Backend nicht gestartet';
                // Nur Proxy neu aufbauen wenn Backend auf dem Bus ist (async)
                this._isBackendOnBus((onBus) => {
                    if (this._destroyed) return;
                    if (onBus) this._connectProxy();
                });
            }
            return;
        }

        this._proxy.call(
            'Status', null,
            Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null,
            (proxy, result) => {
                if (this._destroyed) return;

                try {
                    let reply = proxy.call_finish(result);
                    let status = reply.get_child_value(0).get_string()[0];

                    if (status === 'recording') {
                        this._setRecordingState(true);
                    } else if (status === 'processing') {
                        this._setProcessingState();
                    } else {
                        this._setRecordingState(false);
                    }
                } catch (e) {
                    this._setRecordingState(false);
                    this._statusItem.label.text = 'Backend nicht erreichbar';
                    this._proxyReady = false;
                    this._proxy = null;
                }
            }
        );
    }

    _setRecordingState(recording) {
        if (this._destroyed) return;

        this._isRecording = recording;

        // Alle State-Klassen entfernen
        this._icon.remove_style_class_name('recording');
        this._icon.remove_style_class_name('processing');

        if (recording) {
            this._icon.icon_name = 'media-record-symbolic';
            this._icon.add_style_class_name('recording');
            this._toggleItem.label.text = 'Aufnahme stoppen';
            this._statusItem.label.text = 'Aufnahme läuft...';
        } else {
            this._icon.icon_name = 'audio-input-microphone-symbolic';
            this._toggleItem.label.text = 'Aufnahme starten';
            this._statusItem.label.text = 'Bereit';
        }
    }

    _setProcessingState() {
        if (this._destroyed) return;

        this._isRecording = false;

        // Alle State-Klassen entfernen, dann Processing setzen
        this._icon.remove_style_class_name('recording');
        this._icon.add_style_class_name('processing');
        this._icon.icon_name = 'emblem-synchronizing-symbolic';
        this._toggleItem.label.text = 'Verarbeitung läuft...';
        this._statusItem.label.text = 'Text wird verarbeitet...';
    }

    _startStatusCheck() {
        this._statusCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this._destroyed) return GLib.SOURCE_REMOVE;
            // Nur pollen wenn Proxy bereit oder Backend am Starten
            if (this._proxyReady || this._backendStarting) {
                this._updateStatus();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopStatusCheck() {
        if (this._statusCheckId) {
            GLib.source_remove(this._statusCheckId);
            this._statusCheckId = null;
        }
        for (let id of this._reconnectIds) {
            try {
                GLib.source_remove(id);
            } catch (e) {
                // Timer already expired
            }
        }
        this._reconnectIds = [];
    }

    // Überschreibt PanelMenu.Button.vfunc_event() komplett.
    // Original (GNOME 49): jeder BUTTON_PRESS/TOUCH_BEGIN toggled das Menü.
    // Wir: Linksklick = Aufnahme toggle, Rechtsklick = Menü toggle.
    vfunc_event(event) {
        let type = event.type();

        if (type === Clutter.EventType.TOUCH_BEGIN ||
            type === Clutter.EventType.BUTTON_PRESS) {

            // Nur bei Mausklick den Button prüfen
            if (type === Clutter.EventType.BUTTON_PRESS) {
                let button = event.get_button();

                if (button === Clutter.BUTTON_PRIMARY) {
                    this._toggle();
                    return Clutter.EVENT_STOP;
                }

                if (button === Clutter.BUTTON_SECONDARY) {
                    this.menu.toggle();
                    return Clutter.EVENT_STOP;
                }

                // Mittlere Maustaste etc. -> ignorieren
                return Clutter.EVENT_STOP;
            }

            // Touch -> Menü öffnen (Standard-Verhalten)
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        this._destroyed = true;
        this._stopStatusCheck();
        super.destroy();
    }
});

export default class JanewayDictateExtension extends Extension {
    enable() {
        this._indicator = new DictateIndicator(this);
        Main.panel.addToStatusArea('janeway-dictate', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
