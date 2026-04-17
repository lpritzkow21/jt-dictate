// SPDX-FileCopyrightText: JT Tools
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CONFIG_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'jt-dictate']);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, 'settings.json']);
const THEMES_DIR = GLib.build_filenamev([CONFIG_DIR, 'themes']);

// Alle verfuegbaren Visualisierungstypen
const VISUALIZATION_TYPES = [
    {id: 'bars', name: 'Balken'},
    {id: 'waveform', name: 'Waveform'},
    {id: 'pulse', name: 'Puls'},
    {id: 'circle', name: 'Kreis'},
    {id: 'equalizer', name: 'Equalizer'},
];

// Built-in Sound-Optionen (WAV-Dateien im sounds/ Ordner)
const BUILTIN_SOUNDS = [
    {id: 'gentle-ping', name: 'Gentle Ping'},
    {id: 'bubble', name: 'Bubble'},
    {id: 'chime', name: 'Chime'},
    {id: 'click', name: 'Click'},
    {id: 'cosmic', name: 'Cosmic'},
    {id: 'crystal', name: 'Crystal'},
    {id: 'drop', name: 'Drop'},
    {id: 'echo', name: 'Echo'},
    {id: 'fairy', name: 'Fairy'},
    {id: 'glow', name: 'Glow'},
    {id: 'harp', name: 'Harp'},
    {id: 'laser', name: 'Laser'},
    {id: 'nudge', name: 'Nudge'},
    {id: 'pluck', name: 'Pluck'},
    {id: 'whoosh', name: 'Whoosh'},
];

// Built-in Theme Presets
const THEME_PRESETS = {
    'default': {
        name: 'Standard',
        pill_bg_color: 'rgba(15,15,25,0.82)',
        pill_border_color: 'rgba(255,255,255,0.12)',
        pill_border_width: 1,
        pill_blur: 12,
        pill_shadow_intensity: 0.4,
        bar_color_left: '#6c9ff8',
        bar_color_right: '#f06292',
        bar_gradient: true,
        icon_color: '#e8eaed',
        recording_color: '#ef5350',
        processing_color: '#ffa726',
        spinner_color: '#ffa726',
        checkmark_color: '#66bb6a',
    },
    'neon': {
        name: 'Neon',
        pill_bg_color: 'rgba(0,0,0,0.85)',
        pill_border_color: '#00ff88',
        pill_border_width: 2,
        pill_blur: 10,
        pill_shadow_intensity: 0.6,
        bar_color_left: '#00ff88',
        bar_color_right: '#ff0088',
        bar_gradient: true,
        icon_color: '#00ff88',
        recording_color: '#ff0044',
        processing_color: '#ffaa00',
        spinner_color: '#ffaa00',
        checkmark_color: '#00ff88',
    },
    'minimal': {
        name: 'Minimal',
        pill_bg_color: 'rgba(0,0,0,0.5)',
        pill_border_color: 'rgba(255,255,255,0.05)',
        pill_border_width: 0,
        pill_blur: 0,
        pill_shadow_intensity: 0,
        bar_color_left: '#ffffff',
        bar_color_right: '#ffffff',
        bar_gradient: false,
        icon_color: '#ffffff',
        recording_color: '#e01b24',
        processing_color: '#e5a50a',
        spinner_color: '#ffffff',
        checkmark_color: '#ffffff',
    },
    'ocean': {
        name: 'Ocean',
        pill_bg_color: 'rgba(10,25,47,0.85)',
        pill_border_color: '#1a73e8',
        pill_border_width: 1,
        pill_blur: 8,
        pill_shadow_intensity: 0.4,
        bar_color_left: '#00bcd4',
        bar_color_right: '#1a73e8',
        bar_gradient: true,
        icon_color: '#80deea',
        recording_color: '#ff5252',
        processing_color: '#ffab40',
        spinner_color: '#ffab40',
        checkmark_color: '#00bcd4',
    },
    'sunset': {
        name: 'Sunset',
        pill_bg_color: 'rgba(30,10,10,0.85)',
        pill_border_color: '#ff6b35',
        pill_border_width: 1,
        pill_blur: 6,
        pill_shadow_intensity: 0.5,
        bar_color_left: '#ff6b35',
        bar_color_right: '#f7c948',
        bar_gradient: true,
        icon_color: '#f7c948',
        recording_color: '#e01b24',
        processing_color: '#ff6b35',
        spinner_color: '#ff6b35',
        checkmark_color: '#f7c948',
    },
    'aurora': {
        name: 'Aurora',
        pill_bg_color: 'rgba(10,8,30,0.88)',
        pill_border_color: '#7c4dff',
        pill_border_width: 1,
        pill_blur: 14,
        pill_shadow_intensity: 0.5,
        bar_color_left: '#7c4dff',
        bar_color_right: '#00e5ff',
        bar_gradient: true,
        icon_color: '#b388ff',
        recording_color: '#ff1744',
        processing_color: '#ffab00',
        spinner_color: '#00e5ff',
        checkmark_color: '#69f0ae',
    },
    'cherry': {
        name: 'Cherry',
        pill_bg_color: 'rgba(40,5,15,0.85)',
        pill_border_color: '#e91e63',
        pill_border_width: 1,
        pill_blur: 8,
        pill_shadow_intensity: 0.45,
        bar_color_left: '#e91e63',
        bar_color_right: '#ff6090',
        bar_gradient: true,
        icon_color: '#fce4ec',
        recording_color: '#d50000',
        processing_color: '#ff6d00',
        spinner_color: '#ff6090',
        checkmark_color: '#f8bbd0',
    },
    'forest': {
        name: 'Forest',
        pill_bg_color: 'rgba(5,20,10,0.85)',
        pill_border_color: '#2e7d32',
        pill_border_width: 1,
        pill_blur: 10,
        pill_shadow_intensity: 0.4,
        bar_color_left: '#43a047',
        bar_color_right: '#81c784',
        bar_gradient: true,
        icon_color: '#c8e6c9',
        recording_color: '#ff5252',
        processing_color: '#ffb74d',
        spinner_color: '#81c784',
        checkmark_color: '#a5d6a7',
    },
    'midnight': {
        name: 'Midnight',
        pill_bg_color: 'rgba(5,5,15,0.9)',
        pill_border_color: 'rgba(100,120,255,0.2)',
        pill_border_width: 1,
        pill_blur: 16,
        pill_shadow_intensity: 0.5,
        bar_color_left: '#5c6bc0',
        bar_color_right: '#7986cb',
        bar_gradient: true,
        icon_color: '#9fa8da',
        recording_color: '#ef5350',
        processing_color: '#ffd54f',
        spinner_color: '#7986cb',
        checkmark_color: '#80cbc4',
    },
    'rose': {
        name: 'Rosé',
        pill_bg_color: 'rgba(30,15,20,0.82)',
        pill_border_color: 'rgba(255,150,170,0.2)',
        pill_border_width: 1,
        pill_blur: 12,
        pill_shadow_intensity: 0.35,
        bar_color_left: '#f48fb1',
        bar_color_right: '#ce93d8',
        bar_gradient: true,
        icon_color: '#f8bbd0',
        recording_color: '#e53935',
        processing_color: '#ffb74d',
        spinner_color: '#ce93d8',
        checkmark_color: '#a5d6a7',
    },
};

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
    checkmark_effect: 'fade',
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
};

