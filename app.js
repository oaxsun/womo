/*
  Womo compatibility bootstrap
  ----------------------------
  The main app now lives in src/core/womo-core.js.
  Keep this file only for older index.html references.
*/
(function loadWomoCore(){
  if (window.__WOMO_CORE_BOOTSTRAP_LOADED__) return;
  window.__WOMO_CORE_BOOTSTRAP_LOADED__ = true;
  var script = document.createElement('script');
  script.src = 'src/core/womo-core.js';
  script.defer = true;
  document.head.appendChild(script);
})();
