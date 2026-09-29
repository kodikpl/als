/**
 * Settings module — localStorage persistence
 */
const Settings = (function () {
  const KEY = 'iptv_metro_settings';
  const defaults = {
    forceFullscreen: false,
    autoHideInfoBar: true,
    infoBarTimeout: 5,
    autoNextOnError: false,
    autoNextDelay: 5,
    rememberLastChannel: true,
    autoPlayLastChannel: true,
    rememberVolume: true,
    startMuted: false,
    animations: true,
    animationIntensity: 1,
    visualizer: true,
    autoplay: true,
    showClock: true,
    showDate: true,
    showLogo: true,
    showEPG: true,
    defaultGroup: 'Wszystkie',
    sortBy: 'number', // number | name
    diagnostics: false,
    volume: 1,
    lastChannelId: null,
    lastChannelNumber: null,
    themeColor: 'blue'
  };

  let data = {};

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        data = Object.assign({}, defaults, JSON.parse(raw));
      } else {
        data = Object.assign({}, defaults);
      }
    } catch (e) {
      data = Object.assign({}, defaults);
    }
    // One-time migration: disable auto-next on error (v2)
    if (!data._migratedAutoNextOff) {
      data.autoNextOnError = false;
      data._migratedAutoNextOff = true;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    }
    applyAnimations();
    applyTheme();
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Settings save failed', e);
    }
  }

  function get(key) {
    return data[key] !== undefined ? data[key] : defaults[key];
  }

  function set(key, value) {
    data[key] = value;
    save();
    if (key === 'animations') applyAnimations();
    if (key === 'themeColor') applyTheme();
  }

  function toggle(key) {
    set(key, !get(key));
    return get(key);
  }

  function reset() {
    data = Object.assign({}, defaults);
    save();
    applyAnimations();
    applyTheme();
  }

  function applyAnimations() {
    if (data.animations) {
      document.body.classList.remove('no-anim');
    } else {
      document.body.classList.add('no-anim');
    }
  }

  function applyTheme() {
    const theme = data.themeColor || 'blue';
    document.body.setAttribute('data-theme', theme);
  }

  function getAll() {
    return Object.assign({}, data);
  }

  // Settings UI definition
  const uiSchema = [
    { key: 'forceFullscreen', label: 'Zawsze wymuszaj pełny ekran', type: 'toggle' },
    { key: 'autoHideInfoBar', label: 'Automatycznie ukrywaj pasek informacji', type: 'toggle' },
    { key: 'infoBarTimeout', label: 'Czas wyświetlania paska (s)', type: 'number', min: 2, max: 15, step: 1 },
    { key: 'autoNextOnError', label: 'Auto. następny kanał po błędzie', type: 'toggle' },
    { key: 'autoNextDelay', label: 'Opóźnienie auto. przełączenia (s)', type: 'number', min: 2, max: 30, step: 1 },
    { key: 'rememberLastChannel', label: 'Zapamiętaj ostatni kanał', type: 'toggle' },
    { key: 'autoPlayLastChannel', label: 'Automatycznie uruchom ostatni kanał', type: 'toggle' },
    { key: 'rememberVolume', label: 'Zapamiętaj głośność', type: 'toggle' },
    { key: 'startMuted', label: 'Start z wyciszeniem', type: 'toggle' },
    { key: 'animations', label: 'Włącz animacje', type: 'toggle' },
    { key: 'visualizer', label: 'Włącz visualizer audio', type: 'toggle' },
    { key: 'autoplay', label: 'Automatyczne odtwarzanie', type: 'toggle' },
    { key: 'showClock', label: 'Pokaż zegar', type: 'toggle' },
    { key: 'showDate', label: 'Pokaż datę', type: 'toggle' },
    { key: 'showLogo', label: 'Pokaż logo kanału', type: 'toggle' },
    { key: 'showEPG', label: 'Pokaż EPG', type: 'toggle' },
    { key: 'themeColor', label: 'Kolor motywu', type: 'select', options: [
      { value: 'blue', label: 'Niebieski' },
      { value: 'green', label: 'Zielony' },
      { value: 'orange', label: 'Pomarańczowy' },
      { value: 'purple', label: 'Fioletowy' },
      { value: 'red', label: 'Czerwony' },
      { value: 'teal', label: 'Turkusowy' },
      { value: 'pink', label: 'Różowy' }
    ]},
    { key: 'sortBy', label: 'Sortowanie kanałów', type: 'select', options: [
      { value: 'number', label: 'Według numeru' },
      { value: 'name', label: 'Alfabetycznie' }
    ]},
    { key: 'diagnostics', label: 'Tryb diagnostyczny', type: 'toggle' },
    { key: '_clearCache', label: 'Wyczyść cache playlisty', type: 'action' },
    { key: '_reset', label: 'Reset ustawień', type: 'action' }
  ];

  return {
    load, save, get, set, toggle, reset, getAll, uiSchema, defaults
  };
})();