function _loadSettings() {
    try {
        let file = Gio.File.new_for_path(CONFIG_FILE);
        let [success, contents] = file.load_contents(null);
        if (success) {
            let saved = JSON.parse(new TextDecoder().decode(contents));
            return Object.assign({}, DEFAULT_SETTINGS, saved);
        }
    } catch (e) {
        // File doesn't exist yet
    }
    return Object.assign({}, DEFAULT_SETTINGS);
}

function _saveSettings(settings) {
    try {
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
        let file = Gio.File.new_for_path(CONFIG_FILE);
        let data = new TextEncoder().encode(JSON.stringify(settings, null, 2));
        file.replace_contents(data, null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        console.error(`JT Dictate: Error saving settings: ${e}`);
    }
}

function _parseColor(colorStr) {
    let rgba = new Gdk.RGBA();
    if (!colorStr || typeof colorStr !== 'string') {
        rgba.parse('#ffffff');
        return rgba;
    }
    if (colorStr.startsWith('rgba(')) {
        let match = colorStr.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
        if (match) {
            rgba.red = parseInt(match[1]) / 255;
            rgba.green = parseInt(match[2]) / 255;
            rgba.blue = parseInt(match[3]) / 255;
            rgba.alpha = parseFloat(match[4]);
            return rgba;
        }
    }
    if (!rgba.parse(colorStr)) {
        rgba.parse('#ffffff');
    }
    return rgba;
}

function _colorToString(rgba, includeAlpha) {
    let r = Math.round(rgba.red * 255);
    let g = Math.round(rgba.green * 255);
    let b = Math.round(rgba.blue * 255);
    if (includeAlpha) {
        return `rgba(${r},${g},${b},${rgba.alpha.toFixed(2)})`;
    }
    let rh = r.toString(16).padStart(2, '0');
    let gh = g.toString(16).padStart(2, '0');
    let bh = b.toString(16).padStart(2, '0');
    return `#${rh}${gh}${bh}`;
}

function _addColorRow(group, title, subtitle, settings, key, hasAlpha, saveCallback) {
    let row = new Adw.ActionRow({title, subtitle: subtitle || ''});
    let button = new Gtk.ColorButton({
        valign: Gtk.Align.CENTER,
        use_alpha: hasAlpha,
    });
    let rgba = _parseColor(settings[key]);
    button.set_rgba(rgba);
    button.connect('color-set', () => {
        settings[key] = _colorToString(button.get_rgba(), hasAlpha);
        saveCallback();
    });
    row.add_suffix(button);
    row.set_activatable_widget(button);
    group.add(row);
    return row;
}

function _addSpinRow(group, title, subtitle, settings, key, min, max, step, digits, saveCallback) {
    let row = new Adw.SpinRow({
        title,
        subtitle: subtitle || '',
        adjustment: new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: step,
            value: settings[key],
        }),
        digits: digits || 0,
    });
    row.connect('notify::value', () => {
        settings[key] = row.get_value();
        saveCallback();
    });
    group.add(row);
    return row;
}

function _addSwitchRow(group, title, subtitle, settings, key, saveCallback) {
    let row = new Adw.SwitchRow({
        title,
        subtitle: subtitle || '',
        active: settings[key],
    });
    row.connect('notify::active', () => {
        settings[key] = row.get_active();
        saveCallback();
    });
    group.add(row);
    return row;
}

