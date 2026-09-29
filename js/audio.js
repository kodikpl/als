/**
 * Canvas audio visualizer + metadata for radio channels
 */
const AudioViz = (function () {
  let canvas = null;
  let ctx = null;
  let audioCtx = null;
  let analyser = null;
  let source = null;
  let dataArray = null;
  let animId = null;
  let active = false;
  let bars = 48;
  let connected = false;
  let metaTimer = null;
  let currentChannel = null;

  function init() {
    canvas = document.getElementById('visualizer');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    const w = parent ? parent.clientWidth : 1280;
    const h = parent ? parent.clientHeight : 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function start(videoEl, channel) {
    if (!Settings.get('visualizer')) return;
    if (!canvas || !ctx) init();
    stopAnimOnly();
    currentChannel = channel || null;

    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          active = true;
          canvas.classList.add('active');
          drawFallback();
          startMetaWatch(videoEl);
          return;
        }
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      bars = Math.min(48, analyser.frequencyBinCount);

      if (!connected && videoEl) {
        try {
          source = audioCtx.createMediaElementSource(videoEl);
          source.connect(analyser);
          analyser.connect(audioCtx.destination);
          connected = true;
        } catch (e) {
          // Already connected or CORS — decorative mode
          active = true;
          canvas.classList.add('active');
          drawFallback();
          startMetaWatch(videoEl);
          return;
        }
      }

      active = true;
      canvas.classList.add('active');
      draw();
      startMetaWatch(videoEl);
    } catch (e) {
      active = true;
      canvas.classList.add('active');
      drawFallback();
      startMetaWatch(videoEl);
    }
  }

  function startMetaWatch(videoEl) {
    if (metaTimer) clearInterval(metaTimer);
    updateMeta(videoEl);
    metaTimer = setInterval(() => updateMeta(videoEl), 2000);
  }

  function updateMeta(videoEl) {
    let text = '';
    // Try Media Session / audio tracks metadata
    try {
      if (navigator.mediaSession && navigator.mediaSession.metadata) {
        const md = navigator.mediaSession.metadata;
        const artist = md.artist || '';
        const title = md.title || '';
        if (artist && title) text = artist + ' — ' + title;
        else text = title || artist || '';
      }
    } catch (e) {}

    // Some browsers expose textTracks or audioTracks
    if (!text && videoEl) {
      try {
        if (videoEl.audioTracks && videoEl.audioTracks.length) {
          const t = videoEl.audioTracks[0];
          if (t && t.label) text = t.label;
        }
      } catch (e) {}
    }

    if (!text && currentChannel) {
      text = currentChannel.name || 'Radio';
    }

    if (window.Player && typeof Player.updateRadioText === 'function') {
      Player.updateRadioText(text);
    }
  }

  function stopAnimOnly() {
    active = false;
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    if (canvas) {
      canvas.classList.remove('active');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function stop() {
    stopAnimOnly();
    if (metaTimer) {
      clearInterval(metaTimer);
      metaTimer = null;
    }
    currentChannel = null;
  }

  function getAccentRgb() {
    const style = getComputedStyle(document.body);
    const accent = style.getPropertyValue('--accent').trim() || '#0078D7';
    // parse #RRGGBB
    if (accent.charAt(0) === '#' && accent.length >= 7) {
      return {
        r: parseInt(accent.slice(1, 3), 16),
        g: parseInt(accent.slice(3, 5), 16),
        b: parseInt(accent.slice(5, 7), 16)
      };
    }
    return { r: 0, g: 120, b: 215 };
  }

  function draw() {
    if (!active || !ctx) return;
    animId = requestAnimationFrame(draw);
    resize();

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, w, h);

    if (analyser && dataArray) {
      analyser.getByteFrequencyData(dataArray);
    }

    const accent = getAccentRgb();
    const barWidth = (w / bars) * 0.65;
    const gap = (w / bars) * 0.35;
    const maxH = h * 0.45;
    const baseY = h * 0.62;

    for (let i = 0; i < bars; i++) {
      let val = dataArray ? dataArray[i] / 255 : 0;
      val = Math.pow(val, 0.85);
      const barH = Math.max(3, val * maxH);
      const x = i * (barWidth + gap) + gap * 0.5 + (w - bars * (barWidth + gap)) / 2;
      const y = baseY - barH;

      const brightness = 0.55 + val * 0.45;
      const r = Math.min(255, Math.floor(accent.r * brightness));
      const g = Math.min(255, Math.floor(accent.g * brightness));
      const b = Math.min(255, Math.floor(accent.b * brightness));

      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(x, y, barWidth, barH);

      // soft reflection
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.18)';
      ctx.fillRect(x, baseY + 6, barWidth, barH * 0.25);
    }
  }

  function drawFallback() {
    if (!active || !ctx) return;
    animId = requestAnimationFrame(drawFallback);
    resize();

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, w, h);

    const t = Date.now() / 1000;
    const accent = getAccentRgb();
    const barWidth = (w / bars) * 0.65;
    const gap = (w / bars) * 0.35;
    const maxH = h * 0.4;
    const baseY = h * 0.62;
    const offset = (w - bars * (barWidth + gap)) / 2;

    for (let i = 0; i < bars; i++) {
      const val = 0.25 + 0.55 * Math.abs(Math.sin(t * 2.2 + i * 0.28)) *
        (0.6 + 0.4 * Math.abs(Math.sin(t * 0.7 + i * 0.1)));
      const barH = val * maxH;
      const x = i * (barWidth + gap) + gap * 0.5 + offset;
      const r = Math.min(255, Math.floor(accent.r * (0.5 + val * 0.5)));
      const g = Math.min(255, Math.floor(accent.g * (0.5 + val * 0.5)));
      const b = Math.min(255, Math.floor(accent.b * (0.5 + val * 0.5)));
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(x, baseY - barH, barWidth, barH);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.18)';
      ctx.fillRect(x, baseY + 6, barWidth, barH * 0.25);
    }
  }

  function isActive() {
    return active;
  }

  return { init, start, stop, isActive };
})();
