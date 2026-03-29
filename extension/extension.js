// SPDX-FileCopyrightText: JT Tools
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DBUS_NAME = 'de.jt.Dictate';
const DBUS_PATH = '/de/jt/Dictate';
const DBUS_INTERFACE = 'de.jt.Dictate';

const DictateInterfaceXml = `
<node>
  <interface name="${DBUS_INTERFACE}">
    <method name="Toggle"/>
    <method name="Start"/>
    <method name="Stop"/>
    <method name="Status">
      <arg type="s" direction="out"/>
    </method>
    <signal name="AudioLevels">
      <arg type="ad" name="levels"/>
    </signal>
    <signal name="ModelProgress">
      <arg type="s" name="message"/>
      <arg type="d" name="progress"/>
    </signal>
  </interface>
</node>
`;

const DictateNodeInfo = Gio.DBusNodeInfo.new_for_xml(DictateInterfaceXml);
const DictateIfaceInfo = DictateNodeInfo.lookup_interface(DBUS_INTERFACE);

// D-Bus Call Timeout in ms — kurz halten damit GNOME Shell nie lange hängt
const DBUS_TIMEOUT_MS = 2000;

// Persistente NotificationSource — wird einmal erstellt und wiederverwendet
let _notifySource = null;

function _ensureNotifySource() {
    if (_notifySource)
        return _notifySource;

    _notifySource = new MessageTray.Source({
        title: 'JT Dictate',
        iconName: 'audio-input-microphone-symbolic',
    });
    Main.messageTray.add(_notifySource);
    _notifySource.connect('destroy', () => { _notifySource = null; });
    return _notifySource;
}

// Kompatible Notification-Funktion (Main.notify wurde in GNOME 46 entfernt)
function _notify(title, body) {
    try {
        if (Main.notify) {
            // GNOME 45 und älter
            Main.notify(title, body);
            return;
        }

        // GNOME 46+: MessageTray direkt nutzen mit persistenter Source
        let source = _ensureNotifySource();
        let notification = new MessageTray.Notification({
            source,
            title,
            body,
            isTransient: true,
        });
        source.addNotification(notification);
    } catch (e) {
        console.error(`JT Dictate: Notification failed: ${e}`);
    }
}

const CONFIG_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'jt-dictate']);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, 'settings.json']);

const DEFAULT_SETTINGS = {
    auto_clipboard: true,
    model: 'base',
    language: null,
    pill_width: 200,
    pill_height: 40,
    pill_border_radius: 20,
    pill_bg_color: 'rgba(0,0,0,0.75)',
    pill_border_color: 'rgba(255,255,255,0.1)',
    pill_border_width: 1,
    pill_blur: 0,
    pill_shadow_intensity: 0.3,
    pill_margin_top: 60,
    pill_margin_horizontal: 0,
    pill_position: 'top-center',
    visualization_type: 'bars',
    bar_color_left: '#3584e4',
    bar_color_right: '#e01b24',
    bar_gradient: true,
    bar_count: 5,
    icon_name: 'audio-input-microphone-symbolic',
    icon_color: '#ffffff',
    custom_icon_path: '',
    recording_color: '#e01b24',
    processing_color: '#e5a50a',
    active_theme: 'default',
    follow_system_theme: false,
    sound_enabled: true,
    sound_volume: 0.5,
    sound_start: 'default',
    sound_stop: 'default',
};

// ─── Hilfsfunktionen ───

function _parseColorComponents(colorStr) {
    // Gibt {r, g, b, a} als 0-1 Werte zurück
    if (!colorStr || typeof colorStr !== 'string')
        return {r: 1, g: 1, b: 1, a: 1};
    if (colorStr.startsWith('rgba(')) {
        let m = colorStr.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
        if (m) return {r: parseInt(m[1])/255, g: parseInt(m[2])/255, b: parseInt(m[3])/255, a: parseFloat(m[4])};
    }
    if (colorStr.startsWith('rgb(')) {
        let m = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (m) return {r: parseInt(m[1])/255, g: parseInt(m[2])/255, b: parseInt(m[3])/255, a: 1};
    }
    if (colorStr.startsWith('#')) {
        let hex = colorStr.slice(1);
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        return {
            r: parseInt(hex.substring(0,2), 16)/255,
            g: parseInt(hex.substring(2,4), 16)/255,
            b: parseInt(hex.substring(4,6), 16)/255,
            a: 1,
        };
    }
    return {r: 1, g: 1, b: 1, a: 1};
}

