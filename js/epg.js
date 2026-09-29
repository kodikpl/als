/**
 * EPG helper — basic support
 * Full XMLTV would require external source; here we only show data
 * that may be attached to channel or leave empty gracefully.
 */
const EPG = (function () {
  // Optional: future XMLTV cache
  let cache = {};

  function getNowNext(channel) {
    if (!channel) return { now: null, next: null };
    // If channel has inline epg (rare in pure M3U)
    if (channel.epg && channel.epg.now) {
      return channel.epg;
    }
    return { now: null, next: null };
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function progress(now) {
    if (!now || !now.start || !now.end) return 0;
    const t = Date.now();
    const s = now.start;
    const e = now.end;
    if (t <= s) return 0;
    if (t >= e) return 100;
    return Math.round(((t - s) / (e - s)) * 100);
  }

  function renderOSD(channel) {
    const nowEl = document.getElementById('osd-now');
    const nextEl = document.getElementById('osd-next');
    const progEl = document.getElementById('osd-progress');
    if (!Settings.get('showEPG')) {
      if (nowEl) nowEl.textContent = '';
      if (nextEl) nextEl.textContent = '';
      if (progEl) progEl.style.width = '0%';
      return;
    }
    const { now, next } = getNowNext(channel);
    if (nowEl) {
      nowEl.textContent = now ? ('Teraz: ' + now.title + (now.start ? '  ' + formatTime(now.start) : '')) : '';
    }
    if (nextEl) {
      nextEl.textContent = next ? ('Następnie: ' + next.title + (next.start ? '  ' + formatTime(next.start) : '')) : '';
    }
    if (progEl) {
      progEl.style.width = progress(now) + '%';
    }
  }

  function renderScreen(channel) {
    const container = document.getElementById('epg-content');
    if (!container) return;
    const { now, next } = getNowNext(channel);
    if (!now && !next) {
      container.innerHTML = '<p style="color:#a0a0a0;font-size:20px;padding:24px 0;">Brak danych EPG dla tego kanału.</p>';
      return;
    }
    let html = '';
    if (now) {
      html += '<div class="epg-item"><div class="epg-title">Teraz: ' + escapeHtml(now.title) + '</div>';
      html += '<div class="epg-time">' + formatTime(now.start) + ' – ' + formatTime(now.end) + '</div></div>';
    }
    if (next) {
      html += '<div class="epg-item"><div class="epg-title">Następnie: ' + escapeHtml(next.title) + '</div>';
      html += '<div class="epg-time">' + formatTime(next.start) + ' – ' + formatTime(next.end) + '</div></div>';
    }
    container.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    getNowNext,
    renderOSD,
    renderScreen,
    progress
  };
})();
