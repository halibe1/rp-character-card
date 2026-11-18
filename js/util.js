/*
 * util.js — общие мелочи интерфейса: форматирование чисел, экранирование, подсказки, иконки.
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };


  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    d = d === undefined ? 1 : d;
    var p = Math.pow(10, d), x = Math.round(v * p) / p, neg = x < 0;
    x = Math.abs(x);
    var parts = x.toFixed(d).split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var dec = parts[1] && /[1-9]/.test(parts[1]) ? ',' + parts[1].replace(/0+$/, '') : '';
    return (neg ? '−' : '') + int + dec;
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function tipAttr(title, formula, extra) {
    var h = '';
    if (title) h += '<div class="tt-title">' + esc(title) + '</div>';
    if (extra) h += '<div>' + extra + '</div>';
    if (formula) h += '<div class="tt-f">' + esc(formula) + '</div>';
    return ' data-tip="' + esc(h) + '"';
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 2600);
  }


  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  var ICON = {
    punch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 10V7a2 2 0 0 1 4 0v3M10 9V6a2 2 0 0 1 4 0v4M14 9.5V7a2 2 0 0 1 4 0v6c0 4-2.5 7-6.5 7S5 17.5 5 14v-3a1.5 1.5 0 0 1 3 0"/><path d="M9 14h4"/></svg>',
    lift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8"/></svg>',
    speed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    reaction: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/></svg>',
    stamina: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.3-9.6C1.5 7.8 4 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.3 0 5.8 3.3 4.6 6.9C19.5 16.4 12 21 12 21z"/><path d="M6 12h3l1.5-2.5 2 5L14 12h4"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 11V8a2 2 0 0 1 4 0v2M9 9V7a2 2 0 0 1 4 0v3M13 9a2 2 0 0 1 4 0v4c0 4-2.5 7-6 7s-6-3-6-6.5v-1.5"/></svg>',
    kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 3v8l-3 8h4l3-6 8 2v-4l-7-3V3z"/></svg>',
    pierce: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 21 14 10M14 10l7-7-2 6-5 1z"/><path d="M6 15l3 3"/></svg>',
    slashPalm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 18 18 4"/><path d="M7 20 20 7" opacity=".55"/><path d="M3 13 13 3" opacity=".3"/></svg>',
    slashBlade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M20 3 8 15l2 2L21 6z"/><path d="M8 15l-4 4 1.5 1.5 4-4"/><path d="M3 9q6-1 9-6" opacity=".5"/></svg>'
  };


  window.RPUtil = { $: $, $$: $$, fmt: fmt, esc: esc, tipAttr: tipAttr, clone: clone, toast: toast, cap: cap, ICON: ICON };
})();