function _isDialogCancelled(e) {
    return e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

function _getSoundsDir() {
    // Sounds-Ordner relativ zur Extension
    // Wir muessen den Pfad dynamisch ermitteln
    let extensionDir = GLib.path_get_dirname(CONFIG_FILE).replace('/.config/jt-dictate', '');
    // Fallback: schaue in bekannten Pfaden
    let candidates = [
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'gnome-shell', 'extensions', 'jt-dictate@jt.tools', 'sounds']),
        GLib.build_filenamev(['/usr', 'share', 'gnome-shell', 'extensions', 'jt-dictate@jt.tools', 'sounds']),
    ];
    for (let path of candidates) {
        if (GLib.file_test(path, GLib.FileTest.IS_DIR))
            return path;
    }
    return candidates[0]; // Default
}

function _buildSoundOptions(extensionPath) {
    let soundsDir = GLib.build_filenamev([extensionPath, 'sounds']);
    let options = [
        {id: 'none', name: 'Kein Ton'},
    ];

    // Built-in Sounds
    for (let sound of BUILTIN_SOUNDS) {
        let wavPath = GLib.build_filenamev([soundsDir, `${sound.id}.wav`]);
        if (GLib.file_test(wavPath, GLib.FileTest.EXISTS)) {
            options.push({id: `builtin:${sound.id}`, name: sound.name, path: wavPath});
        } else {
            // Auch wenn Datei fehlt, anzeigen (wird beim Abspielen ignoriert)
            options.push({id: `builtin:${sound.id}`, name: sound.name, path: wavPath});
        }
    }

    options.push({id: 'custom', name: 'Eigene Datei...'});

    return options;
}

function _addSoundRow(group, title, subtitle, settings, key, soundOptions, window, saveCallback) {
    let row = new Adw.ComboRow({title, subtitle});
    let model = new Gtk.StringList();

    let activeIdx = 0;
    soundOptions.forEach((opt, idx) => {
        model.append(opt.name);

        if (opt.id === settings[key]) {
            activeIdx = idx;
        }
        // Check if current setting matches a builtin path
        if (opt.path && settings[key] === opt.path) {
            activeIdx = idx;
        }
        // Check if current setting is a builtin:xxx format
        if (settings[key] && settings[key].startsWith('builtin:') && opt.id === settings[key]) {
            activeIdx = idx;
        }
        // Legacy: if setting is 'default', select first builtin or none
        if (settings[key] === 'default' && opt.id === 'builtin:gentle-ping') {
            activeIdx = idx;
        }
        // Custom file
        if (settings[key] && settings[key] !== 'none' && settings[key] !== 'default'
            && !settings[key].startsWith('builtin:')
            && opt.id === 'custom'
            && GLib.file_test(settings[key], GLib.FileTest.EXISTS)) {
            activeIdx = idx;
        }
    });

    row.set_model(model);
    row.set_selected(activeIdx);

    // Custom file row
    let customRow = new Adw.ActionRow({
        title: `${title} Datei`,
        subtitle: (settings[key] && !settings[key].startsWith('builtin:')
            && settings[key] !== 'default' && settings[key] !== 'none')
            ? settings[key] : 'Keine Datei gewählt',
        visible: soundOptions[activeIdx]?.id === 'custom',
    });

    let chooseBtn = new Gtk.Button({label: 'Wählen...', valign: Gtk.Align.CENTER});
    chooseBtn.connect('clicked', () => {
        let dialog = new Gtk.FileDialog({title: 'Sound-Datei wählen'});
        let filter = new Gtk.FileFilter();
        filter.set_name('Audio-Dateien');
        filter.add_pattern('*.wav');
        filter.add_pattern('*.ogg');
        filter.add_pattern('*.oga');
        let filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
        filters.append(filter);
        dialog.set_filters(filters);
        dialog.open(window, null, (d, res) => {
            try {
                let file = d.open_finish(res);
                if (file) {
                    settings[key] = file.get_path();
                    customRow.set_subtitle(settings[key]);
                    saveCallback();
                }
            } catch (e) {
                if (!_isDialogCancelled(e))
                    console.error(`JT Dictate: ${e}`);
            }
        });
    });
    customRow.add_suffix(chooseBtn);

    // Preview button
    let previewBtn = new Gtk.Button({
        icon_name: 'media-playback-start-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Vorhören',
    });
    previewBtn.connect('clicked', () => {
        let idx = row.get_selected();
        let opt = soundOptions[idx];
        if (opt && opt.path && GLib.file_test(opt.path, GLib.FileTest.EXISTS)) {
            try {
                let volKey = `${key}_volume`;
                let vol = settings[volKey] !== undefined ? settings[volKey] : 0.5;
                let paVol = Math.round(vol * 65536);
                GLib.spawn_command_line_async(`paplay --volume=${paVol} "${opt.path}"`);
            } catch (e) {
                console.error(`JT Dictate: Preview failed: ${e}`);
            }
        }
    });
    row.add_suffix(previewBtn);

    row.connect('notify::selected', () => {
        let idx = row.get_selected();
        let opt = soundOptions[idx];
        if (opt.id === 'custom') {
            customRow.set_visible(true);
        } else {
            customRow.set_visible(false);
            // Speichere die Sound-ID (z.B. 'click', 'gentle-ping'), nicht den Dateipfad
            // So sind Settings portabel zwischen Systemen
            if (opt.id.startsWith('builtin:')) {
                settings[key] = opt.id.replace('builtin:', '');
            } else {
                settings[key] = opt.id;
            }
            saveCallback();
        }
    });

    group.add(row);
    group.add(customRow);

    return {row, customRow};
}

