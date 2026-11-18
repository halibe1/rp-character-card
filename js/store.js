/*
 * store.js — хранилище персонажей в браузере (IndexedDB, запасной вариант — localStorage).
 */
(function () {
  'use strict';

  var LocalStore = (function () {
    var LS = 'rp-card-characters';
    var mem = null, mode = 'idb', dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        // некоторые браузеры на file:// «подвисают» на indexedDB.open — не ждём дольше 2 с
        setTimeout(function () { rej(new Error('IndexedDB timeout')); }, 2000);
        try {
          var rq = indexedDB.open('rp-card', 1);
          rq.onupgradeneeded = function () { rq.result.createObjectStore('characters', { keyPath: 'id' }); };
          rq.onsuccess = function () { res(rq.result); };
          rq.onerror = function () { rej(rq.error); };
        } catch (e) { rej(e); }
      });
      return dbp;
    }
    function tx(kind, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          setTimeout(function () { rej(new Error('IndexedDB timeout')); }, 2500);
          var t = db.transaction('characters', kind), rq = fn(t.objectStore('characters'));
          t.oncomplete = function () { res(rq ? rq.result : undefined); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    function lsRead() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return mem || []; } }
    function lsWrite(list) {
      mem = list;
      try { localStorage.setItem(LS, JSON.stringify(list)); }
      catch (e) { throw new Error('в браузере закончилось место (арты занимают много). Сделай экспорт и удали лишних персонажей'); }
    }
    function fallback(e) { console.warn('IndexedDB недоступен, используем localStorage', e); mode = 'ls'; }
    return {
      all: function () {
        if (mode === 'ls') return Promise.resolve(lsRead());
        return tx('readonly', function (s) { return s.getAll(); }).catch(function (e) { fallback(e); return lsRead(); });
      },
      put: function (ch) {
        if (mode === 'ls') {
          var l = lsRead().filter(function (c) { return c.id !== ch.id; }); l.push(ch);
          try { lsWrite(l); } catch (e) { return Promise.reject(e); }
          return Promise.resolve();
        }
        return tx('readwrite', function (s) { return s.put(ch); }).catch(function (e) { fallback(e); return LocalStore.put(ch); });
      },
      remove: function (id) {
        if (mode === 'ls') { try { lsWrite(lsRead().filter(function (c) { return c.id !== id; })); } catch (e) { /* удаление только уменьшает объём */ } return Promise.resolve(); }
        return tx('readwrite', function (s) { return s.delete(id); }).catch(function (e) { fallback(e); return LocalStore.remove(id); });
      }
    };
  })();


  window.RPLocalStore = LocalStore;
})();
