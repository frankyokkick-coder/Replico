// BACK button: returns to the main REPLICO menu from single-player or
// multiplayer. Purely additive, same pattern as bg-music.js - this file
// only watches which screen is active (via `.screen.active`) to show/hide
// the button, and a full page reload is what actually "returns to the
// menu". A reload cleanly stops any in-progress recording/mic stream and
// closes the multiplayer connection (the server already handles a dropped
// connection via its existing 'close' handling) without needing to reach
// into app.js/multiplayer.js's gameplay logic at all.
(function () {
  'use strict';

  if (window.__REPLICO_BACK_BUTTON_INIT__) return;
  window.__REPLICO_BACK_BUTTON_INIT__ = true;

  const bar = document.getElementById('top-bar');
  const btn = document.getElementById('btn-back-to-menu');
  if (!bar || !btn) return;

  function currentScreenId() {
    const el = document.querySelector('.screen.active');
    return el ? el.id : null;
  }

  function sync() {
    const onMainMenu = currentScreenId() === 'screen-start';
    bar.classList.toggle('visible', !onMainMenu);
  }

  btn.addEventListener('click', () => {
    window.location.reload();
  });

  const observer = new MutationObserver(sync);
  document.querySelectorAll('.screen').forEach((el) => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  sync();
})();