function _lerpColor(c1, c2, t) {
    return {
        r: c1.r + (c2.r - c1.r) * t,
        g: c1.g + (c2.g - c1.g) * t,
        b: c1.b + (c2.b - c1.b) * t,
        a: c1.a + (c2.a - c1.a) * t,
    };
}

// ─── Audio-Visualisierungs-Canvas ───

const VisualizationCanvas = GObject.registerClass(
class VisualizationCanvas extends St.DrawingArea {
    _init(settings) {
        super._init({
            width: settings.pill_width - 50,
            height: settings.pill_height - 8,
        });
        this._settings = settings;
        this._levels = [];
        this._phase = 0;

        this.connect('repaint', (area) => this._draw(area));
    }

    setLevels(levels) {
        this._levels = levels;
        this._phase += 0.1;
        this.queue_repaint();
    }

    _draw(area) {
        let cr = area.get_context();
        let [w, h] = [this.get_width(), this.get_height()];
        let s = this._settings;
        let levels = this._levels;
        if (!levels.length) levels = new Array(s.bar_count).fill(0.05);

        let leftColor = _parseColorComponents(s.bar_color_left);
        let rightColor = _parseColorComponents(s.bar_color_right);

        switch (s.visualization_type) {
        case 'bars':
            this._drawBars(cr, w, h, levels, leftColor, rightColor);
            break;
        case 'waveform':
            this._drawWaveform(cr, w, h, levels, leftColor, rightColor);
            break;
        case 'pulse':
            this._drawPulse(cr, w, h, levels, leftColor, rightColor);
            break;
        case 'circle':
            this._drawCircle(cr, w, h, levels, leftColor, rightColor);
            break;
        case 'equalizer':
            this._drawEqualizer(cr, w, h, levels, leftColor, rightColor);
            break;
        default:
            this._drawBars(cr, w, h, levels, leftColor, rightColor);
        }

        cr.$dispose();
    }

    _drawBars(cr, w, h, levels, leftColor, rightColor) {
        let count = this._settings.bar_count;
        let gap = 3;
        let barWidth = (w - gap * (count - 1)) / count;
        if (barWidth < 2) barWidth = 2;
        let useGradient = this._settings.bar_gradient;

        for (let i = 0; i < count; i++) {
            let level = levels[i] || 0.05;
            let barH = Math.max(4, level * h);
            let x = i * (barWidth + gap);
            let y = (h - barH) / 2;

            let c = useGradient ? _lerpColor(leftColor, rightColor, i / Math.max(1, count - 1)) : leftColor;
            cr.setSourceRGBA(c.r, c.g, c.b, c.a * 0.9);

            // Abgerundete Ecken
            let radius = Math.min(barWidth / 2, 3);
            cr.newSubPath();
            cr.arc(x + barWidth - radius, y + radius, radius, -Math.PI/2, 0);
            cr.arc(x + barWidth - radius, y + barH - radius, radius, 0, Math.PI/2);
            cr.arc(x + radius, y + barH - radius, radius, Math.PI/2, Math.PI);
            cr.arc(x + radius, y + radius, radius, Math.PI, 3*Math.PI/2);
            cr.closePath();
            cr.fill();
        }
    }

    _drawWaveform(cr, w, h, levels, leftColor, rightColor) {
        let useGradient = this._settings.bar_gradient;
        let count = Math.max(levels.length, 8);
        let midY = h / 2;

        // Zeichne Segmentweise um Gradient per Segment zu simulieren
        cr.setLineWidth(2.5);

        // Hauptlinie
        let points = [];
        for (let i = 0; i <= count; i++) {
            let t = i / count;
            let x = t * w;
            let level = levels[i % levels.length] || 0.05;
            let y = midY + Math.sin(this._phase + i * 0.5) * level * midY * 0.8;
            points.push({x, y, t});
        }

        for (let i = 0; i < points.length - 1; i++) {
            let p0 = points[i];
            let p1 = points[i + 1];
            let c = useGradient
                ? _lerpColor(leftColor, rightColor, (p0.t + p1.t) / 2)
                : leftColor;
            cr.setSourceRGBA(c.r, c.g, c.b, c.a * 0.9);
            cr.moveTo(p0.x, p0.y);
            cr.lineTo(p1.x, p1.y);
            cr.stroke();
        }

        // Spiegelung (schwächer)
        let mirrorPoints = [];
        for (let i = 0; i <= count; i++) {
            let t = i / count;
            let x = t * w;
            let level = levels[i % levels.length] || 0.05;
            let y = midY - Math.sin(this._phase + i * 0.5) * level * midY * 0.6;
            mirrorPoints.push({x, y, t});
        }

        cr.setLineWidth(1.5);
        for (let i = 0; i < mirrorPoints.length - 1; i++) {
            let p0 = mirrorPoints[i];
            let p1 = mirrorPoints[i + 1];
            let c = useGradient
                ? _lerpColor(leftColor, rightColor, (p0.t + p1.t) / 2)
                : leftColor;
            cr.setSourceRGBA(c.r, c.g, c.b, c.a * 0.35);
            cr.moveTo(p0.x, p0.y);
            cr.lineTo(p1.x, p1.y);
            cr.stroke();
        }
    }

    _drawPulse(cr, w, h, levels, leftColor, rightColor) {
        let avgLevel = levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length);
        let maxRadius = Math.min(w, h) / 2 - 2;
        let cx = w / 2;
        let cy = h / 2;

        // Mehrere Ringe
        for (let ring = 2; ring >= 0; ring--) {
            let scale = 0.3 + avgLevel * 0.7 - ring * 0.15;
            if (scale < 0.1) scale = 0.1;
            let radius = Math.max(1, maxRadius * scale);
            let alpha = (1 - ring * 0.3) * 0.7;

            let c = _lerpColor(leftColor, rightColor, ring / 2);
            cr.setSourceRGBA(c.r, c.g, c.b, c.a * alpha);
            cr.newPath();
            cr.arc(cx, cy, radius, 0, 2 * Math.PI);
            cr.fill();
        }
    }

    _drawCircle(cr, w, h, levels, leftColor, rightColor) {
        let cx = w / 2;
        let cy = h / 2;
        let baseRadius = Math.min(w, h) / 2 - 4;
        let count = Math.max(levels.length, 4);
        let useGradient = this._settings.bar_gradient;

        // Zeichne den Kreis als gefüllte Segmente statt Cairo-Gradient
        let segments = 90;
        let angleStep = (2 * Math.PI) / segments;

        cr.setLineWidth(2.5);

        for (let i = 0; i < segments; i++) {
            let angle0 = i * angleStep + this._phase;
            let angle1 = (i + 1) * angleStep + this._phase;
            let levelIdx = Math.floor((i / segments) * count) % count;
            let level = levels[levelIdx] || 0.05;
            let radius = Math.max(1, baseRadius * (0.6 + level * 0.4));

            let x0 = cx + Math.cos(angle0) * radius;
            let y0 = cy + Math.sin(angle0) * radius;
            let x1 = cx + Math.cos(angle1) * radius;
            let y1 = cy + Math.sin(angle1) * radius;

            let t = i / segments;
            let c = useGradient ? _lerpColor(leftColor, rightColor, t) : leftColor;
            cr.setSourceRGBA(c.r, c.g, c.b, c.a * 0.8);
            cr.moveTo(x0, y0);
            cr.lineTo(x1, y1);
            cr.stroke();
        }
    }

    _drawEqualizer(cr, w, h, levels, leftColor, rightColor) {
        let count = this._settings.bar_count;
        let gap = 2;
        let barWidth = (w - gap * (count - 1)) / count;
        if (barWidth < 2) barWidth = 2;
        let useGradient = this._settings.bar_gradient;

        for (let i = 0; i < count; i++) {
            let level = levels[i] || 0.05;

            // Segmentierte Balken
            let totalH = Math.max(4, level * h);
            let segH = 3;
            let segGap = 1;
            let segments = Math.max(1, Math.floor(totalH / (segH + segGap)));
            let x = i * (barWidth + gap);

            for (let s = 0; s < segments; s++) {
                let y = h - (s + 1) * (segH + segGap);
                let t = s / Math.max(1, segments - 1);
                let c;
                if (useGradient) {
                    c = _lerpColor(leftColor, rightColor, t);
                } else {
                    c = leftColor;
                }
                cr.setSourceRGBA(c.r, c.g, c.b, c.a * (0.6 + t * 0.4));
                cr.rectangle(x, y, barWidth, segH);
                cr.fill();
            }
        }
    }
});

