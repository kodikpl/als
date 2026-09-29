/**
 * IPTV Player Metro — Main Application
 * Optimized for Smart TV remote control
 */
(function () {
  'use strict';

  // State
  let currentChannel = null;
  let osdTimer = null;
  let clockTimer = null;
  let panelStack = [];
  let listRenderOffset = 0;
  let listVisibleCount = 20;

  // DOM refs
  const $ = (id) => document.getElementById(id);

  function init() {
    Settings.load();
    Playlist.loadFromStorage();
    AudioViz.init();

    const video = $('video');
    Player.init(video, {
      onChannelChange: onChannelChange,
      onPlaying: onPlaying,
      onError: onPlayerError,
      onAutoNext: () => changeChannel(1),
      onEnded: function () {
        // reload handled inside Player
      }
    });

    Remote.init({
      up: () => handleNav('up'),
      down: () => handleNav('down'),
      left: () => handleNav('left'),
      right: () => handleNav('right'),
      enter: () => handleEnter(),
      back: () => handleBack(),
      playpause: () => Player.togglePlayPause(),
      channelNumber: (num) => jumpToChannel(num),
      action: (name, el) => handleAction(name, el)
    });

    bindUI();
    startClock();
    updateDiagnostics();

    // Refresh playlist from URL on every start, then restore channel
    startupLoad();

    if (Settings.get('forceFullscreen')) {
      document.addEventListener('keydown', tryFullscreenOnce, { once: true });
    }
  }

  async function startupLoad() {
    const hasCached = Playlist.count() > 0;
    const url = Playlist.getSourceUrl();

    if (url) {
      Player.setLoading(true);
      try {
        await Playlist.refreshFromUrl();
      } catch (e) {
        console.warn('Playlist refresh failed, using cache', e);
        // keep cached channels
      }
      Player.setLoading(false);
    }

    if (Playlist.count() === 0) {
      showEmptyState();
      return;
    }

    hideEmptyState();
    if (Settings.get('autoPlayLastChannel')) {
      const lastId = Settings.get('lastChannelId');
      const ch = lastId ? Playlist.getById(lastId) : Playlist.getAll()[0];
      if (ch) {
        playChannel(ch);
      } else {
        showChannelList();
      }
    } else {
      showChannelList();
    }
  }

  function tryFullscreenOnce() {
    Player.requestFullscreen();
  }

  function bindUI() {
    // Global delegated click for any [data-action] (mouse / touch / TV pointer)
    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.getAttribute('data-action');
      if (action) {
        e.preventDefault();
        handleAction(action, actionEl);
      }
    });

    // Playlist tabs (data-tab, not data-action)
    document.querySelectorAll('.playlist-tabs .metro-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tab = btn.getAttribute('data-tab');
        if (tab) switchPlaylistTab(tab);
      });
    });

    // File input
    const fileInput = $('playlist-file');
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files[0]) {
          await loadPlaylistFile(fileInput.files[0]);
        }
      });
    }
  }

  // ========== NAVIGATION ==========
  function handleNav(dir) {
    const ctx = Remote.getContext();
    if (ctx === 'player') {
      if (dir === 'up') changeChannel(1);
      else if (dir === 'down') changeChannel(-1);
      else if (dir === 'left' || dir === 'right') {
        // optional volume or do nothing
      }
      return;
    }
    if (ctx === 'menu') {
      Remote.moveGrid(dir, 4);
      return;
    }
    if (ctx === 'channels') {
      if (dir === 'left' || dir === 'right') {
        // switch group tabs
        moveGroupTab(dir === 'right' ? 1 : -1);
      } else {
        Remote.move(dir === 'up' ? 'prev' : 'next');
      }
      return;
    }
    if (ctx === 'settings' || ctx === 'playlist' || ctx === 'epg' || ctx === 'about' || ctx === 'error') {
      Remote.move(dir === 'up' || dir === 'left' ? 'prev' : 'next');
      return;
    }
  }

  function handleEnter() {
    const ctx = Remote.getContext();
    if (ctx === 'player') {
      if (isPanelOpen('menu')) {
        closePanel('menu');
      } else {
        showMenu();
      }
      return;
    }
    if (ctx === 'channels') {
      const el = Remote.getFocused();
      if (el && el.dataset.id) {
        const ch = Playlist.getById(el.dataset.id);
        if (ch) {
          playChannel(ch);
          closeAllPanels();
        }
      }
      return;
    }
    if (ctx === 'settings') {
      const el = Remote.getFocused();
      if (el && el.dataset.key) {
        const item = Settings.uiSchema.find(s => s.key === el.dataset.key);
        if (item) activateSetting(item);
      }
      return;
    }
    if (ctx === 'playlist') {
      const el = Remote.getFocused();
      if (!el) return;
      // Tab switch
      const tab = el.getAttribute('data-tab');
      if (tab) {
        switchPlaylistTab(tab);
        focusPlaylistSettings();
        return;
      }
      // data-action buttons
      const action = el.getAttribute('data-action');
      if (action) {
        handleAction(action, el);
        return;
      }
      // Input / textarea → save active pane
      const tag = el.tagName ? el.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (el.type === 'file') {
          el.click();
          return;
        }
        const activePane = document.querySelector('.playlist-pane.active');
        if (activePane) {
          if (activePane.id === 'pane-url') handleAction('save-url');
          else if (activePane.id === 'pane-paste') handleAction('save-paste');
          else if (activePane.id === 'pane-file') handleAction('save-file');
        }
        return;
      }
      Remote.activateFocused();
      return;
    }
    if (ctx === 'empty' || ctx === 'menu' || ctx === 'about' || ctx === 'error') {
      Remote.activateFocused();
      return;
    }
    if (ctx === 'epg') {
      handleBack();
    }
  }

  function handleBack() {
    Remote.clearChannelInput();
    const ctx = Remote.getContext();

    // Error overlay is not a panel — Back returns focus to player
    if (ctx === 'error') {
      Remote.setContext('player', []);
      return;
    }

    if (panelStack.length > 0) {
      const top = panelStack[panelStack.length - 1];
      closePanel(top);
      // If no playlist and nothing left open → show empty state again
      if (panelStack.length === 0 && Playlist.count() === 0) {
        showEmptyState();
      }
      return;
    }
    if (isPanelOpen('menu')) {
      closePanel('menu');
      return;
    }
    if (Playlist.count() === 0) {
      showEmptyState();
    }
  }

  function handleAction(name) {
    switch (name) {
      case 'channels':
        showChannelList();
        break;
      case 'favorites':
        Playlist.setCurrentGroup('Ulubione');
        showChannelList();
        break;
      case 'playlists':
        showPlaylistSettings();
        break;
      case 'epg':
        showEPG();
        break;
      case 'settings':
        showSettings();
        break;
      case 'audio':
        Playlist.setCurrentGroup('Ulubione'); // or filter audio
        showChannelList();
        break;
      case 'fullscreen':
        Player.requestFullscreen();
        closePanel('menu');
        break;
      case 'about':
        showAbout();
        break;
      case 'close-about':
        closePanel('about');
        break;
      case 'open-playlist':
        showPlaylistSettings();
        break;
      case 'save-url':
        savePlaylistUrl();
        break;
      case 'save-paste':
        savePlaylistPaste();
        break;
      case 'save-file':
        const fi = $('playlist-file');
        if (fi && fi.files[0]) loadPlaylistFile(fi.files[0]);
        break;
      case 'clear-playlist':
        Playlist.clearStorage();
        Player.stop();
        currentChannel = null;
        showEmptyState();
        closeAllPanels();
        break;
      case 'retry':
        Player.retry();
        break;
      case 'next-channel':
        changeChannel(1);
        break;
      default:
        break;
    }
  }

  // ========== CHANNELS ==========
  function playChannel(ch) {
    if (!ch) return;
    currentChannel = ch;
    Player.playChannel(ch);
    updateOSD(ch);
    showOSD();
    Remote.setContext('player', []);
  }

  function changeChannel(delta) {
    if (!currentChannel) {
      const list = Playlist.getChannels(Playlist.getCurrentGroup());
      if (list.length) playChannel(list[0]);
      return;
    }
    const next = delta > 0
      ? Playlist.getNext(currentChannel.id)
      : Playlist.getPrev(currentChannel.id);
    if (next) playChannel(next);
  }

  function jumpToChannel(num) {
    const ch = Playlist.getByNumber(num);
    if (ch) {
      playChannel(ch);
      closeAllPanels();
    } else {
      // show brief message via OSD
      const osdNum = $('osd-number');
      if (osdNum) {
        osdNum.textContent = num;
        showOSD();
      }
    }
  }

  function onChannelChange(ch) {
    updateOSD(ch);
  }

  function onPlaying(ch) {
    Player.setLoading(false);
  }

  function onPlayerError(err, ch) {
    // No action buttons — stay on player context (OK opens menu, Up/Down changes channel)
    Remote.setContext('player', []);
  }

  // ========== OSD ==========
  function updateOSD(ch) {
    if (!ch) return;
    const num = $('osd-number');
    const name = $('osd-name');
    const logo = $('osd-logo');
    if (num) num.textContent = ch.number != null ? ch.number : '—';
    if (name) name.textContent = ch.name || '—';
    if (logo) {
      if (ch.logo && Settings.get('showLogo')) {
        logo.style.backgroundImage = 'url("' + String(ch.logo).replace(/"/g, '') + '")';
        logo.classList.remove('placeholder');
      } else {
        logo.style.backgroundImage = '';
        logo.classList.add('placeholder');
      }
    }
    EPG.renderOSD(ch);
  }

  function showOSD() {
    const osd = $('osd');
    if (!osd) return;
    osd.classList.remove('hidden');
    // reflow for transition
    void osd.offsetWidth;
    osd.classList.add('visible');
    if (osdTimer) clearTimeout(osdTimer);
    if (Settings.get('autoHideInfoBar')) {
      const t = (Settings.get('infoBarTimeout') || 5) * 1000;
      osdTimer = setTimeout(() => {
        osd.classList.remove('visible');
      }, t);
    }
  }

  function hideOSD() {
    const osd = $('osd');
    if (osd) osd.classList.remove('visible');
    if (osdTimer) {
      clearTimeout(osdTimer);
      osdTimer = null;
    }
  }

  // ========== CLOCK ==========
  function startClock() {
    function tick() {
      const now = new Date();
      const hh = pad(now.getHours());
      const mm = pad(now.getMinutes());
      const ss = pad(now.getSeconds());
      const dd = pad(now.getDate());
      const mo = pad(now.getMonth() + 1);
      const yyyy = now.getFullYear();
      const timeStr = hh + ':' + mm + ':' + ss;
      const dateStr = dd + '.' + mo + '.' + yyyy;

      const ot = $('osd-time');
      const od = $('osd-date');
      if (Settings.get('showClock')) {
        if (ot) ot.textContent = timeStr;
      } else if (ot) {
        ot.textContent = '';
      }
      if (Settings.get('showDate')) {
        if (od) od.textContent = dateStr;
      } else if (od) {
        od.textContent = '';
      }
    }
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // ========== PANELS ==========
  function openPanel(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('hidden');
    // force reflow
    void el.offsetWidth;
    el.classList.add('visible');
    if (panelStack.indexOf(id) === -1) panelStack.push(id);
  }

  function closePanel(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('visible');
    setTimeout(() => {
      el.classList.add('hidden');
    }, Settings.get('animations') ? 260 : 0);
    panelStack = panelStack.filter(p => p !== id);
    // restore focus context
    if (panelStack.length === 0) {
      Remote.setContext('player', []);
    } else {
      const top = panelStack[panelStack.length - 1];
      // re-init focus for top panel roughly
      if (top === 'menu') focusMenu();
      else if (top === 'channels') focusChannelList();
      else if (top === 'settings') focusSettings();
    }
  }

  function closeAllPanels() {
    panelStack.slice().forEach(closePanel);
    panelStack = [];
    Remote.setContext('player', []);
  }

  function isPanelOpen(id) {
    const el = $(id);
    return el && el.classList.contains('visible');
  }

  function showEmptyState() {
    const el = $('empty-state');
    if (el) {
      el.classList.remove('hidden');
      void el.offsetWidth;
      el.classList.add('visible');
      if (panelStack.indexOf('empty-state') === -1) panelStack.push('empty-state');
    }
    const btn = document.querySelector('#empty-state [data-action="open-playlist"]');
    if (btn) {
      btn.classList.add('focused');
    }
    Remote.setContext('empty', btn ? [btn] : []);
  }

  function hideEmptyState() {
    const el = $('empty-state');
    if (el) {
      el.classList.remove('visible');
      el.classList.add('hidden');
    }
    panelStack = panelStack.filter(p => p !== 'empty-state');
  }

  // ========== MENU ==========
  function showMenu() {
    closeAllPanels();
    hideOSD();
    openPanel('menu');
    focusMenu();
  }

  function focusMenu() {
    const tiles = Array.from(document.querySelectorAll('#menu-tiles .tile'));
    Remote.setContext('menu', tiles);
    Remote.setFocusIndex(0);
  }

  // ========== CHANNEL LIST ==========
  function showChannelList() {
    openPanel('channel-list');
    renderGroupTabs();
    renderChannelList();
    focusChannelList();
  }

  function renderGroupTabs() {
    const container = $('group-tabs');
    if (!container) return;
    const groups = Playlist.getGroups();
    const current = Playlist.getCurrentGroup();
    container.innerHTML = '';
    groups.forEach(g => {
      const btn = document.createElement('button');
      btn.className = 'group-tab' + (g === current ? ' active' : '');
      btn.textContent = g;
      btn.dataset.group = g;
      btn.addEventListener('click', () => {
        Playlist.setCurrentGroup(g);
        renderGroupTabs();
        renderChannelList();
        focusChannelList();
      });
      container.appendChild(btn);
    });
  }

  function moveGroupTab(delta) {
    const groups = Playlist.getGroups();
    let idx = groups.indexOf(Playlist.getCurrentGroup());
    idx = (idx + delta + groups.length) % groups.length;
    Playlist.setCurrentGroup(groups[idx]);
    renderGroupTabs();
    renderChannelList();
    focusChannelList();
  }

  function renderChannelList() {
    const container = $('channel-list-items');
    if (!container) return;
    const list = Playlist.getChannels(Playlist.getCurrentGroup());
    const title = $('channel-list-title');
    if (title) {
      title.textContent = Playlist.getCurrentGroup() + ' (' + list.length + ')';
    }

    // virtual-ish: render all for typical IPTV sizes (<2000); for huge lists could window
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((ch, i) => {
      const item = document.createElement('div');
      item.className = 'channel-item';
      if (currentChannel && currentChannel.id === ch.id) item.classList.add('playing');
      item.dataset.id = ch.id;
      item.dataset.index = i;

      const num = document.createElement('div');
      num.className = 'ch-num';
      num.textContent = ch.number != null ? ch.number : '';

      const logo = document.createElement('div');
      logo.className = 'ch-logo channel-logo';
      if (ch.logo) {
        logo.style.backgroundImage = 'url("' + String(ch.logo).replace(/"/g, '') + '")';
      } else {
        logo.classList.add('placeholder');
      }

      const info = document.createElement('div');
      info.className = 'ch-info';
      const name = document.createElement('div');
      name.className = 'ch-name';
      name.textContent = ch.name || 'Kanał';
      const epg = document.createElement('div');
      epg.className = 'ch-epg';
      epg.textContent = ch.group || '';
      info.appendChild(name);
      info.appendChild(epg);

      const fav = document.createElement('div');
      fav.className = 'ch-fav' + (Playlist.isFavorite(ch.id) ? ' active' : '');
      fav.title = 'Ulubione';
      fav.addEventListener('click', (e) => {
        e.stopPropagation();
        Playlist.toggleFavorite(ch.id);
        fav.classList.toggle('active', Playlist.isFavorite(ch.id));
      });

      item.appendChild(num);
      item.appendChild(logo);
      item.appendChild(info);
      item.appendChild(fav);

      item.addEventListener('click', () => {
        playChannel(ch);
        closeAllPanels();
      });

      // long-press or secondary for fav — on TV we can use a color button later
      frag.appendChild(item);
    });
    container.appendChild(frag);
  }

  function focusChannelList() {
    const items = Array.from(document.querySelectorAll('#channel-list-items .channel-item'));
    Remote.setContext('channels', items);
    // focus current playing
    if (currentChannel) {
      const idx = items.findIndex(el => el.dataset.id === currentChannel.id);
      if (idx >= 0) Remote.setFocusIndex(idx);
    }
  }

  // ========== SETTINGS ==========
  function showSettings() {
    openPanel('settings');
    renderSettings();
    focusSettings();
  }

  function renderSettings() {
    const container = $('settings-content');
    if (!container) return;
    container.innerHTML = '';
    Settings.uiSchema.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'setting-row';
      row.dataset.key = item.key;
      row.dataset.type = item.type;
      row.dataset.index = idx;

      const label = document.createElement('div');
      label.className = 'setting-label';
      label.textContent = item.label;

      const valueWrap = document.createElement('div');
      valueWrap.className = 'setting-value';

      if (item.type === 'toggle') {
        const toggle = document.createElement('div');
        toggle.className = 'setting-toggle' + (Settings.get(item.key) ? ' on' : '');
        valueWrap.appendChild(toggle);
      } else if (item.type === 'number') {
        valueWrap.textContent = Settings.get(item.key);
      } else if (item.type === 'select') {
        const opt = item.options.find(o => o.value === Settings.get(item.key));
        valueWrap.textContent = opt ? opt.label : Settings.get(item.key);
      } else if (item.type === 'action') {
        valueWrap.textContent = '›';
      }

      row.appendChild(label);
      row.appendChild(valueWrap);

      row.addEventListener('click', () => activateSetting(item));
      container.appendChild(row);
    });
  }

  function focusSettings() {
    const rows = Array.from(document.querySelectorAll('#settings-content .setting-row'));
    Remote.setContext('settings', rows);
  }

  function activateSetting(item) {
    if (item.type === 'toggle') {
      Settings.toggle(item.key);
      renderSettings();
      focusSettings();
      if (item.key === 'diagnostics') updateDiagnostics();
    } else if (item.type === 'number') {
      let v = Settings.get(item.key);
      v += (item.step || 1);
      if (v > item.max) v = item.min;
      Settings.set(item.key, v);
      renderSettings();
      focusSettings();
    } else if (item.type === 'select') {
      const opts = item.options;
      let idx = opts.findIndex(o => o.value === Settings.get(item.key));
      idx = (idx + 1) % opts.length;
      Settings.set(item.key, opts[idx].value);
      renderSettings();
      focusSettings();
    } else if (item.key === '_clearCache') {
      Playlist.clearStorage();
      alertSafe('Cache playlisty wyczyszczony');
    } else if (item.key === '_reset') {
      Settings.reset();
      renderSettings();
      focusSettings();
      alertSafe('Ustawienia zresetowane');
    }
  }

  // ========== PLAYLIST SETTINGS ==========
  function showPlaylistSettings() {
    // Empty state has higher z-index — hide it so playlist panel is usable
    hideEmptyState();
    openPanel('playlist-settings');
    switchPlaylistTab('url');
    const urlInput = $('playlist-url');
    if (urlInput && Playlist.getSourceUrl()) {
      urlInput.value = Playlist.getSourceUrl();
    }
    focusPlaylistSettings();
  }

  function focusPlaylistSettings() {
    // Tabs + primary buttons + active pane inputs
    const tabs = Array.from(document.querySelectorAll('.playlist-tabs .metro-btn'));
    const activePane = document.querySelector('.playlist-pane.active');
    const paneBtns = activePane
      ? Array.from(activePane.querySelectorAll('.metro-btn, input[type="text"], textarea, input[type="file"]'))
      : [];
    const clearBtn = document.querySelector('#playlist-settings [data-action="clear-playlist"]');
    const focusables = tabs.concat(paneBtns);
    if (clearBtn) focusables.push(clearBtn);
    Remote.setContext('playlist', focusables);
  }

  function switchPlaylistTab(tab) {
    document.querySelectorAll('.playlist-tabs .metro-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.playlist-pane').forEach(p => {
      p.classList.toggle('active', p.id === 'pane-' + tab);
    });
    // Refresh focus list for new pane
    if (Remote.getContext() === 'playlist') {
      focusPlaylistSettings();
    }
  }

  async function savePlaylistUrl() {
    const input = $('playlist-url');
    const url = input ? input.value.trim() : '';
    if (!url) {
      alertSafe('Podaj URL');
      return;
    }
    Player.setLoading(true);
    try {
      await Playlist.loadFromUrl(url);
      hideEmptyState();
      closeAllPanels();
      const first = Playlist.getAll()[0];
      if (first) playChannel(first);
      alertSafe('Playlista wczytana: ' + Playlist.count() + ' kanałów');
    } catch (e) {
      alertSafe(e.message || 'Błąd ładowania');
    } finally {
      Player.setLoading(false);
    }
  }

  async function savePlaylistPaste() {
    const ta = $('playlist-paste');
    const content = ta ? ta.value : '';
    if (!content.trim()) {
      alertSafe('Wklej zawartość M3U');
      return;
    }
    Player.setLoading(true);
    try {
      Playlist.parse(content);
      hideEmptyState();
      closeAllPanels();
      const first = Playlist.getAll()[0];
      if (first) playChannel(first);
      alertSafe('Playlista wczytana: ' + Playlist.count() + ' kanałów');
    } catch (e) {
      alertSafe(e.message || 'Błąd parsowania');
    } finally {
      Player.setLoading(false);
    }
  }

  async function loadPlaylistFile(file) {
    Player.setLoading(true);
    try {
      await Playlist.loadFromFile(file);
      hideEmptyState();
      closeAllPanels();
      const first = Playlist.getAll()[0];
      if (first) playChannel(first);
      alertSafe('Playlista wczytana: ' + Playlist.count() + ' kanałów');
    } catch (e) {
      alertSafe(e.message || 'Błąd pliku');
    } finally {
      Player.setLoading(false);
    }
  }

  // ========== EPG / ABOUT ==========
  function showEPG() {
    openPanel('epg-screen');
    EPG.renderScreen(currentChannel);
    const closeBtn = document.createElement('button');
    // simple focus
    Remote.setContext('epg', []);
  }

  function showAbout() {
    openPanel('about');
    const btn = document.querySelector('#about [data-action="close-about"]');
    Remote.setContext('about', btn ? [btn] : []);
  }

  // ========== DIAGNOSTICS ==========
  function updateDiagnostics() {
    const el = $('diagnostics');
    const content = $('diag-content');
    if (!el || !content) return;
    if (!Settings.get('diagnostics')) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    setInterval(() => {
      if (!Settings.get('diagnostics')) return;
      const d = Player.getDiagnostics();
      content.textContent = JSON.stringify(d, null, 2);
    }, 1000);
  }

  function alertSafe(msg) {
    console.log('[IPTV]', msg);
    // Toast overlay (works even without a playing channel)
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.9);color:#fff;padding:16px 28px;font-size:20px;z-index:9999;border-left:4px solid #0078D7;max-width:80%;text-align:center;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
  }

  // Favorite toggle from channel list via key (optional)
  // Color buttons could map later

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
