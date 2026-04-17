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

// D-Bus Call Timeout in ms
const DBUS_TIMEOUT_MS = 2000;

// Persistente NotificationSource
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

function _notify(title, body) {
    try {
        if (Main.notify) {
            Main.notify(title, body);
            return;
        }

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
    pill_bg_color: 'rgba(15,15,25,0.82)',
    pill_border_color: 'rgba(255,255,255,0.12)',
    pill_border_width: 1,
    pill_blur: 12,
    pill_shadow_intensity: 0.4,
    pill_margin_top: 60,
    pill_margin_horizontal: 0,
    pill_position: 'bottom-center',
    visualization_type: 'bars',
    bar_color_left: '#6c9ff8',
    bar_color_right: '#f06292',
    bar_gradient: true,
    bar_count: 15,
    icon_name: 'audio-input-microphone-symbolic',
    icon_color: '#e8eaed',
    custom_icon_path: '',
    recording_color: '#ef5350',
    processing_color: '#ffa726',
    spinner_color: '#ffa726',
    checkmark_color: '#66bb6a',
    pill_animation: 'minimal',
    active_theme: 'default',
    follow_system_theme: false,
    sound_enabled: true,
    sound_start_volume: 0.5,
    sound_stop_volume: 0.5,
    sound_finish_volume: 0.7,
    sound_start: 'click',
    sound_stop: 'click',
    sound_finish: 'gentle-ping',
    notifications_enabled: false,
    processing_position: 'bottom-right',
    processing_margin_bottom: 28,
    processing_margin_horizontal: 28,
    processing_size: 44,
    pill_display_monitor: 'active',
    checkmark_effect: 'fade',
};

// --- Hilfsfunktionen ---

function _parseColorComponents(colorStr) {
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

// --- Audio-Visualisierungs-Canvas ---

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
        if (!levels.length) levels = new Array(s.bar_count).fill(0);

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
            let rawLevel = levels[i] || 0;
            // Mitte stärker ausschlagen: Gauss-Gewichtung um die Mitte
            let center = (count - 1) / 2;
            let dist = Math.abs(i - center) / center; // 0 = Mitte, 1 = Rand
            let centerWeight = 1.0 - dist * 0.6; // Mitte 1.0, Rand 0.4
            let level = rawLevel * centerWeight;
            let barH = Math.max(2, level * h);
            let x = i * (barWidth + gap);
            let y = (h - barH) / 2;

            let c = useGradient ? _lerpColor(leftColor, rightColor, i / Math.max(1, count - 1)) : leftColor;
            cr.setSourceRGBA(c.r, c.g, c.b, c.a * 0.9);

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

        cr.setLineWidth(2.5);

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

// --- Spinner Canvas (drehender Kreis fuer Processing) ---

const SpinnerCanvas = GObject.registerClass(
class SpinnerCanvas extends St.DrawingArea {
    _init(size, color) {
        super._init({
            width: size,
            height: size,
        });
        this._size = size;
        this._color = _parseColorComponents(color || '#ffffff');
        this._angle = 0;
        this._spinId = null;

        this.connect('repaint', (area) => this._draw(area));
    }

    startSpinning() {
        if (this._spinId) return;
        this._spinId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            this._angle += 0.12;
            this.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopSpinning() {
        if (this._spinId) {
            GLib.source_remove(this._spinId);
            this._spinId = null;
        }
    }

    _draw(area) {
        let cr = area.get_context();
        let s = this._size;
        let cx = s / 2;
        let cy = s / 2;
        let radius = s / 2 - 3;
        let lineWidth = 2.5;
        let c = this._color;

        cr.setLineWidth(lineWidth);
        cr.setLineCap(1); // ROUND

        // Hintergrund-Ring (schwach)
        cr.setSourceRGBA(c.r, c.g, c.b, 0.15);
        cr.arc(cx, cy, radius, 0, 2 * Math.PI);
        cr.stroke();

        // Drehender Bogen (3/4 Kreis)
        cr.setSourceRGBA(c.r, c.g, c.b, 0.9);
        cr.arc(cx, cy, radius, this._angle, this._angle + 1.5 * Math.PI);
        cr.stroke();

        cr.$dispose();
    }

    destroy() {
        this.stopSpinning();
        super.destroy();
    }
});

// --- Checkmark Canvas ---

const CheckmarkCanvas = GObject.registerClass(
class CheckmarkCanvas extends St.DrawingArea {
    _init(size, color) {
        super._init({
            width: size,
            height: size,
        });
        this._size = size;
        this._color = _parseColorComponents(color || '#4ade80');

        this.connect('repaint', (area) => this._draw(area));
    }

    _draw(area) {
        let cr = area.get_context();
        let s = this._size;
        let c = this._color;

        cr.setLineWidth(2.5);
        cr.setLineCap(1); // ROUND
        cr.setLineJoin(1); // ROUND
        cr.setSourceRGBA(c.r, c.g, c.b, 0.9);

        // Haekchen zeichnen
        let pad = s * 0.25;
        cr.moveTo(pad, s * 0.5);
        cr.lineTo(s * 0.4, s - pad);
        cr.lineTo(s - pad, pad);
        cr.stroke();

        cr.$dispose();
    }
});

// --- Recording Pill (Overlay-Widget) ---

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
        this._processingAnimIds = [];
        this._isAnimatingToProcessing = false;

        this._buildUI();
    }

    _buildUI() {
        let s = this._settings;

        // Container Box
        this._box = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
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
        } else if (s.icon_name === 'janeway') {
            try {
                let iconPath = this._findJanewayIcon();
                if (iconPath) {
                    let gicon = Gio.FileIcon.new(Gio.File.new_for_path(iconPath));
                    this._pillIcon.set_gicon(gicon);
                } else {
                    this._pillIcon.icon_name = 'audio-input-microphone-symbolic';
                }
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

    _findJanewayIcon() {
        let candidates = [
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'gnome-shell', 'extensions', 'jt-dictate@jt.tools', 'icons', 'janeway-symbolic.svg']),
            GLib.build_filenamev(['/usr', 'share', 'gnome-shell', 'extensions', 'jt-dictate@jt.tools', 'icons', 'janeway-symbolic.svg']),
        ];
        for (let path of candidates) {
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                return path;
        }
        return null;
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
            let shadowAlpha = s.pill_shadow_intensity;
            style += `-st-shadow: 0px 4px 12px 0px rgba(0,0,0,${shadowAlpha});`;
        }

        this._box.set_style(style);
    }

    _applySystemTheme() {
        if (!this._settings.follow_system_theme) return;

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

    _getActiveMonitor() {
        let s = this._settings;
        if (s.pill_display_monitor === 'primary') {
            return Main.layoutManager.primaryMonitor;
        }
        // 'active': Monitor unter der Maus
        let [mouseX, mouseY, _mods] = global.get_pointer();
        let monitors = Main.layoutManager.monitors;
        for (let m of monitors) {
            if (mouseX >= m.x && mouseX < m.x + m.width &&
                mouseY >= m.y && mouseY < m.y + m.height) {
                return m;
            }
        }
        return Main.layoutManager.primaryMonitor;
    }

    _getMonitorForPosition(px, py) {
        // Ermittelt den Monitor anhand einer gegebenen Position (z.B. aktuelle Pill-Position)
        let monitors = Main.layoutManager.monitors;
        for (let m of monitors) {
            if (px >= m.x && px < m.x + m.width &&
                py >= m.y && py < m.y + m.height) {
                return m;
            }
        }
        return Main.layoutManager.primaryMonitor;
    }

    _getPositionForState(state, overrideMonitor) {
        let s = this._settings;
        let monitor = overrideMonitor || this._getActiveMonitor();
        if (!monitor) return {x: 0, y: 0};

        let mx = monitor.x;
        let my = monitor.y;

        if (state === 'processing') {
            let size = s.processing_size || 44;
            let pos = s.processing_position || 'bottom-right';
            let mb = s.processing_margin_bottom || 28;
            let mh = s.processing_margin_horizontal || 28;
            let x, y;
            switch (pos) {
            case 'bottom-right':
                x = mx + monitor.width - size - mh;
                y = my + monitor.height - size - mb;
                break;
            case 'bottom-left':
                x = mx + mh;
                y = my + monitor.height - size - mb;
                break;
            case 'bottom-center':
                x = mx + (monitor.width - size) / 2;
                y = my + monitor.height - size - mb;
                break;
            case 'top-right':
                x = mx + monitor.width - size - mh;
                y = my + mb + 32;
                break;
            case 'top-left':
                x = mx + mh;
                y = my + mb + 32;
                break;
            case 'top-center':
                x = mx + (monitor.width - size) / 2;
                y = my + mb + 32;
                break;
            default:
                x = mx + monitor.width - size - mh;
                y = my + monitor.height - size - mb;
                break;
            }
            return {x: Math.round(x), y: Math.round(y)};
        }

        // Normal position (recording)
        let x, y;
        let pos = s.pill_position || 'bottom-center';

        switch (pos) {
        case 'top-left':
            x = mx + s.pill_margin_horizontal;
            y = my + s.pill_margin_top;
            break;
        case 'top-right':
            x = mx + monitor.width - s.pill_width - s.pill_margin_horizontal;
            y = my + s.pill_margin_top;
            break;
        case 'bottom-center':
            x = mx + (monitor.width - s.pill_width) / 2 + s.pill_margin_horizontal;
            y = my + monitor.height - s.pill_height - s.pill_margin_top;
            break;
        case 'bottom-left':
            x = mx + s.pill_margin_horizontal;
            y = my + monitor.height - s.pill_height - s.pill_margin_top;
            break;
        case 'bottom-right':
            x = mx + monitor.width - s.pill_width - s.pill_margin_horizontal;
            y = my + monitor.height - s.pill_height - s.pill_margin_top;
            break;
        default: // top-center
            x = mx + (monitor.width - s.pill_width) / 2 + s.pill_margin_horizontal;
            y = my + s.pill_margin_top;
            break;
        }

        return {x: Math.round(x), y: Math.round(y)};
    }

    updatePosition() {
        let s = this._settings;
        let pos = this._getPositionForState('recording');
        this.set_position(pos.x, pos.y);
        this.set_size(s.pill_width, s.pill_height);
    }

    // --- Easing-Funktionen (identisch zur Simulation) ---
    _easeInOutCubic(t) {
        return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;
    }

    // Manueller Frame-Loop (wie requestAnimationFrame in der Simulation)
    _animateFrames(durationMs, onFrame, onDone) {
        let startTime = GLib.get_monotonic_time() / 1000; // ms
        let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            let now = GLib.get_monotonic_time() / 1000;
            let t = Math.min(1, (now - startTime) / durationMs);
            onFrame(t);
            if (t >= 1) {
                if (onDone) onDone();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._processingAnimIds.push(id);
        return id;
    }

    show() {
        this._applySystemTheme();
        this.updatePosition();
        this.opacity = 0;
        super.show();

        let anim = this._settings.pill_animation || 'minimal';

        if (anim === 'smooth') {
            // Scale 0.85→1.0 + fade (identisch zur Simulation)
            this.set_pivot_point(0.5, 0.5);
            this.set_scale(0.85, 0.85);
            this._animateFrames(300, (t) => {
                let et = 1 - Math.pow(1 - t, 2); // easeOutQuad
                this.opacity = Math.round(et * 255);
                let sc = 0.85 + 0.15 * et;
                this.set_scale(sc, sc);
            }, () => {
                this.set_scale(1, 1);
                this.opacity = 255;
            });
        } else if (anim === 'bounce') {
            // Snap in von unten — 4-Phasen identisch zur Simulation
            let pos = this._getPositionForState('recording');
            let startY = pos.y + 100;
            this.set_position(pos.x, startY);
            this.opacity = 255;
            this.set_pivot_point(0.5, 0.5);
            this.set_scale(0.9, 0.9);

            this._animateFrames(350, (t) => {
                let cy, sc;
                if (t < 0.4) {
                    let s = t / 0.4;
                    let e = 1 - Math.pow(1 - s, 3);
                    cy = startY + ((pos.y - 18) - startY) * e;
                    sc = 0.9 + 0.15 * e;
                } else if (t < 0.65) {
                    let s = (t - 0.4) / 0.25;
                    cy = (pos.y - 18) + (18 + 6) * s;
                    sc = 1.05 - 0.05 * s;
                } else if (t < 0.85) {
                    let s = (t - 0.65) / 0.2;
                    cy = (pos.y + 6) - (6 + 3) * s;
                    sc = 1.0 + 0.02 * Math.sin(s * Math.PI);
                } else {
                    let s = (t - 0.85) / 0.15;
                    cy = (pos.y - 3) + 3 * s;
                    sc = 1.0;
                }
                this.set_position(pos.x, Math.round(cy));
                this.set_scale(sc, sc);
            }, () => {
                this.set_position(pos.x, pos.y);
                this.set_scale(1, 1);
            });
        } else {
            // Minimal: einfaches Fade
            this._animateFrames(300, (t) => {
                this.opacity = Math.round(t * 255);
            }, () => {
                this.opacity = 255;
            });
        }

        this._startAnimation();
    }

    hide() {
        this._stopAnimation();
        this._cleanupProcessingWidgets();
        super.hide();
    }

    setProcessing() {
        if (this._isAnimatingToProcessing) return;
        this._isAnimatingToProcessing = true;

        let s = this._settings;
        let anim = s.pill_animation || 'minimal';
        let circleSize = s.processing_size || 44;
        // Monitor anhand der aktuellen Pill-Position ermitteln, nicht Mausposition
        let currentMonitor = this._getMonitorForPosition(this.x, this.y);
        let targetPos = this._getPositionForState('processing', currentMonitor);

        this._stopAnimation();
        // Alle laufenden Animationen (z.B. show-Fade) stoppen,
        // damit sie nicht mit der Morph-Animation kollidieren
        this._cancelRunningAnimations();

        // Spinner vorbereiten (wird während Morph eingeblendet)
        let spinSize = Math.max(16, circleSize - 12);
        this._spinner = new SpinnerCanvas(spinSize, s.spinner_color || s.processing_color || '#ffa726');
        this._spinner.opacity = 0;
        this._spinner.set_x_align(Clutter.ActorAlign.CENTER);
        this._spinner.set_y_align(Clutter.ActorAlign.CENTER);
        this._spinner.set_x_expand(true);
        this._spinner.set_y_expand(true);

        // Start-Werte
        let startX = this.x;
        let startY = this.y;
        let startW = s.pill_width;
        let startH = s.pill_height;
        let startBR = s.pill_border_radius;
        let endBR = circleSize / 2;

        if (anim === 'smooth') {
            // Alles in einem Loop: Icon/Viz fade + Morph + Slide + Spinner fade-in
            let morphDur = 700;
            let spinnerAdded = false;

            this._animateFrames(morphDur, (t) => {
                let et = this._easeInOutCubic(t);

                // Position + Groesse morphen
                let cx = startX + (targetPos.x - startX) * et;
                let cy = startY + (targetPos.y - startY) * et;
                let cw = startW + (circleSize - startW) * et;
                let ch = startH + (circleSize - startH) * et;
                let cbr = startBR + (endBR - startBR) * et;

                this.set_position(Math.round(cx), Math.round(cy));
                this.set_size(Math.round(cw), Math.round(ch));

                let style = `width:${Math.round(cw)}px;height:${Math.round(ch)}px;border-radius:${Math.round(cbr)}px;background-color:${s.pill_bg_color};border:${s.pill_border_width}px solid ${s.pill_border_color};padding:0px;`;
                if (s.pill_shadow_intensity > 0)
                    style += `-st-shadow:0px 4px 12px 0px rgba(0,0,0,${s.pill_shadow_intensity});`;
                this._box.set_style(style);

                // Icon/Viz: fade in ersten 35%
                let iconOp = Math.max(0, 1 - t / 0.35);
                this._pillIcon.opacity = Math.round(iconOp * 255);
                this._canvas.opacity = Math.round(iconOp * 255);
                if (t >= 0.35) {
                    this._pillIcon.visible = false;
                    this._canvas.visible = false;
                }

                // Spinner: einblenden ab 25%
                if (t >= 0.2 && !spinnerAdded) {
                    this._box.add_child(this._spinner);
                    this._spinner.startSpinning();
                    spinnerAdded = true;
                }
                if (spinnerAdded) {
                    let spinOp = Math.max(0, Math.min(1, (t - 0.25) / 0.35));
                    this._spinner.opacity = Math.round(spinOp * 255);
                }
            }, () => {
                if (!spinnerAdded) {
                    this._box.add_child(this._spinner);
                    this._spinner.startSpinning();
                }
                this._spinner.opacity = 255;
            });

        } else if (anim === 'bounce') {
            // Bounce: alles in einem Loop mit front-loaded size morph
            let morphDur = 650;
            let spinnerAdded = false;

            // Size-Easing: aggressiv front-loaded
            const sizeEase = (t) => {
                let s2 = Math.min(1, t / 0.35);
                return 1 - Math.pow(1 - s2, 5);
            };
            // Position: easeOutQuart, kein Overshoot
            const posEase = (t) => 1 - Math.pow(1 - t, 4);

            // Clamp position zum aktuellen Monitor
            let maxX = currentMonitor ? currentMonitor.x + currentMonitor.width - circleSize - 8 : targetPos.x;
            let maxY = currentMonitor ? currentMonitor.y + currentMonitor.height - circleSize - 8 : targetPos.y;
            let endX = Math.min(targetPos.x, maxX);
            let endY = Math.min(targetPos.y, maxY);

            this._animateFrames(morphDur, (t) => {
                let st = sizeEase(t);
                let pt = posEase(t);

                let cw = startW + (circleSize - startW) * st;
                let ch = startH + (circleSize - startH) * st;
                let cbr = startBR + (endBR - startBR) * st;

                this.set_position(
                    Math.round(startX + (endX - startX) * pt),
                    Math.round(startY + (endY - startY) * pt)
                );
                this.set_size(Math.round(cw), Math.round(ch));

                let style = `width:${Math.round(cw)}px;height:${Math.round(ch)}px;border-radius:${Math.round(cbr)}px;background-color:${s.pill_bg_color};border:${s.pill_border_width}px solid ${s.pill_border_color};padding:0px;`;
                if (s.pill_shadow_intensity > 0)
                    style += `-st-shadow:0px 4px 12px 0px rgba(0,0,0,${s.pill_shadow_intensity});`;
                this._box.set_style(style);

                // Icon/Viz: fade in ersten 25%
                let iconOp = Math.max(0, 1 - t / 0.25);
                this._pillIcon.opacity = Math.round(iconOp * 255);
                this._canvas.opacity = Math.round(iconOp * 255);
                if (t >= 0.25) {
                    this._pillIcon.visible = false;
                    this._canvas.visible = false;
                }

                // Spinner ab 15%
                if (t >= 0.15 && !spinnerAdded) {
                    this._box.add_child(this._spinner);
                    this._spinner.startSpinning();
                    spinnerAdded = true;
                }
                if (spinnerAdded) {
                    let spinOp = Math.max(0, Math.min(1, (t - 0.15) / 0.35));
                    this._spinner.opacity = Math.round(spinOp * 255);
                }

                // Subtle scale bounce am Ende
                if (t > 0.7) {
                    let bt = (t - 0.7) / 0.3;
                    let sc = 1 + 0.04 * Math.sin(bt * Math.PI * 2) * (1 - bt);
                    this.set_pivot_point(0.5, 0.5);
                    this.set_scale(sc, sc);
                }
            }, () => {
                this.set_scale(1, 1);
                if (!spinnerAdded) {
                    this._box.add_child(this._spinner);
                    this._spinner.startSpinning();
                }
                this._spinner.opacity = 255;
            });

        } else {
            // Minimal: In-place crossfade morph, kein Slide
            let origCenterX = startX + startW / 2;
            let origCenterY = startY + startH / 2;
            let morphDur = 500;
            let spinnerAdded = false;

            this._animateFrames(morphDur, (t) => {
                let et = this._easeInOutCubic(t);

                let cw = startW + (circleSize - startW) * et;
                let ch = startH + (circleSize - startH) * et;
                let cbr = startBR + (endBR - startBR) * et;

                this.set_position(
                    Math.round(origCenterX - cw / 2),
                    Math.round(origCenterY - ch / 2)
                );
                this.set_size(Math.round(cw), Math.round(ch));

                let style = `width:${Math.round(cw)}px;height:${Math.round(ch)}px;border-radius:${Math.round(cbr)}px;background-color:${s.pill_bg_color};border:${s.pill_border_width}px solid ${s.pill_border_color};padding:0px;`;
                if (s.pill_shadow_intensity > 0)
                    style += `-st-shadow:0px 4px 12px 0px rgba(0,0,0,${s.pill_shadow_intensity});`;
                this._box.set_style(style);

                // Icon/Viz fade
                this._pillIcon.opacity = Math.round(Math.max(0, 1 - et) * 255);
                this._canvas.opacity = Math.round(Math.max(0, 1 - et) * 255);
                if (et >= 0.5) {
                    this._pillIcon.visible = false;
                    this._canvas.visible = false;
                }

                // Spinner ab 40%
                if (t >= 0.4 && !spinnerAdded) {
                    this._box.add_child(this._spinner);
                    this._spinner.startSpinning();
                    spinnerAdded = true;
                }
                if (spinnerAdded) {
                    let spinOp = Math.max(0, Math.min(1, (t - 0.4) / 0.5));
                    this._spinner.opacity = Math.round(spinOp * 255);
                }
            }, () => {
                if (!spinnerAdded) {
                    this._box.add_child(this._spinner);
                    this._spinner.startSpinning();
                }
                this._spinner.opacity = 255;
            });
        }
    }

    setDone() {
        let s = this._settings;
        let anim = s.pill_animation || 'minimal';
        let circleSize = s.processing_size || 44;

        // Spinner→Haekchen Crossfade (identisch zur Simulation: in-place, scale 0.7→1.0)
        let checkSize = Math.max(16, circleSize - 12);
        this._checkmark = new CheckmarkCanvas(checkSize, s.checkmark_color || '#66bb6a');
        this._checkmark.opacity = 0;
        this._checkmark.set_x_align(Clutter.ActorAlign.CENTER);
        this._checkmark.set_y_align(Clutter.ActorAlign.CENTER);
        this._checkmark.set_x_expand(true);
        this._checkmark.set_y_expand(true);
        this._checkmark.set_pivot_point(0.5, 0.5);
        let useZoom = s.checkmark_effect === 'zoom';
        this._checkmark.set_scale(useZoom ? 0.0 : 1.0, useZoom ? 0.0 : 1.0);
        this._box.add_child(this._checkmark);
        this._checkmark.queue_repaint();

        // Crossfade: Spinner out + Checkmark in (300ms)
        this._animateFrames(300, (t) => {
            let et = this._easeInOutCubic(t);
            if (this._spinner)
                this._spinner.opacity = Math.round((1 - et) * 255);
            this._checkmark.opacity = Math.round(et * 255);
            if (useZoom) {
                this._checkmark.set_scale(et, et);
            }
        }, () => {
            if (this._spinner) {
                this._spinner.stopSpinning();
                try { this._box.remove_child(this._spinner); } catch (e) { /* */ }
                this._spinner.destroy();
                this._spinner = null;
            }
            this._checkmark.opacity = 255;
            if (useZoom) this._checkmark.set_scale(1, 1);

            // Exit-Animation nach 800ms (je nach Stil)
            let fadeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                if (anim === 'smooth') {
                    this.set_pivot_point(0.5, 0.5);
                    this._animateFrames(450, (t) => {
                        this.opacity = Math.round((1 - t) * 255);
                        let sc = 1.0 - 0.15 * t;
                        this.set_scale(sc, sc);
                    }, () => this._requestDestroy());
                } else if (anim === 'bounce') {
                    let startY = this.y;
                    this._animateFrames(500, (t) => {
                        let et = this._easeInOutCubic(t);
                        this.set_position(this.x, Math.round(startY + 60 * et));
                        this.opacity = Math.round((1 - et) * 255);
                    }, () => this._requestDestroy());
                } else {
                    this._animateFrames(400, (t) => {
                        this.opacity = Math.round((1 - t) * 255);
                    }, () => this._requestDestroy());
                }
                return GLib.SOURCE_REMOVE;
            });
            this._processingAnimIds.push(fadeId);
        });
    }

    _requestDestroy() {
        // Signal an den Indicator dass die Pill fertig ist
        if (this._onDoneCallback)
            this._onDoneCallback();
    }

    setOnDone(callback) {
        this._onDoneCallback = callback;
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
        this._hasRealLevels = true;
        this._lastRealLevelTime = GLib.get_monotonic_time();

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
        this._lastMonitorIdx = -1;

        this._animationId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            // Bei 'active' Monitor: Position aktualisieren wenn Maus den Bildschirm wechselt
            if (this._settings.pill_display_monitor === 'active' && !this._isAnimatingToProcessing) {
                let newMonitor = this._getActiveMonitor();
                let monIdx = newMonitor ? Main.layoutManager.monitors.indexOf(newMonitor) : -1;
                if (monIdx !== this._lastMonitorIdx) {
                    this._lastMonitorIdx = monIdx;
                    this.updatePosition();
                }
            }

            if (this._hasRealLevels) {
                let now = GLib.get_monotonic_time();
                if (now - (this._lastRealLevelTime || 0) < 500000)
                    return GLib.SOURCE_CONTINUE;
                this._hasRealLevels = false;
            }

            let count = this._settings.bar_count;
            // Idle: alle Balken auf Minimum, kein Ausschlag ohne Sprache
            this._simLevels = new Array(count).fill(0);

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

    _cancelRunningAnimations() {
        for (let id of this._processingAnimIds) {
            try { GLib.source_remove(id); } catch (e) { /* already fired */ }
        }
        this._processingAnimIds = [];
    }

    _cleanupProcessingWidgets() {
        this._cancelRunningAnimations();

        if (this._spinner) {
            this._spinner.stopSpinning();
            try { this._box.remove_child(this._spinner); } catch (e) { /* */ }
            this._spinner.destroy();
            this._spinner = null;
        }
        if (this._checkmark) {
            try { this._box.remove_child(this._checkmark); } catch (e) { /* */ }
            this._checkmark.destroy();
            this._checkmark = null;
        }
    }

    destroy() {
        this._stopAnimation();
        this._cleanupProcessingWidgets();
        super.destroy();
    }
});


