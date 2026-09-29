/**
 * Playlist parser & storage
 * Supports common IPTV M3U / M3U8 attributes
 */
const Playlist = (function () {
  const STORAGE_KEY = 'iptv_metro_playlist';
  const FAV_KEY = 'iptv_metro_favorites';

  let channels = [];
  let groups = ['Wszystkie', 'Ulubione'];
  let favorites = new Set();
  let currentGroup = 'Wszystkie';
  let rawSource = '';
  let sourceUrl = '';

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) favorites = new Set(JSON.parse(raw));
    } catch (e) {
      favorites = new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...favorites]));
    } catch (e) {}
  }

  function isFavorite(id) {
    return favorites.has(String(id));
  }

  function toggleFavorite(id) {
    const s = String(id);
    if (favorites.has(s)) favorites.delete(s);
    else favorites.add(s);
    saveFavorites();
    return favorites.has(s);
  }

  function loadFromStorage() {
    loadFavorites();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        channels = data.channels || [];
        groups = data.groups || ['Wszystkie', 'Ulubione'];
        rawSource = data.raw || '';
        sourceUrl = data.sourceUrl || '';
        return channels.length > 0;
      }
    } catch (e) {}
    return false;
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        channels,
        groups,
        raw: rawSource,
        sourceUrl: sourceUrl,
        savedAt: Date.now()
      }));
    } catch (e) {
      console.warn('Playlist save failed', e);
    }
  }

  function clearStorage() {
    localStorage.removeItem(STORAGE_KEY);
    channels = [];
    groups = ['Wszystkie', 'Ulubione'];
    rawSource = '';
    sourceUrl = '';
  }

  function getSourceUrl() {
    return sourceUrl;
  }

  function setSourceUrl(url) {
    sourceUrl = url || '';
  }

  /**
   * Refresh playlist from saved URL (if any)
   */
  async function refreshFromUrl() {
    if (!sourceUrl) return false;
    await loadFromUrl(sourceUrl);
    return true;
  }

  /**
   * Parse M3U content
   */
  function parse(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('Pusta lub nieprawidłowa zawartość M3U');
    }

    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const result = [];
    let current = null;
    let autoNum = 1;
    const groupSet = new Set(['Wszystkie', 'Ulubione']);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        current = {
          id: null,
          number: null,
          name: '',
          logo: '',
          group: 'Inne',
          url: '',
          tvgId: '',
          tvgName: '',
          duration: -1,
          isAudio: false,
          epg: null
        };

        // duration
        const durMatch = line.match(/#EXTINF:(-?\d+)/);
        if (durMatch) current.duration = parseInt(durMatch[1], 10);

        // attributes
        const attrRegex = /([\w-]+)="([^"]*)"/g;
        let m;
        while ((m = attrRegex.exec(line)) !== null) {
          const key = m[1].toLowerCase();
          const val = m[2].trim();
          if (key === 'tvg-id' || key === 'channel-id') current.tvgId = val;
          else if (key === 'tvg-name') current.tvgName = val;
          else if (key === 'tvg-logo' || key === 'logo') current.logo = val;
          else if (key === 'group-title') current.group = val || 'Inne';
          else if (key === 'tvg-chno' || key === 'channel-number' || key === 'chno') {
            const n = parseInt(val, 10);
            if (!isNaN(n)) current.number = n;
          }
        }

        // name after last comma
        const commaIdx = line.lastIndexOf(',');
        if (commaIdx !== -1) {
          current.name = line.substring(commaIdx + 1).trim() || current.tvgName || 'Kanał';
        } else {
          current.name = current.tvgName || 'Kanał';
        }

        // detect number at start of name e.g. "125. TVP Info"
        if (current.number === null) {
          const numMatch = current.name.match(/^(\d+)[\.\s\-]+(.+)/);
          if (numMatch) {
            current.number = parseInt(numMatch[1], 10);
            current.name = numMatch[2].trim();
          }
        }

        if (current.group) groupSet.add(current.group);

      } else if (line.startsWith('#EXTGRP:')) {
        if (current) {
          current.group = line.substring(8).trim() || current.group;
          groupSet.add(current.group);
        }
      } else if (line.startsWith('#')) {
        // other tags ignored
        continue;
      } else if (current && (line.startsWith('http') || line.startsWith('rtmp') || line.startsWith('udp') || line.startsWith('rtp'))) {
        current.url = line;
        if (current.number === null) {
          current.number = autoNum++;
        }
        current.id = current.tvgId || ('ch_' + current.number + '_' + result.length);
        // Pure radio/audio only — do NOT treat "music/muzyka" as audio
        // (those are often music video channels with image)
        const lowerName = (current.name + ' ' + current.group).toLowerCase();
        const lowerUrl = (current.url || '').toLowerCase();
        current.isAudio =
          /\b(radio|audio)\b/.test(lowerName) ||
          /\bfm\b|\bam\b/.test(lowerName) ||
          /\.(mp3|aac|ogg|m4a|opus)(\?|$)/i.test(lowerUrl) ||
          /\/radio\/|type=audio|audio[_-]?only/i.test(lowerUrl);
        result.push(current);
        current = null;
      }
    }

    if (result.length === 0) {
      throw new Error('Nie znaleziono kanałów w playliście M3U');
    }

    // sort
    result.sort((a, b) => (a.number || 0) - (b.number || 0));

    channels = result;
    groups = Array.from(groupSet);
    // ensure order
    const preferred = ['Wszystkie', 'Ulubione'];
    groups = preferred.concat(groups.filter(g => !preferred.includes(g)).sort());
    rawSource = content;
    saveToStorage();
    return channels;
  }

  async function loadFromUrl(url) {
    if (!url || !url.trim()) throw new Error('Podaj URL playlisty');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url.trim(), { signal: controller.signal, mode: 'cors' });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('Błąd sieci: HTTP ' + res.status);
      const text = await res.text();
      sourceUrl = url.trim();
      return parse(text);
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error('Timeout ładowania playlisty');
      if (e.message && e.message.includes('Failed to fetch')) {
        throw new Error('Błąd CORS lub sieć. Użyj opcji Wklej lub Plik.');
      }
      throw e;
    }
  }

  function loadFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('Nie wybrano pliku'));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(parse(reader.result));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error('Błąd odczytu pliku'));
      reader.readAsText(file);
    });
  }

  function getChannels(group) {
    let list = channels;
    if (group === 'Ulubione') {
      list = channels.filter(c => isFavorite(c.id));
    } else if (group && group !== 'Wszystkie') {
      list = channels.filter(c => c.group === group);
    }
    const sortBy = Settings.get('sortBy');
    if (sortBy === 'name') {
      list = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    } else {
      list = list.slice().sort((a, b) => (a.number || 0) - (b.number || 0));
    }
    return list;
  }

  function getByNumber(num) {
    return channels.find(c => c.number === num) || null;
  }

  function getById(id) {
    return channels.find(c => c.id === id) || null;
  }

  function getIndex(id, group) {
    const list = getChannels(group || currentGroup);
    return list.findIndex(c => c.id === id);
  }

  function getNext(id, group) {
    const list = getChannels(group || currentGroup);
    if (!list.length) return null;
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return list[0];
    return list[(idx + 1) % list.length];
  }

  function getPrev(id, group) {
    const list = getChannels(group || currentGroup);
    if (!list.length) return null;
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return list[0];
    return list[(idx - 1 + list.length) % list.length];
  }

  function setCurrentGroup(g) {
    currentGroup = g || 'Wszystkie';
  }

  function getCurrentGroup() {
    return currentGroup;
  }

  function getGroups() {
    return groups;
  }

  function getAll() {
    return channels;
  }

  function count() {
    return channels.length;
  }

  return {
    parse,
    loadFromUrl,
    loadFromFile,
    loadFromStorage,
    saveToStorage,
    clearStorage,
    getSourceUrl,
    setSourceUrl,
    refreshFromUrl,
    getChannels,
    getByNumber,
    getById,
    getNext,
    getPrev,
    getIndex,
    setCurrentGroup,
    getCurrentGroup,
    getGroups,
    getAll,
    count,
    isFavorite,
    toggleFavorite,
    loadFavorites
  };
})();
