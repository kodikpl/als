/**
 * Video / Audio player module
 * - 3 retries every 1s on error
 * - reload on ended
 * - channel switch animation
 */
const Player = (function () {
  let video = null;
  let currentChannel = null;
  let loadTimeout = null;
  let errorAutoNextTimer = null;
  let retryTimer = null;
  let isLoading = false;
  let lastError = null;
  let loadStartTime = 0;
  let playStartTime = 0;
  let onStateChange = null;
  let retryCount = 0;
  let intentionalStop = false;

  const STREAM_TIMEOUT = 25000;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;

  function init(videoEl, callbacks) {
    video = videoEl;
    onStateChange = callbacks || {};

    video.addEventListener('loadstart', () => {
      loadStartTime = Date.now();
      setLoading(true);
      hideError();
    });

    video.addEventListener('loadeddata', () => {
      setLoading(false);
      endSwitchAnim();
    });

    video.addEventListener('canplay', () => {
      setLoading(false);
      playStartTime = Date.now();
      retryCount = 0;
      endSwitchAnim();
      if (onStateChange.onPlaying) onStateChange.onPlaying(currentChannel);
    });

    video.addEventListener('playing', () => {
      setLoading(false);
      hideError();
      retryCount = 0;
      endSwitchAnim();
      if (onStateChange.onPlaying) onStateChange.onPlaying(currentChannel);
      // detect audio-only after playing
      checkAudioMode();
    });

    video.addEventListener('waiting', () => {
      if (!intentionalStop) setLoading(true);
    });

    video.addEventListener('error', () => {
      if (intentionalStop) return;
      setLoading(false);
      const err = video.error;
      let code = err ? err.code : 0;
      let msg = 'BŁĄD ODTWARZANIA';
      if (code === 1) msg = 'ABORTED';
      else if (code === 2) msg = 'BŁĄD SIECI';
      else if (code === 3) msg = 'BŁĄD DEKODOWANIA';
      else if (code === 4) msg = 'FORMAT NIEOBSŁUGIWANY';
      lastError = { code, message: msg, mediaError: err };
      handleStreamFailure(msg + (code ? ' ' + code : ''));
    });

    video.addEventListener('ended', () => {
      // Stream ended → reload same channel
      if (currentChannel) {
        retryCount = 0;
        playChannel(currentChannel, { silent: true, isReload: true });
      }
      if (onStateChange.onEnded) onStateChange.onEnded(currentChannel);
    });

    // Media metadata (song title for radio)
    video.addEventListener('loadedmetadata', () => {
      checkAudioMode();
    });

    if (Settings.get('rememberVolume')) {
      video.volume = Settings.get('volume');
    }
    if (Settings.get('startMuted')) {
      video.muted = true;
    }

    video.addEventListener('volumechange', () => {
      if (Settings.get('rememberVolume') && !video.muted) {
        Settings.set('volume', video.volume);
      }
    });
  }

  function handleStreamFailure(text) {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      setLoading(true);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (currentChannel) {
          loadSource(currentChannel.url);
        }
      }, RETRY_DELAY);
      return;
    }
    // Exhausted retries
    endSwitchAnim();
    showError(text || 'BRAK SYGNAŁU');
    if (onStateChange.onError) onStateChange.onError(lastError, currentChannel);
    scheduleAutoNext();
  }

  function setLoading(v) {
    isLoading = v;
    const el = document.getElementById('loader');
    if (el) {
      if (v) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }
  }

  function showError(text) {
    const overlay = document.getElementById('error-overlay');
    const ticker = document.getElementById('error-text');
    if (overlay && ticker) {
      ticker.textContent = text || 'BRAK SYGNAŁU';
      overlay.classList.remove('hidden');
    }
    if (window.AudioViz) AudioViz.stop();
    hideRadioOverlay();
  }

  function hideError() {
    const overlay = document.getElementById('error-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (errorAutoNextTimer) {
      clearTimeout(errorAutoNextTimer);
      errorAutoNextTimer = null;
    }
  }

  function scheduleAutoNext() {
    if (!Settings.get('autoNextOnError')) return;
    if (errorAutoNextTimer) clearTimeout(errorAutoNextTimer);
    const delay = (Settings.get('autoNextDelay') || 5) * 1000;
    errorAutoNextTimer = setTimeout(() => {
      if (onStateChange.onAutoNext) onStateChange.onAutoNext();
    }, delay);
  }

  function startSwitchAnim() {
    if (!Settings.get('animations')) return;
    const videoEl = video;
    const flash = document.getElementById('channel-transition');
    if (videoEl) videoEl.classList.add('switching');
    if (flash) {
      flash.classList.remove('hidden');
      flash.classList.add('active');
    }
  }

  function endSwitchAnim() {
    const videoEl = video;
    const flash = document.getElementById('channel-transition');
    if (videoEl) videoEl.classList.remove('switching');
    if (flash) {
      flash.classList.remove('active');
      setTimeout(() => flash.classList.add('hidden'), 250);
    }
  }

  function loadSource(url) {
    intentionalStop = true;
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (e) {}
    intentionalStop = false;

    video.src = url;
    video.load();

    if (Settings.get('autoplay')) {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          setLoading(false);
        });
      }
    }
  }

  function playChannel(channel, opts) {
    opts = opts || {};
    if (!channel || !channel.url) {
      showError('BRAK URL STREAMU');
      return;
    }

    if (loadTimeout) clearTimeout(loadTimeout);
    if (retryTimer) clearTimeout(retryTimer);
    hideError();
    setLoading(true);

    if (!opts.isReload) {
      retryCount = 0;
      startSwitchAnim();
    }

    currentChannel = channel;
    if (window.AudioViz) AudioViz.stop();
    hideRadioOverlay();

    loadSource(channel.url);

    // timeout for initial load (after retries still applies per attempt roughly)
    loadTimeout = setTimeout(() => {
      if (isLoading && video.readyState < 2) {
        lastError = { code: 'TIMEOUT', message: 'TIMEOUT ŁADOWANIA' };
        handleStreamFailure('TIMEOUT ŁADOWANIA STREAMU');
      }
    }, STREAM_TIMEOUT);

    if (Settings.get('rememberLastChannel')) {
      Settings.set('lastChannelId', channel.id);
      Settings.set('lastChannelNumber', channel.number);
    }

    // audio detection
    setTimeout(() => checkAudioMode(), 1500);

    if (!opts.silent && onStateChange.onChannelChange) {
      onStateChange.onChannelChange(channel);
    }
  }

  function isPureAudioChannel(channel) {
    if (!channel) return false;
    // Explicit radio/audio flag from playlist parser
    if (channel.isAudio) return true;
    // Confirmed no video frames after stream is ready
    if (video && video.readyState >= 2 && video.videoWidth === 0 && !video.error) {
      return true;
    }
    return false;
  }

  function checkAudioMode() {
    if (!currentChannel || !video) return;

    // Has real video image → never show radio logo/name (e.g. music video channels)
    if (video.readyState >= 2 && video.videoWidth > 0) {
      hideRadioOverlay();
      if (window.AudioViz) AudioViz.stop();
      return;
    }

    const pureAudio = isPureAudioChannel(currentChannel);
    if (pureAudio) {
      // Logo + scrolling name only for pure audio/radio
      showRadioOverlay(currentChannel);
      if (Settings.get('visualizer') && window.AudioViz) {
        AudioViz.start(video, currentChannel);
      }
    } else {
      hideRadioOverlay();
      if (window.AudioViz) AudioViz.stop();
    }
  }

  function showRadioOverlay(channel) {
    const overlay = document.getElementById('radio-overlay');
    const logo = document.getElementById('radio-logo');
    if (!overlay) return;

    // Safety: only pure audio/radio
    if (!isPureAudioChannel(channel)) {
      hideRadioOverlay();
      return;
    }

    overlay.classList.remove('hidden');

    if (logo) {
      if (channel.logo) {
        logo.style.backgroundImage = 'url("' + String(channel.logo).replace(/"/g, '') + '")';
        logo.classList.remove('placeholder');
      } else {
        logo.style.backgroundImage = '';
        logo.classList.add('placeholder');
      }
    }

    updateRadioText(channel.name || 'Radio');
  }

  function updateRadioText(text) {
    // Do not show name unless we are in pure audio/radio mode
    if (!isPureAudioChannel(currentChannel)) {
      const overlay = document.getElementById('radio-overlay');
      if (overlay) overlay.classList.add('hidden');
      return;
    }
    const marquee = document.getElementById('radio-marquee');
    if (!marquee) return;
    marquee.textContent = text || '';
    if (text && text.length > 28) {
      marquee.classList.remove('static');
    } else {
      marquee.classList.add('static');
    }
  }

  function hideRadioOverlay() {
    const overlay = document.getElementById('radio-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function stop() {
    intentionalStop = true;
    if (loadTimeout) clearTimeout(loadTimeout);
    if (errorAutoNextTimer) clearTimeout(errorAutoNextTimer);
    if (retryTimer) clearTimeout(retryTimer);
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (e) {}
    intentionalStop = false;
    currentChannel = null;
    retryCount = 0;
    setLoading(false);
    hideError();
    hideRadioOverlay();
    if (window.AudioViz) AudioViz.stop();
  }

  function retry() {
    retryCount = 0;
    if (currentChannel) playChannel(currentChannel, { isReload: true });
  }

  function togglePlayPause() {
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function getCurrent() {
    return currentChannel;
  }

  function getVideo() {
    return video;
  }

  function getDiagnostics() {
    if (!video) return {};
    return {
      url: currentChannel ? currentChannel.url : '',
      type: currentChannel ? (currentChannel.isAudio ? 'audio' : 'video') : '',
      paused: video.paused,
      readyState: video.readyState,
      networkState: video.networkState,
      error: lastError,
      retryCount: retryCount,
      loadStart: loadStartTime,
      playStart: playStartTime,
      currentTime: video.currentTime,
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      volume: video.volume,
      muted: video.muted
    };
  }

  function requestFullscreen() {
    const el = document.getElementById('app') || document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      try { req.call(el); } catch (e) {}
    }
  }

  function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) {
      try { exit.call(document); } catch (e) {}
    }
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  return {
    init,
    playChannel,
    stop,
    retry,
    togglePlayPause,
    getCurrent,
    getVideo,
    getDiagnostics,
    requestFullscreen,
    exitFullscreen,
    isFullscreen,
    showError,
    hideError,
    setLoading,
    updateRadioText,
    checkAudioMode
  };
})();
