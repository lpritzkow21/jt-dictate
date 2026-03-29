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

// Alle verfügbaren Visualisierungstypen
const VISUALIZATION_TYPES = [
    {id: 'bars', name: 'Balken'},
    {id: 'waveform', name: 'Waveform'},
    {id: 'pulse', name: 'Puls'},
    {id: 'circle', name: 'Kreis'},
    {id: 'equalizer', name: 'Equalizer'},
];

// Built-in Theme Presets
const THEME_PRESETS = {
    'default': {
        name: 'Standard',
        pill_bg_color: 'rgba(0,0,0,0.75)',
        pill_border_color: 'rgba(255,255,255,0.1)',
        pill_border_width: 1,
        pill_blur: 0,
        pill_shadow_intensity: 0.3,
        bar_color_left: '#3584e4',
        bar_color_right: '#e01b24',
        bar_gradient: true,
        icon_color: '#ffffff',
        recording_color: '#e01b24',
        processing_color: '#e5a50a',
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
    },
};

const DEFAULT_SETTINGS = {
    // Bestehende Settings
    auto_clipboard: true,
    model: 'base',
    language: null,

    // Pill Styling
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

    // Balken/Visualisierung
    visualization_type: 'bars',
    bar_color_left: '#3584e4',
    bar_color_right: '#e01b24',
    bar_gradient: true,
    bar_count: 5,

    // Icon
    icon_name: 'audio-input-microphone-symbolic',
    icon_color: '#ffffff',
    custom_icon_path: '',

    // State Colors
    recording_color: '#e01b24',
    processing_color: '#e5a50a',

    // Theme
    active_theme: 'default',
    follow_system_theme: false,

    // Sound
    sound_enabled: true,
    sound_volume: 0.5,
    sound_start: 'default',
    sound_stop: 'default',
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
        // Parse fehlgeschlagen — weißen Fallback verwenden
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
    // Konsistent #hex zurückgeben (nicht rgba.to_string() das rgb() Format nutzt)
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
    // Gio.IOErrorEnum.CANCELLED wird geworfen wenn der User den Dialog abbricht
    return e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export default class JtDictatePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = _loadSettings();
        let _initializing = true;
        const save = () => { if (!_initializing) _saveSettings(settings); };

        window.set_default_size(700, 800);

        // ─── Seite 1: Aussehen ───
        let appearancePage = new Adw.PreferencesPage({
            title: 'Aussehen',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        window.add(appearancePage);

        // Theme-Auswahl
        let themeGroup = new Adw.PreferencesGroup({
            title: 'Theme',
            description: 'Vorkonfigurierte Themes oder System-Theme folgen',
        });
        appearancePage.add(themeGroup);

        // Follow System Theme
        _addSwitchRow(themeGroup, 'System-Theme folgen',
            'Passt sich automatisch an das GTK-Theme an (Dark/Light)', settings, 'follow_system_theme', save);

        // Theme Preset Dropdown
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

        // Prüfe ob custom themes existieren
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
                // Übernehme Theme-Werte
                for (let [key, value] of Object.entries(preset)) {
                    if (key !== 'name' && key in settings) {
                        settings[key] = value;
                    }
                }
            }
            save();
            // Fenster schließen damit User es mit aktualisierten Werten neu öffnet
            window.close();
        });
        themeGroup.add(themeRow);

        // Pill-Form
        let pillGroup = new Adw.PreferencesGroup({
            title: 'Pill-Form',
            description: 'Größe und Position der Aufnahme-Anzeige',
        });
        appearancePage.add(pillGroup);

        _addSpinRow(pillGroup, 'Breite', 'Pixel', settings, 'pill_width', 100, 600, 10, 0, save);
        _addSpinRow(pillGroup, 'Höhe', 'Pixel', settings, 'pill_height', 24, 80, 2, 0, save);
        _addSpinRow(pillGroup, 'Eckenradius', 'Pixel', settings, 'pill_border_radius', 0, 40, 1, 0, save);
        _addSpinRow(pillGroup, 'Abstand oben', 'Pixel vom Bildschirmrand', settings, 'pill_margin_top', 0, 200, 5, 0, save);
        _addSpinRow(pillGroup, 'Abstand horizontal', 'Pixel', settings, 'pill_margin_horizontal', 0, 200, 5, 0, save);

        // Pill Position
        let posRow = new Adw.ComboRow({
            title: 'Position',
            subtitle: 'Wo die Pill angezeigt wird',
        });
        let posModel = new Gtk.StringList();
        let positions = [
            {id: 'top-center', name: 'Oben Mitte'},
            {id: 'top-left', name: 'Oben Links'},
            {id: 'top-right', name: 'Oben Rechts'},
            {id: 'bottom-center', name: 'Unten Mitte'},
            {id: 'bottom-left', name: 'Unten Links'},
            {id: 'bottom-right', name: 'Unten Rechts'},
        ];
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
        pillGroup.add(posRow);

        // Farben & Effekte
        let colorGroup = new Adw.PreferencesGroup({
            title: 'Farben & Effekte',
            description: 'Hintergrund, Border, Schatten',
        });
        appearancePage.add(colorGroup);

        _addColorRow(colorGroup, 'Hintergrundfarbe', 'Pill-Hintergrund', settings, 'pill_bg_color', true, save);
        _addColorRow(colorGroup, 'Border-Farbe', 'Umrandung', settings, 'pill_border_color', true, save);
        _addSpinRow(colorGroup, 'Border-Stärke', 'Pixel', settings, 'pill_border_width', 0, 5, 1, 0, save);
        _addSpinRow(colorGroup, 'Blur-Stärke', 'Pixel (Backdrop-Filter)', settings, 'pill_blur', 0, 40, 1, 0, save);
        _addSpinRow(colorGroup, 'Schatten-Intensität', '0 = kein Schatten', settings, 'pill_shadow_intensity', 0, 1, 0.05, 2, save);

        // State-Farben
        _addColorRow(colorGroup, 'Aufnahme-Farbe', 'Icon-Farbe während Aufnahme', settings, 'recording_color', false, save);
        _addColorRow(colorGroup, 'Verarbeitungs-Farbe', 'Icon-Farbe während Verarbeitung', settings, 'processing_color', false, save);

        // ─── Seite 2: Visualisierung ───
        let vizPage = new Adw.PreferencesPage({
            title: 'Visualisierung',
            icon_name: 'display-symbolic',
        });
        window.add(vizPage);

        let vizGroup = new Adw.PreferencesGroup({
            title: 'Audio-Visualisierung',
            description: 'Wie die Spracheingabe dargestellt wird',
        });
        vizPage.add(vizGroup);

        // Visualization Type
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

        _addSpinRow(vizGroup, 'Anzahl Balken', 'Nur für Balken/Equalizer', settings, 'bar_count', 3, 20, 1, 0, save);
        _addSwitchRow(vizGroup, 'Farbverlauf', 'Gradient von links nach rechts', settings, 'bar_gradient', save);
        _addColorRow(vizGroup, 'Farbe Links', 'Startfarbe des Verlaufs', settings, 'bar_color_left', false, save);
        _addColorRow(vizGroup, 'Farbe Rechts', 'Endfarbe des Verlaufs', settings, 'bar_color_right', false, save);

        // Icon
        let iconGroup = new Adw.PreferencesGroup({
            title: 'Mikrofon-Icon',
            description: 'Icon in der Pill anpassen',
        });
        vizPage.add(iconGroup);

        // Icon Auswahl
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
            {id: 'custom', name: 'Eigenes Icon...'},
        ];
        let activeIconIdx = 0;
        iconOptions.forEach((opt, idx) => {
            iconModel.append(opt.name);
            if (opt.id === settings.icon_name) activeIconIdx = idx;
        });
        // Wenn custom icon path gesetzt, custom auswählen
        if (settings.custom_icon_path) activeIconIdx = iconOptions.length - 1;
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

        // ─── Seite 3: Sound ───
        let soundPage = new Adw.PreferencesPage({
            title: 'Sound',
            icon_name: 'audio-speakers-symbolic',
        });
        window.add(soundPage);

        let soundGroup = new Adw.PreferencesGroup({
            title: 'Feedback-Töne',
            description: 'Akustisches Feedback bei Start/Stop der Aufnahme',
        });
        soundPage.add(soundGroup);

        _addSwitchRow(soundGroup, 'Töne aktiviert',
            'Akustisches Feedback bei Aufnahme-Start und -Stop', settings, 'sound_enabled', save);

        _addSpinRow(soundGroup, 'Lautstärke', '0 = stumm, 1 = voll',
            settings, 'sound_volume', 0, 1, 0.05, 2, save);

        // Start-Sound
        let startSoundOptions = [
            {id: 'default', name: 'Standard (System)'},
            {id: 'none', name: 'Kein Ton'},
            {id: 'custom', name: 'Eigene Datei...'},
        ];
        let startSoundRow = new Adw.ComboRow({
            title: 'Start-Ton',
            subtitle: 'Ton bei Aufnahme-Start',
        });
        let startSoundModel = new Gtk.StringList();
        let activeStartIdx = 0;
        startSoundOptions.forEach((opt, idx) => {
            startSoundModel.append(opt.name);
            if (opt.id === settings.sound_start) activeStartIdx = idx;
            // Wenn custom path gesetzt, custom auswählen
            if (settings.sound_start !== 'default' && settings.sound_start !== 'none'
                && opt.id === 'custom') activeStartIdx = idx;
        });
        startSoundRow.set_model(startSoundModel);
        startSoundRow.set_selected(activeStartIdx);

        let customStartRow = new Adw.ActionRow({
            title: 'Start-Sound Datei',
            subtitle: (settings.sound_start !== 'default' && settings.sound_start !== 'none')
                ? settings.sound_start : 'Keine Datei gewählt',
            visible: activeStartIdx === 2,
        });
        let chooseStartBtn = new Gtk.Button({label: 'Wählen...', valign: Gtk.Align.CENTER});
        chooseStartBtn.connect('clicked', () => {
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
                        settings.sound_start = file.get_path();
                        customStartRow.set_subtitle(settings.sound_start);
                        save();
                    }
                } catch (e) {
                    if (!_isDialogCancelled(e))
                        console.error(`JT Dictate: ${e}`);
                }
            });
        });
        customStartRow.add_suffix(chooseStartBtn);

        startSoundRow.connect('notify::selected', () => {
            let idx = startSoundRow.get_selected();
            let opt = startSoundOptions[idx];
            if (opt.id === 'custom') {
                customStartRow.set_visible(true);
            } else {
                customStartRow.set_visible(false);
                settings.sound_start = opt.id;
                save();
            }
        });
        soundGroup.add(startSoundRow);
        soundGroup.add(customStartRow);

        // Stop-Sound
        let stopSoundOptions = [
            {id: 'default', name: 'Standard (System)'},
            {id: 'none', name: 'Kein Ton'},
            {id: 'custom', name: 'Eigene Datei...'},
        ];
        let stopSoundRow = new Adw.ComboRow({
            title: 'Stop-Ton',
            subtitle: 'Ton bei Aufnahme-Stop',
        });
        let stopSoundModel = new Gtk.StringList();
        let activeStopIdx = 0;
        stopSoundOptions.forEach((opt, idx) => {
            stopSoundModel.append(opt.name);
            if (opt.id === settings.sound_stop) activeStopIdx = idx;
            if (settings.sound_stop !== 'default' && settings.sound_stop !== 'none'
                && opt.id === 'custom') activeStopIdx = idx;
        });
        stopSoundRow.set_model(stopSoundModel);
        stopSoundRow.set_selected(activeStopIdx);

        let customStopRow = new Adw.ActionRow({
            title: 'Stop-Sound Datei',
            subtitle: (settings.sound_stop !== 'default' && settings.sound_stop !== 'none')
                ? settings.sound_stop : 'Keine Datei gewählt',
            visible: activeStopIdx === 2,
        });
        let chooseStopBtn = new Gtk.Button({label: 'Wählen...', valign: Gtk.Align.CENTER});
        chooseStopBtn.connect('clicked', () => {
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
                        settings.sound_stop = file.get_path();
                        customStopRow.set_subtitle(settings.sound_stop);
                        save();
                    }
                } catch (e) {
                    if (!_isDialogCancelled(e))
                        console.error(`JT Dictate: ${e}`);
                }
            });
        });
        customStopRow.add_suffix(chooseStopBtn);

        stopSoundRow.connect('notify::selected', () => {
            let idx = stopSoundRow.get_selected();
            let opt = stopSoundOptions[idx];
            if (opt.id === 'custom') {
                customStopRow.set_visible(true);
            } else {
                customStopRow.set_visible(false);
                settings.sound_stop = opt.id;
                save();
            }
        });
        soundGroup.add(stopSoundRow);
        soundGroup.add(customStopRow);

        // ─── Seite 4: Export/Import ───
        let dataPage = new Adw.PreferencesPage({
            title: 'Daten',
            icon_name: 'document-save-symbolic',
        });
        window.add(dataPage);

        // Settings Export/Import
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
                            // Nur bekannte Keys übernehmen
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

        // Theme Export/Import
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
            // Theme-relevante Keys extrahieren
            let themeData = {name: settings.active_theme || 'custom'};
            let themeKeys = [
                'pill_bg_color', 'pill_border_color', 'pill_border_width',
                'pill_blur', 'pill_shadow_intensity',
                'bar_color_left', 'bar_color_right', 'bar_gradient',
                'icon_color', 'recording_color', 'processing_color',
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

                            // Speichere als custom theme
                            _saveCustomTheme(themeId, themeData);

                            // Wende sofort an (nur Theme-relevante Keys)
                            let themeKeys = [
                                'pill_bg_color', 'pill_border_color', 'pill_border_width',
                                'pill_blur', 'pill_shadow_intensity',
                                'bar_color_left', 'bar_color_right', 'bar_gradient',
                                'icon_color', 'recording_color', 'processing_color',
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

        // Initialisierung abgeschlossen — ab jetzt lösen Widget-Änderungen saves aus
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