// ─── Recording Pill (Overlay-Widget) ───

const RecordingPill = GObject.registerClass(
class RecordingPill extends St.Widget {
    _init(settings) {
        super._init({
            reactive: false,
            visible: false,
        });
        this._settings = settings;
        this._animationId = null;
        this._simLevels = [];

        this._buildUI();
    }

    _buildUI() {
        let s = this._settings;

        // Container Box
        this._box = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Style berechnen
        this._applyStyle();

        // Icon
        this._pillIcon = new St.Icon({
            icon_size: Math.max(16, s.pill_height - 16),
            style: `color: ${s.icon_color}; margin-right: 8px;`,
        });

        if (s.custom_icon_path && s.icon_name === 'custom') {
            try {
                let gicon = Gio.FileIcon.new(Gio.File.new_for_path(s.custom_icon_path));
                this._pillIcon.set_gicon(gicon);
            } catch (e) {
                this._pillIcon.icon_name = 'audio-input-microphone-symbolic';
            }
        } else {
            this._pillIcon.icon_name = s.icon_name || 'audio-input-microphone-symbolic';
        }

        this._box.add_child(this._pillIcon);

        // Visualisierung
        this._canvas = new VisualizationCanvas(s);
        this._box.add_child(this._canvas);

        this.add_child(this._box);
    }

    _applyStyle() {
        let s = this._settings;

        let style = `
            width: ${s.pill_width}px;
            height: ${s.pill_height}px;
            border-radius: ${s.pill_border_radius}px;
            background-color: ${s.pill_bg_color};
            border: ${s.pill_border_width}px solid ${s.pill_border_color};
            padding: 4px 12px;
        `;

        if (s.pill_shadow_intensity > 0) {
            // St verwendet -st-shadow statt box-shadow (CSS-Subset)
            // Format: x-offset y-offset blur spread color
            let shadowAlpha = s.pill_shadow_intensity;
            style += `-st-shadow: 0px 4px 12px 0px rgba(0,0,0,${shadowAlpha});`;
        }

        this._box.set_style(style);
    }

    _applySystemTheme() {
        if (!this._settings.follow_system_theme) return;

        // Prüfe ob GNOME dark mode aktiv ist (Settings-Objekt cachen)
        if (!this._interfaceSettings)
            this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        let colorScheme = this._interfaceSettings.get_string('color-scheme');
        let isDark = colorScheme === 'prefer-dark';

        if (isDark) {
            this._settings.pill_bg_color = 'rgba(0,0,0,0.80)';
            this._settings.pill_border_color = 'rgba(255,255,255,0.12)';
            this._settings.icon_color = '#ffffff';
        } else {
            this._settings.pill_bg_color = 'rgba(255,255,255,0.85)';
            this._settings.pill_border_color = 'rgba(0,0,0,0.12)';
            this._settings.icon_color = '#1e1e1e';
        }
        this._applyStyle();
        this._pillIcon.set_style(`color: ${this._settings.icon_color}; margin-right: 8px;`);
    }

    updatePosition() {
        let s = this._settings;
        let monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        let x, y;
        let pos = s.pill_position || 'top-center';

        switch (pos) {
        case 'top-left':
            x = s.pill_margin_horizontal;
            y = s.pill_margin_top;
            break;
        case 'top-right':
            x = monitor.width - s.pill_width - s.pill_margin_horizontal;
            y = s.pill_margin_top;
            break;
        case 'bottom-center':
            x = (monitor.width - s.pill_width) / 2 + s.pill_margin_horizontal;
            y = monitor.height - s.pill_height - s.pill_margin_top;
            break;
        case 'bottom-left':
            x = s.pill_margin_horizontal;
            y = monitor.height - s.pill_height - s.pill_margin_top;
            break;
        case 'bottom-right':
            x = monitor.width - s.pill_width - s.pill_margin_horizontal;
            y = monitor.height - s.pill_height - s.pill_margin_top;
            break;
        default: // top-center
            x = (monitor.width - s.pill_width) / 2 + s.pill_margin_horizontal;
            y = s.pill_margin_top;
            break;
        }

        this.set_position(Math.round(x), Math.round(y));
        this.set_size(s.pill_width, s.pill_height);
    }

    show() {
        this._applySystemTheme();
        this.updatePosition();
        super.show();
        this._startAnimation();
    }

    hide() {
        this._stopAnimation();
        super.hide();
    }

    setProcessing() {
        let s = this._settings;
        this._pillIcon.set_style(`color: ${s.processing_color}; margin-right: 8px;`);
        if (s.icon_name === 'custom' && s.custom_icon_path) {
            // Keep custom icon
        } else {
            this._pillIcon.icon_name = 'emblem-synchronizing-symbolic';
        }
        // Animation stoppen — es wird kein Audio mehr aufgenommen
        this._stopAnimation();
        this._canvas.setLevels(new Array(s.bar_count).fill(0.05));
    }

    setRecording() {
        let s = this._settings;
        this._pillIcon.set_style(`color: ${s.recording_color}; margin-right: 8px;`);
        if (s.icon_name === 'custom' && s.custom_icon_path) {
            // Keep custom icon
        } else {
            this._pillIcon.icon_name = s.icon_name || 'audio-input-microphone-symbolic';
        }
    }

    setRealLevels(levels) {
        // Echte Audio-Levels vom Backend empfangen
        this._hasRealLevels = true;
        this._lastRealLevelTime = GLib.get_monotonic_time();

        // Resample auf bar_count wenn nötig
        let count = this._settings.bar_count;
        let resampled;
        if (levels.length === count) {
            resampled = levels;
        } else {
            resampled = new Array(count);
            for (let i = 0; i < count; i++) {
                let srcIdx = (i / count) * levels.length;
                let lo = Math.floor(srcIdx);
                let hi = Math.min(lo + 1, levels.length - 1);
                let frac = srcIdx - lo;
                resampled[i] = (levels[lo] || 0) * (1 - frac) + (levels[hi] || 0) * frac;
            }
        }

        // Smoothing
        if (this._prevLevels && this._prevLevels.length === count) {
            for (let i = 0; i < count; i++)
                resampled[i] = this._prevLevels[i] * 0.25 + resampled[i] * 0.75;
        }
        this._prevLevels = [...resampled];
        this._canvas.setLevels(resampled);
    }

    _startAnimation() {
        if (this._animationId) return;
        this._hasRealLevels = false;

        this._animationId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            // Wenn echte Levels vom Backend kommen, nichts simulieren
            if (this._hasRealLevels) {
                // Prüfe ob Levels noch frisch sind (< 500ms alt)
                let now = GLib.get_monotonic_time();
                if (now - (this._lastRealLevelTime || 0) < 500000)
                    return GLib.SOURCE_CONTINUE;
                // Fallback auf Simulation wenn Backend keine Levels mehr sendet
                this._hasRealLevels = false;
            }

            // Fallback: simulierte Levels (z.B. wenn Backend-Version zu alt)
            let count = this._settings.bar_count;
            this._simLevels = Array.from({length: count}, () =>
                0.1 + Math.random() * 0.8
            );

            if (this._prevLevels && this._prevLevels.length === count) {
                for (let i = 0; i < count; i++)
                    this._simLevels[i] = this._prevLevels[i] * 0.3 + this._simLevels[i] * 0.7;
            }
            this._prevLevels = [...this._simLevels];
            this._canvas.setLevels(this._simLevels);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopAnimation() {
        if (this._animationId) {
            GLib.source_remove(this._animationId);
            this._animationId = null;
        }
    }

    destroy() {
        this._stopAnimation();
        super.destroy();
    }
});


// ─── Panel Indicator ───

const DictateIndicator = GObject.registerClass(
class DictateIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'JT Dictate', false);

        this._extension = extension;
        this._isRecording = false;
        this._proxy = null;
        this._proxyReady = false;
        this._statusCheckId = null;
        this._reconnectIds = [];
        this._destroyed = false;
        this._backendStarting = false;
        this._toggleInFlight = false;
        this._settings = Object.assign({}, DEFAULT_SETTINGS);

        // Icon
        this._icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // Menü (für Rechtsklick)
        this._buildMenu();

        // Recording Pill erstellen (wird erst bei Aufnahme sichtbar)
        this._pill = null;

        // D-Bus Proxy erstellen
        this._connectProxy();

        // Status regelmäßig prüfen
        this._startStatusCheck();
    }

    _loadSettingsSync() {
        try {
            let file = Gio.File.new_for_path(CONFIG_FILE);
            let [success, contents] = file.load_contents(null);
            if (success) {
                let saved = JSON.parse(new TextDecoder().decode(contents));
                this._settings = Object.assign({}, DEFAULT_SETTINGS, saved);
            }
        } catch (e) {
            this._settings = Object.assign({}, DEFAULT_SETTINGS);
        }
    }

    _ensurePill() {
        // Settings neu laden für aktuelle Werte
        this._loadSettingsSync();

        if (this._pill) {
            try { Main.layoutManager.removeChrome(this._pill); } catch (e) { /* already removed */ }
            this._pill.destroy();
            this._pill = null;
        }

        this._pill = new RecordingPill(this._settings);
        Main.layoutManager.addTopChrome(this._pill);
    }

    _connectProxy() {
        if (this._destroyed) return;

        // Alten Signal-Handler aufräumen
        if (this._signalId && this._proxy) {
            this._proxy.disconnect(this._signalId);
            this._signalId = null;
        }

        this._proxyReady = false;
        this._proxy = null;

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

                        // D-Bus Signals empfangen
                        this._signalId = this._proxy.connect('g-signal', (p, sender, signalName, params) => {
                            if (this._destroyed) return;
                            if (signalName === 'AudioLevels' && this._pill) {
                                let levelsVariant = params.get_child_value(0);
                                let levels = [];
                                let n = levelsVariant.n_children();
                                for (let i = 0; i < n; i++)
                                    levels.push(levelsVariant.get_child_value(i).get_double());
                                this._pill.setRealLevels(levels);
                            } else if (signalName === 'ModelProgress') {
                                let message = params.get_child_value(0).unpack();
                                let progress = params.get_child_value(1).get_double();
                                this._setLoadingState(message, progress);
                            }
                        });
                    }
                } catch (e) {
                    // Proxy-Erstellung fehlgeschlagen
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

        // Auto-Clipboard
        this._autoClipboardItem = new PopupMenu.PopupSwitchMenuItem('Automatisch in Zwischenablage', true);
        this._autoClipboardItem.connect('toggled', (item) => {
            this._setSetting('auto_clipboard', item.state);
        });
        settingsMenu.menu.addMenuItem(this._autoClipboardItem);

        settingsMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Modell-Auswahl
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

        settingsMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Einstellungen öffnen
        let prefsItem = new PopupMenu.PopupMenuItem('Alle Einstellungen...');
        prefsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        settingsMenu.menu.addMenuItem(prefsItem);

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
        let file = Gio.File.new_for_path(CONFIG_FILE);

        file.load_contents_async(null, (f, res) => {
            if (this._destroyed) return;
            try {
                let [success, contents] = f.load_contents_finish(res);
                if (success) {
                    let settings = JSON.parse(new TextDecoder().decode(contents));
                    this._settings = Object.assign({}, DEFAULT_SETTINGS, settings);
                    this._autoClipboardItem.setToggleState(this._settings.auto_clipboard ?? true);
                    this._markModel(this._settings.model ?? 'base');
                }
            } catch (e) {
                // Datei existiert nicht oder ist ungültig — defaults beibehalten
            }
        });
    }

    _setSetting(key, value) {
        if (!this._settingsCache) this._settingsCache = {};
        this._settingsCache[key] = value;

        let configDir = CONFIG_DIR;
        let configPath = CONFIG_FILE;
        let file = Gio.File.new_for_path(configPath);

        GLib.mkdir_with_parents(configDir, 0o755);

        file.load_contents_async(null, (f, res) => {
            if (this._destroyed) return;
            let settings = {};
            try {
                let [success, contents] = f.load_contents_finish(res);
                if (success)
                    settings = JSON.parse(new TextDecoder().decode(contents));
            } catch (e) {
                // File doesn't exist yet, start fresh
            }

            Object.assign(settings, this._settingsCache);

            let bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(settings, null, 2)));
            file.replace_contents_bytes_async(
                bytes, null, false, Gio.FileCreateFlags.NONE, null,
                (f2, res2) => {
                    if (this._destroyed) return;
                    try {
                        f2.replace_contents_finish(res2);
                    } catch (e) {
                        console.error(`JT Dictate: Error saving setting: ${e}`);
                    }
                }
            );
        });
    }

    _setModel(model) {
        this._setSetting('model', model);
        this._markModel(model);
        _notify('JT Dictate', `Modell '${model}' wird beim nächsten Start geladen`);
    }

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
        if (this._backendStarting) return;
        this._backendStarting = true;

        this._isBackendOnBus((onBus) => {
            if (this._destroyed) return;

            if (onBus) {
                this._backendStarting = false;
                this._connectProxy();
                return;
            }

            try {
                GLib.spawn_command_line_async('nice -n 10 jt-dictate');
                _notify('JT Dictate', 'Backend wird gestartet...');

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
                            _notify('JT Dictate', 'Backend konnte nicht gestartet werden.');
                        }
                    });
                    return GLib.SOURCE_REMOVE;
                };

                let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, tryConnect);
                this._reconnectIds.push(id);
            } catch (e) {
                this._backendStarting = false;
                _notify('JT Dictate', `Fehler beim Starten: ${e.message}`);
            }
        });
    }

    _toggle() {
        if (this._toggleInFlight) return;

        if (!this._proxyReady) {
            _notify('JT Dictate', 'Backend nicht erreichbar. Starte Backend...');
            this._startBackend();
            return;
        }

        this._toggleInFlight = true;

        // Optimistic UI Update
        if (this._isRecording) {
            this._setProcessingState();
        } else {
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
                    this._setRecordingState(false);
                    _notify('JT Dictate', 'Backend nicht erreichbar. Starte Backend...');
                    this._proxyReady = false;
                    this._proxy = null;
                    this._startBackend();
                }
            }
        );
    }

    _updateStatus() {
        if (this._destroyed) return;
        if (this._toggleInFlight) return;

        if (!this._proxyReady) {
            this._setRecordingState(false);
            if (this._backendStarting) {
                this._statusItem.label.text = 'Backend startet...';
            } else {
                this._statusItem.label.text = 'Backend nicht gestartet';
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
                    let status = reply.get_child_value(0).unpack();

                    if (status === 'loading') {
                        this._setLoadingState('Modell wird geladen...', -1);
                    } else if (status === 'recording') {
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

        // Panel-Icon State-Klassen
        this._icon.remove_style_class_name('recording');
        this._icon.remove_style_class_name('processing');

        if (recording) {
            this._icon.icon_name = 'media-record-symbolic';
            this._icon.add_style_class_name('recording');
            this._toggleItem.label.text = 'Aufnahme stoppen';
            this._statusItem.label.text = 'Aufnahme läuft...';

            // Pill anzeigen (nur erstellen wenn noch nicht vorhanden)
            if (!this._pill) {
                this._ensurePill();
            }
            if (this._pill) {
                this._pill.setRecording();
                if (!this._pill.visible)
                    this._pill.show();
            }
        } else {
            this._icon.icon_name = 'audio-input-microphone-symbolic';
            this._toggleItem.label.text = 'Aufnahme starten';
            this._statusItem.label.text = 'Bereit';

            // Pill zerstören (nächstes Recording erstellt neue mit aktuellen Settings)
            if (this._pill) {
                this._pill.hide();
                try { Main.layoutManager.removeChrome(this._pill); } catch (e) { /* already removed */ }
                this._pill.destroy();
                this._pill = null;
            }
        }
    }

    _setProcessingState() {
        if (this._destroyed) return;

        this._isRecording = false;

        this._icon.remove_style_class_name('recording');
        this._icon.add_style_class_name('processing');
        this._icon.icon_name = 'emblem-synchronizing-symbolic';
        this._toggleItem.label.text = 'Verarbeitung läuft...';
        this._statusItem.label.text = 'Text wird verarbeitet...';

        // Pill in Processing-Modus (erstellen falls noch nicht vorhanden)
        if (!this._pill) {
            this._ensurePill();
        }
        if (this._pill) {
            this._pill.setProcessing();
            if (!this._pill.visible)
                this._pill.show();
        }
    }

    _setLoadingState(message, progress) {
        if (this._destroyed) return;

        this._isRecording = false;

        this._icon.remove_style_class_name('recording');
        this._icon.add_style_class_name('processing');
        this._icon.icon_name = 'emblem-synchronizing-symbolic';

        // Fortschrittsanzeige im Menü
        let progressText;
        if (progress >= 1.0) {
            // Modell fertig geladen — Status wird beim nächsten Poll aktualisiert
            progressText = 'Modell geladen!';
        } else if (progress >= 0) {
            let pct = Math.round(progress * 100);
            progressText = `${message} (${pct}%)`;
        } else {
            progressText = message;
        }

        this._statusItem.label.text = progressText;
        this._toggleItem.label.text = 'Modell wird geladen...';
    }

    _startStatusCheck() {
        this._statusCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this._destroyed) return GLib.SOURCE_REMOVE;
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

    // Linksklick = Aufnahme toggle, Rechtsklick = Menü toggle
    vfunc_event(event) {
        let type = event.type();

        if (type === Clutter.EventType.TOUCH_BEGIN ||
            type === Clutter.EventType.BUTTON_PRESS) {

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

                // Mittlere Maustaste etc. durchlassen
                return Clutter.EVENT_PROPAGATE;
            }

            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        this._destroyed = true;
        this._stopStatusCheck();
        if (this._signalId && this._proxy) {
            this._proxy.disconnect(this._signalId);
            this._signalId = null;
        }
        if (this._pill) {
            try { Main.layoutManager.removeChrome(this._pill); } catch (e) { /* already removed */ }
            this._pill.destroy();
            this._pill = null;
        }
        super.destroy();
    }
});

export default class JtDictateExtension extends Extension {
    enable() {
        this._indicator = new DictateIndicator(this);
        Main.panel.addToStatusArea('jt-dictate', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
