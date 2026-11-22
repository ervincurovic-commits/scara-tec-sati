// Applies the saved theme and language before first paint (no flash).
(function () {
  try {
    var theme = localStorage.getItem('scara_theme');
    var lang = localStorage.getItem('scara_lang');
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('lang', lang === 'sl' ? 'sl' : 'bs');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