export default class JtDictatePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = _loadSettings();
        let _initializing = true;
        const save = () => { if (!_initializing) _saveSettings(settings); };

        let extensionPath = this.path;
        let soundOptions = _buildSoundOptions(extensionPath);

        window.set_default_size(700, 800);

        // --- Seite 1: Aufnahme-Pill ---
        let pillPage = new Adw.PreferencesPage({
            title: 'Aufnahme-Pill',
            icon_name: 'audio-input-microphone-symbolic',
        });
        window.add(pillPage);

        // Form & Position
        let pillFormGroup = new Adw.PreferencesGroup({
            title: 'Form & Position',
            description: 'Größe und Position der Aufnahme-Anzeige',
        });
        pillPage.add(pillFormGroup);

        _addSpinRow(pillFormGroup, 'Breite', 'Pixel', settings, 'pill_width', 100, 600, 10, 0, save);
        _addSpinRow(pillFormGroup, 'Höhe', 'Pixel', settings, 'pill_height', 24, 80, 2, 0, save);
        _addSpinRow(pillFormGroup, 'Eckenradius', 'Pixel', settings, 'pill_border_radius', 0, 40, 1, 0, save);
        _addSpinRow(pillFormGroup, 'Abstand oben/unten', 'Pixel vom Bildschirmrand', settings, 'pill_margin_top', 0, 200, 5, 0, save);
        _addSpinRow(pillFormGroup, 'Abstand horizontal', 'Pixel', settings, 'pill_margin_horizontal', 0, 200, 5, 0, save);

        let positions = [
            {id: 'top-center', name: 'Oben Mitte'},
            {id: 'top-left', name: 'Oben Links'},
            {id: 'top-right', name: 'Oben Rechts'},
            {id: 'bottom-center', name: 'Unten Mitte'},
            {id: 'bottom-left', name: 'Unten Links'},
            {id: 'bottom-right', name: 'Unten Rechts'},
        ];

        let posRow = new Adw.ComboRow({
            title: 'Position',
            subtitle: 'Wo die Pill angezeigt wird',
        });
        let posModel = new Gtk.StringList();
        let activePosIdx = 0;
        positions.forEach((pos, idx) => {
            posModel.append(pos.name);
            if (pos.id === settings.pill_position) activePosIdx = idx;
        });
        posRow.set_model(posModel);
        posRow.set_selected(activePosIdx);
        posRow.connect('notify::selected', () => {
            settings.pill_position = positions[posRow.get_selected()].id;
            save();
        });
        pillFormGroup.add(posRow);

        // Bildschirm-Auswahl
        let monitorRow = new Adw.ComboRow({
            title: 'Bildschirm',
            subtitle: 'Auf welchem Bildschirm die Pill angezeigt wird',
        });
        let monitorModel = new Gtk.StringList();
        let monitorOptions = [
            {id: 'active', name: 'Aktiver Bildschirm (Maus)'},
            {id: 'primary', name: 'Primärer Bildschirm'},
        ];
        let activeMonitorIdx = 0;
        monitorOptions.forEach((opt, idx) => {
            monitorModel.append(opt.name);
            if (opt.id === settings.pill_display_monitor) activeMonitorIdx = idx;
        });
        monitorRow.set_model(monitorModel);
        monitorRow.set_selected(activeMonitorIdx);
        monitorRow.connect('notify::selected', () => {
            settings.pill_display_monitor = monitorOptions[monitorRow.get_selected()].id;
            save();
        });
        pillFormGroup.add(monitorRow);

        // Aussehen
        let pillLookGroup = new Adw.PreferencesGroup({
            title: 'Aussehen',
            description: 'Hintergrund, Border, Schatten',
        });
        pillPage.add(pillLookGroup);

        _addColorRow(pillLookGroup, 'Hintergrundfarbe', 'Pill-Hintergrund', settings, 'pill_bg_color', true, save);
        _addColorRow(pillLookGroup, 'Border-Farbe', 'Umrandung', settings, 'pill_border_color', true, save);
        _addSpinRow(pillLookGroup, 'Border-Stärke', 'Pixel', settings, 'pill_border_width', 0, 5, 1, 0, save);
        _addSpinRow(pillLookGroup, 'Blur-Stärke', 'Pixel (Backdrop-Filter)', settings, 'pill_blur', 0, 40, 1, 0, save);
        _addSpinRow(pillLookGroup, 'Schatten-Intensität', '0 = kein Schatten', settings, 'pill_shadow_intensity', 0, 1, 0.05, 2, save);

        // Mikrofon-Icon
        let iconGroup = new Adw.PreferencesGroup({
            title: 'Mikrofon-Icon',
            description: 'Icon in der Pill anpassen',
        });
        pillPage.add(iconGroup);

        let iconRow = new Adw.ComboRow({
            title: 'Icon',
            subtitle: 'Vordefiniertes Icon wählen',
        });
        let iconModel = new Gtk.StringList();
        let iconOptions = [
            {id: 'audio-input-microphone-symbolic', name: 'Mikrofon'},
            {id: 'media-record-symbolic', name: 'Aufnahme'},
            {id: 'audio-speakers-symbolic', name: 'Lautsprecher'},
            {id: 'emblem-music-symbolic', name: 'Musik'},
            {id: 'face-smile-symbolic', name: 'Smiley'},
            {id: 'janeway', name: 'Janeway'},
            {id: 'custom', name: 'Eigenes Icon...'},
        ];
        let activeIconIdx = 0;
        iconOptions.forEach((opt, idx) => {
            iconModel.append(opt.name);
            if (opt.id === settings.icon_name) activeIconIdx = idx;
        });
        if (settings.icon_name === 'custom' && settings.custom_icon_path) activeIconIdx = iconOptions.length - 1;
        iconRow.set_model(iconModel);
        iconRow.set_selected(activeIconIdx);

        let customIconRow = new Adw.ActionRow({
            title: 'Eigenes Icon',
            subtitle: settings.custom_icon_path || 'Kein Icon gewählt',
            visible: activeIconIdx === iconOptions.length - 1,
        });
        let chooseButton = new Gtk.Button({
            label: 'Wählen...',
            valign: Gtk.Align.CENTER,
        });
        chooseButton.connect('clicked', () => {
            let dialog = new Gtk.FileDialog({
                title: 'Icon wählen',
            });
            let filter = new Gtk.FileFilter();
            filter.set_name('SVG / PNG Icons');
            filter.add_pattern('*.svg');
            filter.add_pattern('*.png');
            let filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
            filters.append(filter);
            dialog.set_filters(filters);
            dialog.open(window, null, (d, res) => {
                try {
                    let file = d.open_finish(res);
                    if (file) {
                        settings.custom_icon_path = file.get_path();
                        settings.icon_name = 'custom';
                        customIconRow.set_subtitle(settings.custom_icon_path);
                        save();
                    }
                } catch (e) {
                    if (!_isDialogCancelled(e))
                        console.error(`JT Dictate: ${e}`);
                }
            });
        });
        customIconRow.add_suffix(chooseButton);
        iconGroup.add(iconRow);
        iconGroup.add(customIconRow);

        iconRow.connect('notify::selected', () => {
            let idx = iconRow.get_selected();
            let selected = iconOptions[idx];
            if (selected.id === 'custom') {
                customIconRow.set_visible(true);
            } else {
                customIconRow.set_visible(false);
                settings.icon_name = selected.id;
                settings.custom_icon_path = '';
                save();
            }
        });

        _addColorRow(iconGroup, 'Icon-Farbe', 'Farbe des Icons in der Pill', settings, 'icon_color', false, save);
        _addColorRow(iconGroup, 'Aufnahme-Farbe', 'Icon-Farbe während Aufnahme', settings, 'recording_color', false, save);

        // --- Seite 2: Visualisierung ---
        let vizPage = new Adw.PreferencesPage({
            title: 'Visualisierung',
            icon_name: 'display-symbolic',
        });
        window.add(vizPage);

        // Audio-Visualisierung
        let vizGroup = new Adw.PreferencesGroup({
            title: 'Audio-Visualisierung',
            description: 'Wie die Spracheingabe dargestellt wird',
        });
        vizPage.add(vizGroup);

        let vizRow = new Adw.ComboRow({
            title: 'Visualisierungstyp',
            subtitle: 'Art der Audio-Anzeige',
        });
        let vizModel = new Gtk.StringList();
        let activeVizIdx = 0;
        VISUALIZATION_TYPES.forEach((vt, idx) => {
            vizModel.append(vt.name);
            if (vt.id === settings.visualization_type) activeVizIdx = idx;
        });
        vizRow.set_model(vizModel);
        vizRow.set_selected(activeVizIdx);
        vizRow.connect('notify::selected', () => {
            settings.visualization_type = VISUALIZATION_TYPES[vizRow.get_selected()].id;
            save();
        });
        vizGroup.add(vizRow);

        _addSpinRow(vizGroup, 'Anzahl Balken', 'Nur für Balken/Equalizer (3-30)', settings, 'bar_count', 3, 30, 1, 0, save);
        _addSwitchRow(vizGroup, 'Farbverlauf', 'Gradient von links nach rechts', settings, 'bar_gradient', save);
        _addColorRow(vizGroup, 'Farbe Links', 'Startfarbe des Verlaufs', settings, 'bar_color_left', false, save);
        _addColorRow(vizGroup, 'Farbe Rechts', 'Endfarbe des Verlaufs', settings, 'bar_color_right', false, save);

        // Status-Anzeige (Processing)
        let statusGroup = new Adw.PreferencesGroup({
            title: 'Status-Anzeige (Processing)',
            description: 'Position und Aussehen des Processing-Kreises',
        });
        vizPage.add(statusGroup);

        let procPosRow = new Adw.ComboRow({
            title: 'Processing-Position',
            subtitle: 'Wo der Processing-Kreis angezeigt wird',
        });
        let procPosModel = new Gtk.StringList();
        let activeProcPosIdx = 0;
        positions.forEach((pos, idx) => {
            procPosModel.append(pos.name);
            if (pos.id === settings.processing_position) activeProcPosIdx = idx;
        });
        procPosRow.set_model(procPosModel);
        procPosRow.set_selected(activeProcPosIdx);
        procPosRow.connect('notify::selected', () => {
            settings.processing_position = positions[procPosRow.get_selected()].id;
            save();
        });
        statusGroup.add(procPosRow);

        _addSpinRow(statusGroup, 'Abstand unten', 'Pixel vom unteren Rand', settings, 'processing_margin_bottom', 0, 200, 5, 0, save);
        _addSpinRow(statusGroup, 'Abstand horizontal', 'Pixel vom seitlichen Rand', settings, 'processing_margin_horizontal', 0, 200, 5, 0, save);
        _addSpinRow(statusGroup, 'Größe', 'Durchmesser des Processing-Kreises', settings, 'processing_size', 24, 80, 2, 0, save);
        _addColorRow(statusGroup, 'Verarbeitungs-Farbe', 'Hintergrund des Processing-Kreises', settings, 'processing_color', false, save);
        _addColorRow(statusGroup, 'Spinner-Farbe', 'Farbe des drehenden Lade-Spinners', settings, 'spinner_color', false, save);
        _addColorRow(statusGroup, 'Häkchen-Farbe', 'Farbe des Fertig-Häkchens', settings, 'checkmark_color', false, save);

        // Animation
        let animGroup = new Adw.PreferencesGroup({
            title: 'Animation',
            description: 'Animations-Stil der Pill-Übergänge',
        });
        vizPage.add(animGroup);

        let animRow = new Adw.ComboRow({
            title: 'Animations-Stil',
            subtitle: 'Wie sich die Pill bewegt und verwandelt',
        });
        let animModel = new Gtk.StringList();
        let animOptions = [
            {id: 'smooth', name: 'Smooth'},
            {id: 'bounce', name: 'Bounce'},
            {id: 'minimal', name: 'Minimal'},
        ];
        let activeAnimIdx = 0;
        animOptions.forEach((opt, idx) => {
            animModel.append(opt.name);
            if (opt.id === settings.pill_animation) activeAnimIdx = idx;
        });
        animRow.set_model(animModel);
        animRow.set_selected(activeAnimIdx);
        animRow.connect('notify::selected', () => {
            settings.pill_animation = animOptions[animRow.get_selected()].id;
            save();
        });
        animGroup.add(animRow);

        // Häkchen-Effekt
        let checkEffectRow = new Adw.ComboRow({
            title: 'Häkchen-Effekt',
            subtitle: 'Wie das Fertig-Häkchen erscheint',
        });
        let checkEffectModel = new Gtk.StringList();
        let checkEffectOptions = [
            {id: 'fade', name: 'Fade'},
            {id: 'zoom', name: 'Zoom'},
        ];
        let activeCheckEffectIdx = 0;
        checkEffectOptions.forEach((opt, idx) => {
            checkEffectModel.append(opt.name);
            if (opt.id === settings.checkmark_effect) activeCheckEffectIdx = idx;
        });
        checkEffectRow.set_model(checkEffectModel);
        checkEffectRow.set_selected(activeCheckEffectIdx);
        checkEffectRow.connect('notify::selected', () => {
            settings.checkmark_effect = checkEffectOptions[checkEffectRow.get_selected()].id;
            save();
        });
        animGroup.add(checkEffectRow);

        // --- Seite 3: Sound & Benachrichtigungen ---
        let soundPage = new Adw.PreferencesPage({
            title: 'Sound',
            icon_name: 'audio-speakers-symbolic',
        });
        window.add(soundPage);

        // Feedback-Toene
        let soundEnableGroup = new Adw.PreferencesGroup({
            title: 'Feedback-Töne',
            description: 'Akustisches Feedback aktivieren/deaktivieren',
        });
        soundPage.add(soundEnableGroup);

        _addSwitchRow(soundEnableGroup, 'Töne aktiviert',
            'Akustisches Feedback bei Aufnahme-Start und -Stop', settings, 'sound_enabled', save);

        // Start-Ton
        let startSoundGroup = new Adw.PreferencesGroup({
            title: 'Start-Ton',
            description: 'Ton bei Aufnahme-Start',
        });
        soundPage.add(startSoundGroup);

        _addSoundRow(startSoundGroup, 'Start-Ton', 'Ton bei Aufnahme-Start',
            settings, 'sound_start', soundOptions, window, save);
        _addSpinRow(startSoundGroup, 'Lautstärke', '0 = stumm, 1 = voll',
            settings, 'sound_start_volume', 0, 1, 0.05, 2, save);

        // Stop-Ton
        let stopSoundGroup = new Adw.PreferencesGroup({
            title: 'Stop-Ton',
            description: 'Ton bei Aufnahme-Stop',
        });
        soundPage.add(stopSoundGroup);

        _addSoundRow(stopSoundGroup, 'Stop-Ton', 'Ton bei Aufnahme-Stop',
            settings, 'sound_stop', soundOptions, window, save);
        _addSpinRow(stopSoundGroup, 'Lautstärke', '0 = stumm, 1 = voll',
            settings, 'sound_stop_volume', 0, 1, 0.05, 2, save);

        // Fertig-Ton
        let finishSoundGroup = new Adw.PreferencesGroup({
            title: 'Fertig-Ton',
            description: 'Ton wenn Transkription abgeschlossen',
        });
        soundPage.add(finishSoundGroup);

        _addSoundRow(finishSoundGroup, 'Fertig-Ton', 'Ton wenn Transkription abgeschlossen',
            settings, 'sound_finish', soundOptions, window, save);
        _addSpinRow(finishSoundGroup, 'Lautstärke', '0 = stumm, 1 = voll',
            settings, 'sound_finish_volume', 0, 1, 0.05, 2, save);

        // Benachrichtigungen
        let notifGroup = new Adw.PreferencesGroup({
            title: 'Benachrichtigungen',
            description: 'GNOME-System-Benachrichtigungen',
        });
        soundPage.add(notifGroup);

        _addSwitchRow(notifGroup, 'GNOME-Benachrichtigungen',
            'System-Benachrichtigungen anzeigen (standardmäßig deaktiviert)', settings, 'notifications_enabled', save);

        // --- Seite 4: Theme & Daten ---
        let dataPage = new Adw.PreferencesPage({
            title: 'Theme & Daten',
            icon_name: 'document-save-symbolic',
        });
        window.add(dataPage);

        // Theme
        let themeGroup = new Adw.PreferencesGroup({
            title: 'Theme',
            description: 'Vorkonfigurierte Themes oder System-Theme folgen',
        });
        dataPage.add(themeGroup);

        _addSwitchRow(themeGroup, 'System-Theme folgen',
            'Passt sich automatisch an das GTK-Theme an (Dark/Light)', settings, 'follow_system_theme', save);

        let themeRow = new Adw.ComboRow({
            title: 'Theme-Preset',
            subtitle: 'Vorkonfiguriertes Farbschema',
        });
        let themeModel = new Gtk.StringList();
        let themeIds = Object.keys(THEME_PRESETS);
        let activeThemeIdx = 0;
        themeIds.forEach((id, idx) => {
            themeModel.append(THEME_PRESETS[id].name);
            if (id === settings.active_theme) activeThemeIdx = idx;
        });

        let customThemes = _loadCustomThemes();
        let customThemeIds = Object.keys(customThemes);
        customThemeIds.forEach((id, idx) => {
            themeModel.append(customThemes[id].name);
            if (id === settings.active_theme) activeThemeIdx = themeIds.length + idx;
        });

        themeRow.set_model(themeModel);
        themeRow.set_selected(activeThemeIdx);
        themeRow.connect('notify::selected', () => {
            let idx = themeRow.get_selected();
            let allIds = [...themeIds, ...customThemeIds];
            let selectedId = allIds[idx];
            if (!selectedId) return;

            settings.active_theme = selectedId;
            let preset = THEME_PRESETS[selectedId] || customThemes[selectedId];
            if (preset) {
                for (let [key, value] of Object.entries(preset)) {
                    if (key !== 'name' && key in settings) {
                        settings[key] = value;
                    }
                }
            }
            save();
            window.close();
        });
        themeGroup.add(themeRow);

        // Einstellungen Export/Import
        let settingsDataGroup = new Adw.PreferencesGroup({
            title: 'Einstellungen',
            description: 'Alle Einstellungen exportieren oder importieren',
        });
        dataPage.add(settingsDataGroup);

        let exportSettingsRow = new Adw.ActionRow({
            title: 'Einstellungen exportieren',
            subtitle: 'Als JSON-Datei speichern',
        });
        let exportBtn = new Gtk.Button({label: 'Exportieren', valign: Gtk.Align.CENTER});
        exportBtn.add_css_class('suggested-action');
        exportBtn.connect('clicked', () => {
            let dialog = new Gtk.FileDialog({
                title: 'Einstellungen exportieren',
                initial_name: 'jt-dictate-settings.json',
            });
            dialog.save(window, null, (d, res) => {
                try {
                    let file = d.save_finish(res);
                    if (file) {
                        let data = new TextEncoder().encode(JSON.stringify(settings, null, 2));
                        file.replace_contents(data, null, false, Gio.FileCreateFlags.NONE, null);
                    }
                } catch (e) {
                    if (!_isDialogCancelled(e))
                        console.error(`JT Dictate: ${e}`);
                }
            });
        });
        exportSettingsRow.add_suffix(exportBtn);
        settingsDataGroup.add(exportSettingsRow);

        let importSettingsRow = new Adw.ActionRow({
            title: 'Einstellungen importieren',
            subtitle: 'Aus JSON-Datei laden',
        });
        let importBtn = new Gtk.Button({label: 'Importieren', valign: Gtk.Align.CENTER});
        importBtn.connect('clicked', () => {
            let dialog = new Gtk.FileDialog({title: 'Einstellungen importieren'});
            let filter = new Gtk.FileFilter();
            filter.set_name('JSON-Dateien');
            filter.add_pattern('*.json');
            let filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
            filters.append(filter);
            dialog.set_filters(filters);
            dialog.open(window, null, (d, res) => {
                try {
                    let file = d.open_finish(res);
                    if (file) {
                        let [success, contents] = file.load_contents(null);
                        if (success) {
                            let imported = JSON.parse(new TextDecoder().decode(contents));
                            for (let [key, value] of Object.entries(imported)) {
                                if (key in DEFAULT_SETTINGS) {
                                    settings[key] = value;
                                }
                            }
                            save();
                            let toast = new Adw.Toast({title: 'Einstellungen importiert — bitte neu öffnen'});
                            window.add_toast(toast);
                        }
                    }
                } catch (e) {
                    if (!_isDialogCancelled(e))
                        console.error(`JT Dictate: ${e}`);
                }
            });
        });
        importSettingsRow.add_suffix(importBtn);
        settingsDataGroup.add(importSettingsRow);

        // Themes Export/Import
        let themeDataGroup = new Adw.PreferencesGroup({
            title: 'Themes',
            description: 'Eigene Themes exportieren, importieren oder teilen',
        });
        dataPage.add(themeDataGroup);

        let exportThemeRow = new Adw.ActionRow({
            title: 'Aktuelles Theme exportieren',
            subtitle: 'Nur die Theme-relevanten Einstellungen',
        });
        let exportThemeBtn = new Gtk.Button({label: 'Exportieren', valign: Gtk.Align.CENTER});
        exportThemeBtn.add_css_class('suggested-action');
        exportThemeBtn.connect('clicked', () => {
            let themeData = {name: settings.active_theme || 'custom'};
            let themeKeys = [
                'pill_bg_color', 'pill_border_color', 'pill_border_width',
                'pill_blur', 'pill_shadow_intensity',
                'bar_color_left', 'bar_color_right', 'bar_gradient',
                'icon_color', 'recording_color', 'processing_color', 'spinner_color', 'checkmark_color',
            ];
            for (let key of themeKeys) {
                themeData[key] = settings[key];
            }

            let dialog = new Gtk.FileDialog({
                title: 'Theme exportieren',
                initial_name: `jt-theme-${themeData.name}.json`,
            });
            dialog.save(window, null, (d, res) => {
                try {
                    let file = d.save_finish(res);
                    if (file) {
                        let data = new TextEncoder().encode(JSON.stringify(themeData, null, 2));
                        file.replace_contents(data, null, false, Gio.FileCreateFlags.NONE, null);
                    }
                } catch (e) {
                    if (!_isDialogCancelled(e))
                        console.error(`JT Dictate: ${e}`);
                }
            });
        });
        exportThemeRow.add_suffix(exportThemeBtn);
        themeDataGroup.add(exportThemeRow);

        let importThemeRow = new Adw.ActionRow({
            title: 'Theme importieren',
            subtitle: 'Theme-Datei laden und speichern',
        });
        let importThemeBtn = new Gtk.Button({label: 'Importieren', valign: Gtk.Align.CENTER});
        importThemeBtn.connect('clicked', () => {
            let dialog = new Gtk.FileDialog({title: 'Theme importieren'});
            let filter = new Gtk.FileFilter();
            filter.set_name('JSON-Dateien');
            filter.add_pattern('*.json');
            let filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
            filters.append(filter);
            dialog.set_filters(filters);
            dialog.open(window, null, (d, res) => {
                try {
                    let file = d.open_finish(res);
                    if (file) {
                        let [success, contents] = file.load_contents(null);
                        if (success) {
                            let themeData = JSON.parse(new TextDecoder().decode(contents));
                            let themeName = themeData.name || 'imported';
                            let themeId = `custom-${themeName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

                            _saveCustomTheme(themeId, themeData);

                            let themeKeys = [
                                'pill_bg_color', 'pill_border_color', 'pill_border_width',
                                'pill_blur', 'pill_shadow_intensity',
                                'bar_color_left', 'bar_color_right', 'bar_gradient',
                                'icon_color', 'recording_color', 'processing_color', 'spinner_color', 'checkmark_color',
                            ];
                            for (let key of themeKeys) {
                                if (key in themeData) {
                                    settings[key] = themeData[key];
                                }
                            }
                            settings.active_theme = themeId;
                            save();

                            let toast = new Adw.Toast({title: `Theme "${themeName}" importiert — bitte neu öffnen`});
                            window.add_toast(toast);
                        }
                    }
                } catch (e) {
                    if (!_isDialogCancelled(e))
                        console.error(`JT Dictate: ${e}`);
                }
            });
        });
        importThemeRow.add_suffix(importThemeBtn);
        themeDataGroup.add(importThemeRow);

        _initializing = false;
    }
}

function _loadCustomThemes() {
    let themes = {};
    try {
        let dir = Gio.File.new_for_path(THEMES_DIR);
        if (!dir.query_exists(null)) return themes;

        let enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            let name = info.get_name();
            if (!name.endsWith('.json')) continue;
            try {
                let file = dir.get_child(name);
                let [success, contents] = file.load_contents(null);
                if (success) {
                    let data = JSON.parse(new TextDecoder().decode(contents));
                    let id = name.replace('.json', '');
                    themes[id] = data;
                }
            } catch (e) { /* skip broken theme files */ }
        }
    } catch (e) { /* themes dir doesn't exist */ }
    return themes;
}

function _saveCustomTheme(id, data) {
    try {
        GLib.mkdir_with_parents(THEMES_DIR, 0o755);
        let file = Gio.File.new_for_path(GLib.build_filenamev([THEMES_DIR, `${id}.json`]));
        let bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        console.error(`JT Dictate: Error saving theme: ${e}`);
    }
}
