// Static reference boundary. No source app, API, persistence or substitute pages.
(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    var route = event.target.closest('a[data-preview-route]');
    if (route) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var route = event.target.closest('a[data-preview-route]');
    if (route) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    var toggle = event.target.closest('a[data-toggle="dropdown"]');
    if (toggle) {
      event.preventDefault();
      toggle.click();
    }
  }, true);
}());
