/* Resolve appearance before the first paint, independently of activity data. */
(function () {
  'use strict';
  var KEY = 'prokope.theme.v1';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function valid(value) { return value === 'light' || value === 'dark' || value === 'system'; }
  function readPreference() {
    try { var value = localStorage.getItem(KEY); return valid(value) ? value : 'system'; }
    catch (_) { return 'system'; }
  }
  var preference = readPreference();
  function apply() {
    var theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#1b2421' : '#f6f5f0';
    var statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBar) statusBar.content = theme === 'dark' ? 'black-translucent' : 'default';
    var control = document.getElementById('theme-preference');
    if (control) control.value = preference;
  }
  function setPreference(value) {
    if (!valid(value)) return false;
    preference = value;
    try { localStorage.setItem(KEY, value); } catch (_) { /* Apply for this window even if storage is unavailable. */ }
    apply();
    return true;
  }
  window.ProkopeTheme = {
    getPreference: function () { return preference; },
    setPreference: setPreference
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('change', function (event) {
    if (event.target.id === 'theme-preference') setPreference(event.target.value);
  });
  function followSystem() { if (preference === 'system') apply(); }
  if (media.addEventListener) media.addEventListener('change', followSystem);
  else if (media.addListener) media.addListener(followSystem);
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === null) { preference = readPreference(); apply(); }
  });
})();
