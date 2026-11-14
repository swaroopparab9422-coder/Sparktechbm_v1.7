/* Sync extension: lets the sync engine (lan-sync.js) carry the extra Windows data
 * (challans, employees, attendance, GST invoices and their settings) between devices.
 * Every part registers collect() and apply(remote). Records are merged one by one, newest edit wins,
 * deletions are remembered, and attendance is merged day by day so two devices can mark different days. */
(function () {
  'use strict';
  var TOMB_MAX_AGE_DAYS = 400;
  function stamp(rec) { return (rec && (rec.updatedAt || rec.createdAt)) || ''; }
  function maxStr(a, b) { return (a || '') >= (b || '') ? (a || '') : (b || ''); }
  var X = window.MBM_SYNC_EXT = {
    parts: {},
    register: function (name, part) { X.parts[name] = part; },
    collect: function () { var out = {}; Object.keys(X.parts).forEach(function (n) { try { out[n] = X.parts[n].collect(); } catch (e) { /* skip a part that fails */ } }); return out; },
    apply: function (remote) {
      var res = { changed: 0, notes: [] }; remote = remote || {};
      Object.keys(X.parts).forEach(function (n) {
        if (!remote[n]) return;
        try { var r = X.parts[n].apply(remote[n]) || {}; res.changed += r.changed || 0; (r.notes || []).forEach(function (t) { res.notes.push(t); }); } catch (e) { /* keep the other parts */ }
      });
      if (res.changed) {
        var A = window.MBM_APP, safe = { dashboard: 1, challanList: 1, empList: 1, attToday: 1, attSheet: 1, attPayroll: 1 };
        try { if (A && A.S && safe[A.S.view.name]) A.render(); } catch (e) { /* ignore */ }
      }
      return res;
    },
    stamp: stamp,
    readTombs: function (kind) {
      var out = {}, pre = 'mbm:del:' + kind + ':', i, k;
      for (i = 0; i < localStorage.length; i++) { k = localStorage.key(i); if (k.indexOf(pre) === 0) out[k.slice(pre.length)] = localStorage.getItem(k); }
      return out;
    },
    writeTombs: function (kind, tombs) { Object.keys(tombs || {}).forEach(function (id) { try { localStorage.setItem('mbm:del:' + kind + ':' + id, tombs[id]); } catch (e) { /* ignore */ } }); },
    addTomb: function (kind, id) { try { localStorage.setItem('mbm:del:' + kind + ':' + id, new Date().toISOString()); } catch (e) { /* ignore */ } },
    mergeKind: function (localList, remoteList, localDel, remoteDel) {
      var byId = {}, i;
      function consider(rec) { if (!rec || !rec.id) return; var cur = byId[rec.id]; if (!cur || stamp(rec) > stamp(cur)) byId[rec.id] = rec; }
      for (i = 0; i < localList.length; i++) consider(localList[i]);      // local first, so a tie keeps the local copy
      for (i = 0; i < (remoteList || []).length; i++) consider(remoteList[i]);
      var tombs = {};
      Object.keys(localDel || {}).forEach(function (k) { tombs[k] = maxStr(tombs[k], localDel[k]); });
      Object.keys(remoteDel || {}).forEach(function (k) { tombs[k] = maxStr(tombs[k], remoteDel[k]); });
      var out = [];
      Object.keys(byId).forEach(function (k) {
        var rec = byId[k];
        if (tombs[k] && tombs[k] >= stamp(rec)) return;                    // deleted after its last edit
        delete tombs[k]; out.push(rec);                                    // edited after the delete: the record wins
      });
      var cutoff = new Date(Date.now() - TOMB_MAX_AGE_DAYS * 864e5).toISOString();
      Object.keys(tombs).forEach(function (k) { if (tombs[k] < cutoff) delete tombs[k]; });
      return { list: out, tombs: tombs };
    }
  };
})();
