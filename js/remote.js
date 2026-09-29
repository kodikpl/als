/**
 * Remote control & focus management for Smart TV
 */
const Remote = (function () {
  let focusables = [];
  let focusIndex = 0;
  let currentContext = 'player'; // player | menu | channels | settings | playlist | epg | about | error
  let channelInput = '';
  let channelInputTimer = null;
  let channelInputTimeout = 2500;
  let onKey = null;

  const KEY_MAP = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'enter',
    Escape: 'back',
    Backspace: 'back',
    // Smart TV common
    'MediaPlayPause': 'playpause',
    'MediaPlay': 'play',
    'MediaPause': 'pause',
    'MediaStop': 'stop',
    'MediaTrackNext': 'next',
    'MediaTrackPrevious': 'prev',
    'GoBack': 'back',
    'BrowserBack': 'back',
    'XF86Back': 'back',
    'XF86AudioPlay': 'playpause',
    'XF86AudioPause': 'playpause',
    'ColorF0Red': 'red',
    'ColorF1Green': 'green',
    'ColorF2Yellow': 'yellow',
    'ColorF3Blue': 'blue'
  };

  function init(handlers) {
    onKey = handlers || {};
    document.addEventListener('keydown', handleKey, true);
  }

  function handleKey(e) {
    const key = e.key;
    const target = e.target;
    const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable);

    // Let the user type freely in form fields
    if (isEditable) {
      if (key === 'Escape') {
        e.preventDefault();
        if (target.blur) target.blur();
        if (onKey.back) onKey.back(e);
      }
      // Enter in input: blur and activate primary action if any
      if (key === 'Enter' && tag === 'INPUT') {
        e.preventDefault();
        if (target.blur) target.blur();
        if (onKey.enter) onKey.enter(e);
      }
      return;
    }

    let action = KEY_MAP[key];

    // digits → channel number entry
    if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      handleDigit(key);
      return;
    }

    // OK key on some devices
    if (key === ' ' || key === 'Select' || key === 'Accept') {
      action = 'enter';
    }

    if (!action) return;

    // prevent default for navigation keys so page doesn't scroll
    if (['up', 'down', 'left', 'right', 'enter', 'back', 'playpause'].includes(action)) {
      e.preventDefault();
      e.stopPropagation();
    }

    dispatch(action, e);
  }

  function dispatch(action, e) {
    if (onKey[action]) {
      onKey[action](e);
    }
    // also global context routing is done in App
  }

  function handleDigit(d) {
    if (currentContext !== 'player' && currentContext !== 'channels') return;
    channelInput += d;
    showChannelInput(channelInput);
    if (channelInputTimer) clearTimeout(channelInputTimer);
    channelInputTimer = setTimeout(() => {
      confirmChannelInput();
    }, channelInputTimeout);
  }

  function confirmChannelInput() {
    if (!channelInput) return;
    const num = parseInt(channelInput, 10);
    channelInput = '';
    hideChannelInput();
    if (onKey.channelNumber) onKey.channelNumber(num);
  }

  function showChannelInput(val) {
    const el = document.getElementById('channel-input');
    const span = document.getElementById('channel-input-value');
    if (el && span) {
      span.textContent = val;
      el.classList.remove('hidden');
      el.classList.add('visible');
    }
  }

  function hideChannelInput() {
    const el = document.getElementById('channel-input');
    if (el) {
      el.classList.remove('visible');
      el.classList.add('hidden');
    }
  }

  function clearChannelInput() {
    channelInput = '';
    if (channelInputTimer) clearTimeout(channelInputTimer);
    hideChannelInput();
  }

  // Focus management
  function setContext(ctx, elements) {
    currentContext = ctx;
    focusables = Array.isArray(elements) ? elements.filter(Boolean) : [];
    focusIndex = 0;
    applyFocus();
  }

  function getContext() {
    return currentContext;
  }

  function setFocusIndex(i) {
    if (!focusables.length) return;
    focusIndex = Math.max(0, Math.min(i, focusables.length - 1));
    applyFocus();
  }

  function move(dir) {
    if (!focusables.length) return;
    const len = focusables.length;
    if (dir === 'next' || dir === 'down' || dir === 'right') {
      focusIndex = (focusIndex + 1) % len;
    } else {
      focusIndex = (focusIndex - 1 + len) % len;
    }
    applyFocus();
    scrollIntoView();
  }

  function moveGrid(dir, cols) {
    if (!focusables.length) return;
    cols = cols || 4;
    const len = focusables.length;
    let next = focusIndex;
    if (dir === 'right') next = focusIndex + 1;
    else if (dir === 'left') next = focusIndex - 1;
    else if (dir === 'down') next = focusIndex + cols;
    else if (dir === 'up') next = focusIndex - cols;

    if (next < 0) next = 0;
    if (next >= len) next = len - 1;
    focusIndex = next;
    applyFocus();
    scrollIntoView();
  }

  function applyFocus() {
    focusables.forEach((el, i) => {
      if (!el) return;
      if (i === focusIndex) {
        el.classList.add('focused');
        el.setAttribute('data-focused', '1');
        // Focus form fields so the user can type
        const tag = el.tagName ? el.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          try { el.focus(); } catch (err) {}
        }
      } else {
        el.classList.remove('focused');
        el.removeAttribute('data-focused');
        const tag = el.tagName ? el.tagName.toUpperCase() : '';
        if ((tag === 'INPUT' || tag === 'TEXTAREA') && document.activeElement === el) {
          try { el.blur(); } catch (err) {}
        }
      }
    });
  }

  function scrollIntoView() {
    const el = focusables[focusIndex];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: Settings.get('animations') ? 'smooth' : 'auto' });
    }
  }

  function getFocused() {
    return focusables[focusIndex] || null;
  }

  function getFocusIndex() {
    return focusIndex;
  }

  function activateFocused() {
    const el = getFocused();
    if (!el) return null;
    // trigger click or data-action
    const action = el.getAttribute('data-action');
    if (action && onKey.action) {
      onKey.action(action, el);
      return action;
    }
    if (typeof el.click === 'function') el.click();
    return el;
  }

  return {
    init,
    setContext,
    getContext,
    setFocusIndex,
    move,
    moveGrid,
    getFocused,
    getFocusIndex,
    activateFocused,
    clearChannelInput,
    confirmChannelInput,
    handleDigit
  };
})();
