// Chill background music for the main menu / multiplayer lobby.
//
// Purely additive and non-invasive: this file only WATCHES which screen is
// currently active (the same `.screen.active` class every screen already
// uses) and fades the music in/out accordingly. It never calls into or
// edits app.js, multiplayer.js, or any gameplay/scoring/recording code.
(function () {
  'use strict';

  // Music plays only on these "not currently playing a round" screens.
  const MUSIC_SCREENS = new Set(['screen-start', 'screen-mp-lobby', 'screen-mp-room']);
  const DEFAULT_VOLUME = 0.15; // quiet background bed - never competes with game audio
  const FADE_MS = 500;

  const audio = new Audio('audio/music/lobby-theme.mp3');
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;

  let fadeTimer = null;
  let unlocked = false;

  function fadeTo(target, ms) {
    clearInterval(fadeTimer);
    const steps = 12;
    const start = audio.volume;
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      audio.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps)));
      if (i >= steps) {
        clearInterval(fadeTimer);
        audio.volume = target;
        if (target === 0 && !audio.paused) audio.pause();
      }
    }, ms / steps);
  }

  function currentScreenId() {
    const el = document.querySelector('.screen.active');
    return el ? el.id : null;
  }

  function sync() {
    const shouldPlay = MUSIC_SCREENS.has(currentScreenId());
    if (shouldPlay) {
      if (!unlocked) return; // browsers block audio with sound before a user gesture
      if (audio.paused) audio.play().catch(() => {});
      fadeTo(DEFAULT_VOLUME, FADE_MS);
    } else {
      fadeTo(0, FADE_MS);
    }
  }

  // The game already requires a click (START/MULTIPLAYER) before anything
  // happens, so the first click anywhere doubles as the autoplay-unlock
  // gesture browsers require for audio with sound.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    sync();
    document.removeEventListener('click', unlock);
  }
  document.addEventListener('click', unlock);

  const observer = new MutationObserver(sync);
  document.querySelectorAll('.screen').forEach((el) => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  sync();

  // Exposed for debugging/testing, matching this codebase's window.REPLICO_*
  // convention - not used by any other module.
  window.REPLICO_MUSIC = { audio, DEFAULT_VOLUME };
})();