// --- Panel Indicator ---

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

        // Menu (Rechtsklick)
        this._buildMenu();

        // Recording Pill
        this._pill = null;

        // D-Bus Proxy
        this._connectProxyOrStartBackend();

        // Status-Check
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

    _maybeNotify(title, body) {
        // Nur GNOME-Notification anzeigen wenn aktiviert
        if (this._settings.notifications_enabled) {
            _notify(title, body);
        }
    }

    _ensurePill() {
        this._loadSettingsSync();

        if (this._pill) {
            try { Main.layoutManager.removeChrome(this._pill); } catch (e) { /* already removed */ }
            this._pill.destroy();
            this._pill = null;
        }

        this._pill = new RecordingPill(this._settings);
        this._pill.setOnDone(() => {
            this._destroyPill();
        });
        Main.layoutManager.addChrome(this._pill, {
            affectsInputRegion: false,
            affectsStruts: false,
            trackFullscreen: false,
        });
    }

    _destroyPill() {
        if (this._pill) {
            try {
                Main.layoutManager.removeChrome(this._pill);
            } catch (e) {
                // Fallback: direkt vom Parent entfernen
                try {
                    let parent = this._pill.get_parent();
                    if (parent) parent.remove_child(this._pill);
                } catch (e2) { /* already removed */ }
            }
            this._pill.destroy();
            this._pill = null;
        }
    }

    _connectProxy() {
        if (this._destroyed) return;

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
                    // Proxy creation failed
                }
            }
        );
    }

    _connectProxyOrStartBackend() {
        if (this._destroyed) return;
        this._isBackendOnBus((onBus) => {
            if (this._destroyed) return;
            if (onBus) {
                this._connectProxy();
            } else {
                this._startBackend();
            }
        });
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

        // Benachrichtigungen
        this._notificationsItem = new PopupMenu.PopupSwitchMenuItem('GNOME-Benachrichtigungen', false);
        this._notificationsItem.connect('toggled', (item) => {
            this._setSetting('notifications_enabled', item.state);
            this._settings.notifications_enabled = item.state;
        });
        settingsMenu.menu.addMenuItem(this._notificationsItem);

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
                    this._notificationsItem.setToggleState(this._settings.notifications_enabled ?? false);
                    this._markModel(this._settings.model ?? 'base');
                }
            } catch (e) {
                // File doesn't exist
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
                // File doesn't exist yet
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
        this._maybeNotify('JT Dictate', `Modell '${model}' wird beim nächsten Start geladen`);
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
                this._maybeNotify('JT Dictate', 'Backend wird gestartet...');

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
                            this._maybeNotify('JT Dictate', 'Backend konnte nicht gestartet werden.');
                        }
                    });
                    return GLib.SOURCE_REMOVE;
                };

                let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, tryConnect);
                this._reconnectIds.push(id);
            } catch (e) {
                this._backendStarting = false;
                this._maybeNotify('JT Dictate', `Fehler beim Starten: ${e.message}`);
            }
        });
    }

    _toggle() {
        if (this._toggleInFlight) return;

        if (!this._proxyReady) {
            this._maybeNotify('JT Dictate', 'Backend nicht erreichbar. Starte Backend...');
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
                    this._maybeNotify('JT Dictate', 'Backend nicht erreichbar. Starte Backend...');
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
                        // idle — wenn vorher processing war, done-Animation abspielen
                        if (this._wasProcessing && this._pill) {
                            this._wasProcessing = false;
                            this._pill.setDone();
                            // Pill wird sich selbst zerstoeren via onDone callback
                            this._setIdleStateWithoutPillDestroy();
                        } else {
                            this._setRecordingState(false);
                        }
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

    _setIdleStateWithoutPillDestroy() {
        if (this._destroyed) return;
        this._isRecording = false;
        this._icon.remove_style_class_name('recording');
        this._icon.remove_style_class_name('processing');
        this._icon.icon_name = 'audio-input-microphone-symbolic';
        this._toggleItem.label.text = 'Aufnahme starten';
        this._statusItem.label.text = 'Bereit';
        // Pill bleibt fuer die done-Animation bestehen
    }

    _setRecordingState(recording) {
        if (this._destroyed) return;

        this._isRecording = recording;
        this._wasProcessing = false;

        this._icon.remove_style_class_name('recording');
        this._icon.remove_style_class_name('processing');

        if (recording) {
            this._icon.icon_name = 'media-record-symbolic';
            this._icon.add_style_class_name('recording');
            this._toggleItem.label.text = 'Aufnahme stoppen';
            this._statusItem.label.text = 'Aufnahme läuft...';

            // Pill anzeigen — immer, egal ob Mausklick oder Tastenkuerzel
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

            this._destroyPill();
        }
    }

    _setProcessingState() {
        if (this._destroyed) return;

        this._isRecording = false;
        this._wasProcessing = true;

        this._icon.remove_style_class_name('recording');
        this._icon.add_style_class_name('processing');
        this._icon.icon_name = 'emblem-synchronizing-symbolic';
        this._toggleItem.label.text = 'Verarbeitung läuft...';
        this._statusItem.label.text = 'Text wird verarbeitet...';

        // Pill in Processing-Modus (mit Animation)
        if (!this._pill) {
            this._ensurePill();
            if (this._pill) {
                // Pill direkt sichtbar machen ohne Fade-Animation,
                // da setProcessing() sofort die Morph-Animation uebernimmt
                this._pill.opacity = 255;
                this._pill.visible = true;
                this._pill.updatePosition();
            }
        }
        if (this._pill) {
            this._pill.setProcessing();
        }
    }

    _setLoadingState(message, progress) {
        if (this._destroyed) return;

        this._isRecording = false;

        this._icon.remove_style_class_name('recording');
        this._icon.add_style_class_name('processing');
        this._icon.icon_name = 'emblem-synchronizing-symbolic';

        let progressText;
        if (progress >= 1.0) {
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
        this._reconnectCounter = 0;
        this._statusCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this._destroyed) return GLib.SOURCE_REMOVE;

            if (this._proxyReady || this._backendStarting) {
                this._reconnectCounter = 0;
                this._updateStatus();
            } else {
                // Proxy nicht ready und Backend startet nicht —
                // trotzdem regelmaeßig pruefen ob das Backend inzwischen laeuft
                this._reconnectCounter++;
                if (this._reconnectCounter % 5 === 0) {
                    this._updateStatus();
                }
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

    // Linksklick = Aufnahme toggle, Rechtsklick = Menu toggle
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
        this._destroyPill();
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
