/*
  Womo compatibility bootstrap
  ----------------------------
  The main app now lives in src/core/womo-core.js.
  Keep this file only for older index.html references.
*/
(function loadWomoCore(){
  if (window.__WOMO_CORE_BOOTSTRAP_LOADED__) return;
  window.__WOMO_CORE_BOOTSTRAP_LOADED__ = true;

  function loadScript(src){
    return new Promise(function(resolve, reject){
      var script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  loadScript('src/core/audioManager.js')
    .catch(function(){})
    .then(function(){ return loadScript('src/core/womo-core.js'); })
    .catch(function(error){ console.warn('No se pudo cargar Womo Core.', error); });
})();
