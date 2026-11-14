/* Generate Invoice: tax invoice in the Spark Tech format (A4 PDF), numbered automatically by financial year.
 * Every field can be edited. The amount in words is filled in from the total. */
(function () {
  'use strict';
  var A = window.MBM_APP, GK = window.MBM_GST, K0 = window.MBM_REPORT && window.MBM_REPORT.kit;
  if (!A || !A.SCREENS || !K0 || !GK) return;
  var S = A.S, SCREENS = A.SCREENS, ACTIONS = A.ACTIONS, AFTER = A.AFTER, esc = A.esc, toast = A.toast, plural = A.plural, shell = A.shell, X = window.MBM_SYNC_EXT;
  var KEY = 'mbm:inv:', SKEY = 'mbm:invs', STATES = GK.states;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; var d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getMonth() === +m[2] - 1 ? d : null; }
  function dmy(s) { var d = parseYmd(s); return d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() : ''; }
  function parseDateInput(t) {
    t = String(t || '').trim(); if (!t) return '';
    var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(t), y, mo, d;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; } else { m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t); if (!m) return ''; y = +m[1]; mo = +m[2]; d = +m[3]; }
    var dt = new Date(y, mo - 1, d); return (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || y < 2017 || y > 2100) ? '' : ymd(dt);
  }
  function r2(n) { return Math.round((Number(n) + 1e-9) * 100) / 100; }
  function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/[₹,\s]/g, '')); return isFinite(n) ? n : NaN; }
  function money(n) { return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
  function plain(n) { n = Number(n); return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(r2(n)); }
  function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function changed() { try { window.dispatchEvent(new Event('mbm-data-changed')); } catch (e) { /* ignore */ } }

  /* ---------------------------------------------------------------- amount in words (Indian system) */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below100(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
  function below1000(n) { var h = Math.floor(n / 100), r = n % 100, out = []; if (h) out.push(ONES[h] + ' Hundred'); if (r) out.push((h ? 'and ' : '') + below100(r)); return out.join(' '); }
  function words(n) {
    n = Math.floor(Math.abs(n)); if (!n) return 'Zero';
    var parts = [], cr = Math.floor(n / 10000000), lk = Math.floor(n / 100000) % 100, th = Math.floor(n / 1000) % 100, rest = n % 1000;
    if (cr) parts.push(words(cr) + ' Crore');
    if (lk) parts.push(below100(lk) + ' Lakh');
    if (th) parts.push(below100(th) + ' Thousand');
    if (rest) { var w = below1000(rest); parts.push((parts.length && rest < 100 ? 'and ' : '') + w); }
    return parts.join(' ');
  }
  function amountWords(n) { var p = Math.round((n - Math.floor(n)) * 100); return 'Rs ' + words(n) + (p ? ' and ' + words(p) + ' Paise' : '') + ' Only /-'; }

  /* ---------------------------------------------------------------- data and settings */
  var DEFAULT_SET = { prefix: 'STA', series: 'fy', startFy: '26-27', startSerial: 50, company: 'SPARK TECH AUTOMATION', gstin: '27EFDPP0716L1Z9', stateCode: '27', stateName: 'MAHARASHTRA',
    addr: 'Add: B67,MIDC, Gokul Shirgaon, Kolhapur, 416234, Maharashtra', bankName: 'IDFC First Bank', bankAcc: '59422008877', bankIfsc: 'IDFB0042523', bankBranch: 'Kolhapur',
    gstRate: 18, logoSite: false, autoGst: true, reverse: 'GST Reverse Charges Applicable.', certify: 'Certify that the particulars given above are true and correct.', transportMode: 'transport', updatedAt: '' };
  var V = { list: [], set: Object.assign({}, DEFAULT_SET) };
  function load() {
    V.list = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(KEY) === 0) { try { var r = JSON.parse(localStorage.getItem(k)); if (r && r.id) V.list.push(r); } catch (e) { /* skip */ } } }
    try { V.set = Object.assign({}, DEFAULT_SET, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch (e) { /* defaults */ }
  }
  function put(r) { try { localStorage.setItem(KEY + r.id, JSON.stringify(r)); } catch (e) { toast('Could not save: ' + (e && e.message || e), 'err'); return false; } changed(); return true; }
  function drop(id) { try { localStorage.removeItem(KEY + id); } catch (e) { /* ignore */ } changed(); }
  function saveSet() { V.set.updatedAt = new Date().toISOString(); try { localStorage.setItem(SKEY, JSON.stringify(V.set)); } catch (e) { /* ignore */ } changed(); }
  load();

  /* ---------------------------------------------------------------- invoice number (financial year logic) */
  function fyOf(dateStr) { var d = parseYmd(dateStr) || new Date(), y = d.getFullYear(); if (V.set.series === 'fy' && d.getMonth() < 3) y -= 1; return V.set.series === 'fy' ? pad(y % 100) + '-' + pad((y + 1) % 100) : String(y); }
  function seqIn(text, prefix, fy) { var re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s-]*' + fy + '\\/(\\d+)\\s*$', 'i'), m = re.exec(String(text || '').trim()); return m ? +m[1] : 0; }
  function nextNo(dateStr, ignoreId) {
    var prefix = V.set.prefix, fy = fyOf(dateStr), max = 0;
    V.list.forEach(function (r) { if (r.id !== ignoreId) max = Math.max(max, seqIn(r.no, prefix, fy)); });
    (GK.recs() || []).forEach(function (r) { if (r.kind === 'sale') max = Math.max(max, seqIn(r.no, prefix, fy)); });   // invoices already entered in the GST register count too
    var floor = fy === V.set.startFy ? (parseInt(V.set.startSerial, 10) || 1) : 1, seq = Math.max(max + 1, floor);
    return { prefix: prefix, fy: fy, seq: seq, no: prefix + ' ' + fy + '/' + seq };
  }

  /* ---------------------------------------------------------------- calculation */
  function calc(inv) {
    var assess = 0; inv.items.forEach(function (it) { assess += Number(it.amount) || 0; }); assess = r2(assess);
    var rate = Number(inv.gstRate) || 0, intra = inv.taxType === 'intra' ? true : inv.taxType === 'inter' ? false : String(inv.receiver.stateCode) === String(inv.ourStateCode);
    var cgst = intra ? r2(assess * rate / 200) : 0, sgst = cgst, igst = intra ? 0 : r2(assess * rate / 100), gst = r2(cgst + sgst + igst), after = r2(assess + gst), rounded = Math.round(after);
    return { assess: assess, rate: rate, intra: intra, cgst: cgst, sgst: sgst, igst: igst, gst: gst, after: after, rounded: rounded };
  }

  /* ---------------------------------------------------------------- screens */
  var DR = null, IQ = { q: '' }, MAX_ITEMS = 12;
  function blankDraft() {
    var s = V.set, d = today(), n = nextNo(d);
    return { key: 'new', id: null, no: n.no, noAuto: true, date: d, poNo: '', poDate: '', ourGstin: s.gstin, ourStateCode: s.stateCode, company: s.company, receiver: { name: '', address: '', state: s.stateName, stateCode: s.stateCode, gstin: '' },
      items: [{ desc: '', hsn: '', qty: '', rate: '', amount: '' }], gstRate: s.gstRate, taxType: 'auto', words: '', wordsAuto: true, transport: { mode: s.transportMode, vehicle: '', date: '', driver: '' },
      advance: 0, balance: '', balanceAuto: true, addGst: s.autoGst !== false, reverse: s.reverse, certify: s.certify, bank: { name: s.bankName, acc: s.bankAcc, ifsc: s.bankIfsc, branch: s.bankBranch }, footer: s.addr };
  }
  function draftFrom(r, key) {
    var d = JSON.parse(JSON.stringify(r)); d.key = key; d.noAuto = false; d.wordsAuto = false; d.balanceAuto = false; d.words = r.words; d.balance = r.balance; return d;
  }
  function stateOptions(sel) { return Object.keys(STATES).map(function (c) { return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + c + ' · ' + esc(STATES[c]) + '</option>'; }).join(''); }
  function itemRows(d) {
    return d.items.map(function (it, i) {
      return '<tr data-row="' + i + '"><td class="n">' + (i + 1) + '</td><td><textarea id="i-d-' + i + '" rows="3" placeholder="Item description (one line per row)">' + esc(it.desc) + '</textarea><input id="i-h-' + i + '" type="text" inputmode="numeric" placeholder="HSN code" value="' + esc(it.hsn) + '" class="inv-hsn"></td>' +
        '<td class="q"><input id="i-q-' + i + '" type="text" inputmode="decimal" value="' + esc(it.qty) + '"></td><td class="q"><input id="i-r-' + i + '" type="text" inputmode="decimal" value="' + esc(it.rate) + '"></td>' +
        '<td class="a"><input id="i-a-' + i + '" type="text" inputmode="decimal" value="' + esc(it.amount === '' ? '' : it.amount) + '"></td>' +
        '<td class="x">' + (d.items.length > 1 ? '<button type="button" class="btn btn-secondary btn-sm" data-act="invDelRow" data-i="' + i + '" aria-label="Remove item ' + (i + 1) + '">✕</button>' : '') + '</td></tr>';
    }).join('');
  }
  function f(id, label, val, extra) { return '<div class="field' + ((extra && extra.cls) ? ' ' + extra.cls : '') + '"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="text" value="' + esc(val) + '"' + ((extra && extra.attrs) || '') + ' autocomplete="off">' + ((extra && extra.hint) ? '<span class="hint">' + extra.hint + '</span>' : '') + '</div>'; }
  SCREENS.invoiceForm = function (p) {
    p = p || {}; var editing = p.id ? V.list.filter(function (r) { return r.id === p.id; })[0] : null;
    if (p.id && !editing) return shell('Edit Invoice', A.notFound('invoice'));
    var key = p.id || 'new'; if (!DR || DR.key !== key) DR = editing ? draftFrom(editing, key) : blankDraft();
    var d = DR, t = calc(d), words = d.wordsAuto ? amountWords(t.rounded) : d.words, balance = d.balanceAuto ? String(t.rounded - (num(d.advance) || 0)) : d.balance;
    if (editing && d.addGst === undefined) d.addGst = !!(GK.recs().filter(function (r) { return r.invId === editing.id; })[0]);
    var banner = editing ? '<div class="mode-banner"><span>Editing invoice <b class="mono">' + esc(editing.no) + '</b></span><button type="button" class="btn btn-secondary btn-sm" data-act="invNew">Start a new invoice</button></div>'
      : '<div class="mode-banner"><span>New invoice <b class="mono" id="i-no-banner">' + esc(d.no) + '</b></span><span class="muted">The number follows the financial year and is confirmed when you save</span></div>';
    var s1 = '<div class="fieldset"><h2>Invoice details</h2><div class="form-grid">' +
      f('i-no', 'Invoice no', d.no, { hint: 'Picked automatically. You can type your own.' }) + f('i-date', 'Invoice date', dmy(d.date), { attrs: ' placeholder="dd/mm/yyyy" inputmode="numeric"' }) +
      f('i-pono', 'PO no', d.poNo, { attrs: ' placeholder="verbal"' }) + f('i-podate', 'PO date', d.poDate ? dmy(d.poDate) : '', { attrs: ' placeholder="dd/mm/yyyy" inputmode="numeric"' }) + '</div></div>';
    var s2 = '<div class="fieldset"><h2>Receiver / billed to</h2><div class="form-grid">' +
      f('i-rname', 'Name (To)', d.receiver.name, {}) + f('i-rgstin', 'GSTIN', d.receiver.gstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' }) +
      '<div class="field wide"><label for="i-raddr">Address</label><textarea id="i-raddr" style="min-height:60px">' + esc(d.receiver.address) + '</textarea></div>' +
      f('i-rstate', 'State', d.receiver.state, { attrs: ' style="text-transform:uppercase"' }) + f('i-rcode', 'State code', d.receiver.stateCode, { attrs: ' maxlength="2" inputmode="numeric"' }) + '</div></div>';
    var s3 = '<div class="fieldset"><h2>Items</h2><div class="cost-scroll"><table class="inv-items"><thead><tr><th>No.</th><th>Description of goods</th><th>Qty</th><th>Rate</th><th>Total (Rs)</th><th></th></tr></thead><tbody id="i-rows">' + itemRows(d) + '</tbody></table></div>' +
      '<div class="btn-row"><button type="button" class="btn btn-secondary" data-act="invAddRow">+ Add item</button></div></div>';
    var s4 = '<div class="fieldset"><h2>Tax and total</h2><div class="form-grid">' +
      '<div class="field"><label for="i-rate">GST rate</label><select id="i-rate">' + [0, 5, 12, 18, 28].map(function (x) { return '<option value="' + x + '"' + (+d.gstRate === x ? ' selected' : '') + '>' + x + '%</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="i-taxtype">Tax type</label><select id="i-taxtype"><option value="auto"' + (d.taxType === 'auto' ? ' selected' : '') + '>Automatic (from state code)</option><option value="intra"' + (d.taxType === 'intra' ? ' selected' : '') + '>CGST + SGST</option><option value="inter"' + (d.taxType === 'inter' ? ' selected' : '') + '>IGST</option></select></div></div>' +
      '<div class="inv-tot"><div><span>Assessable value</span><b id="i-assess">' + money(t.assess) + '</b></div><div><span id="i-l-cgst">' + (t.intra ? 'CGST [ ' + plain(t.rate / 2) + ' % ]' : 'IGST [ ' + plain(t.rate) + ' % ]') + '</span><b id="i-v-cgst">' + money(t.intra ? t.cgst : t.igst) + '</b></div>' +
      '<div id="i-row-sgst"' + (t.intra ? '' : ' hidden') + '><span>SGST [ ' + plain(t.rate / 2) + ' % ]</span><b id="i-v-sgst">' + money(t.sgst) + '</b></div><div><span>Total GST amount</span><b id="i-gst">' + money(t.gst) + '</b></div>' +
      '<div><span>Total amount after tax</span><b id="i-after">' + money(t.after) + '</b></div><div class="big"><span>Rounded amount</span><b id="i-round">' + t.rounded + '</b></div></div>' +
      '<div class="field"><label for="i-words">Invoice amount in words</label><input id="i-words" type="text" value="' + esc(words) + '" autocomplete="off"><span class="hint">Filled in from the rounded amount. Type to change it; <a href="#" data-act="invWordsAuto">fill it in again</a>.</span></div></div>';
    var s5 = '<div class="fieldset"><h2>Transport details</h2><div class="form-grid">' + f('i-tmode', 'Mode', d.transport.mode, {}) + f('i-tveh', 'Vehicle no', d.transport.vehicle, {}) + f('i-tdate', 'Date', d.transport.date, {}) + f('i-tdrv', 'Driver name', d.transport.driver, {}) + '</div></div>';
    var s5b = '<div class="fieldset"><h2>GST sales register</h2><label class="inv-check"><input type="checkbox" id="i-addgst"' + (d.addGst ? ' checked' : '') + '> Add this invoice to <b>GST Filing, Sales</b> automatically (receiver, GSTIN, place of supply, HSN, taxable value, CGST / SGST / IGST and total are filled in from the invoice)</label><p class="muted">It goes into the month of the invoice date. If you change the invoice later, the GST entry is updated too.</p></div>';
    var s6 = '<div class="fieldset"><h2>Payment</h2><div class="form-grid">' + f('i-adv', 'Advance received (Rs)', d.advance === 0 ? '0' : d.advance, { attrs: ' inputmode="decimal"' }) +
      f('i-bal', 'Balance payment (Rs)', balance, { attrs: ' inputmode="decimal"', hint: 'Rounded amount minus advance. Type to change it.' }) + '</div></div>';
    var s7 = '<div class="fieldset"><h2>Company, bank and notes</h2><div class="form-grid">' +
      f('i-company', 'Company name (For)', d.company, {}) + f('i-ogstin', 'Our GSTIN', d.ourGstin, { attrs: ' maxlength="15" style="text-transform:uppercase"' }) + f('i-ocode', 'Our state code', d.ourStateCode, { attrs: ' maxlength="2"' }) +
      f('i-bname', 'Bank name', d.bank.name, {}) + f('i-bacc', 'Account no', d.bank.acc, {}) + f('i-bifsc', 'IFSC code', d.bank.ifsc, {}) + f('i-bbranch', 'Branch', d.bank.branch, {}) +
      f('i-reverse', 'Reverse charge note', d.reverse, { cls: 'wide' }) + f('i-certify', 'Declaration', d.certify, { cls: 'wide' }) + f('i-footer', 'Address line at the bottom', d.footer, { cls: 'wide' }) + '</div></div>';
    return shell(editing ? 'Edit Invoice' : 'Generate Invoice', banner + '<form id="invoice-form" novalidate autocomplete="off">' + s1 + s2 + s3 + s4 + s5 + s5b + s6 + s7 +
      '<div class="btn-row"><button type="button" class="btn grow-sm" data-act="invSave">Save Invoice</button><button type="button" class="btn btn-secondary grow-sm" data-act="invSavePdf">Save and Download PDF</button><button type="button" class="btn btn-secondary grow-sm" data-act="invList">Saved Invoices</button></div></form>');
  };
  function readForm() {
    if (!DR) return; var v = function (id) { var e = document.getElementById(id); return e ? e.value : null; }, d = DR;
    var g = function (id, cur) { var x = v(id); return x === null ? cur : x; };
    d.no = g('i-no', d.no); var dt = parseDateInput(g('i-date', dmy(d.date))); if (dt) d.date = dt; d.poNo = g('i-pono', d.poNo); var pd = g('i-podate', dmy(d.poDate)); d.poDate = parseDateInput(pd);
    d.receiver = { name: g('i-rname', d.receiver.name), address: g('i-raddr', d.receiver.address), state: g('i-rstate', d.receiver.state), stateCode: g('i-rcode', d.receiver.stateCode), gstin: g('i-rgstin', d.receiver.gstin).toUpperCase() };
    d.items = d.items.map(function (it, i) { return { desc: g('i-d-' + i, it.desc), hsn: g('i-h-' + i, it.hsn), qty: g('i-q-' + i, it.qty), rate: g('i-r-' + i, it.rate), amount: g('i-a-' + i, it.amount) }; });
    d.gstRate = +g('i-rate', d.gstRate); d.taxType = g('i-taxtype', d.taxType);
    var w = v('i-words'); if (w !== null) d.words = w; var b = v('i-bal'); if (b !== null) d.balance = b; d.advance = g('i-adv', d.advance);
    d.transport = { mode: g('i-tmode', d.transport.mode), vehicle: g('i-tveh', d.transport.vehicle), date: g('i-tdate', d.transport.date), driver: g('i-tdrv', d.transport.driver) };
    d.company = g('i-company', d.company); d.ourGstin = g('i-ogstin', d.ourGstin).toUpperCase(); d.ourStateCode = g('i-ocode', d.ourStateCode);
    d.bank = { name: g('i-bname', d.bank.name), acc: g('i-bacc', d.bank.acc), ifsc: g('i-bifsc', d.bank.ifsc), branch: g('i-bbranch', d.bank.branch) };
    var ag = document.getElementById('i-addgst'); if (ag) d.addGst = ag.checked;
    d.reverse = g('i-reverse', d.reverse); d.certify = g('i-certify', d.certify); d.footer = g('i-footer', d.footer);
  }
  function numericItems(d) { return d.items.map(function (it) { return { desc: it.desc, hsn: it.hsn, qty: it.qty, rate: it.rate, amount: num(it.amount) || 0 }; }); }
  function snapshotCalc() { readForm(); var d = DR; return calc({ items: numericItems(d), gstRate: d.gstRate, taxType: d.taxType, receiver: d.receiver, ourStateCode: d.ourStateCode }); }
  function refreshTotals() {
    var t = snapshotCalc(), d = DR, setT = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }, setV = function (id, v) { var e = document.getElementById(id); if (e) e.value = v; };
    setT('i-assess', money(t.assess)); setT('i-l-cgst', t.intra ? 'CGST [ ' + plain(t.rate / 2) + ' % ]' : 'IGST [ ' + plain(t.rate) + ' % ]'); setT('i-v-cgst', money(t.intra ? t.cgst : t.igst)); setT('i-v-sgst', money(t.sgst));
    var rs = document.getElementById('i-row-sgst'); if (rs) rs.hidden = !t.intra; setT('i-gst', money(t.gst)); setT('i-after', money(t.after)); setT('i-round', String(t.rounded));
    if (d.wordsAuto) setV('i-words', amountWords(t.rounded)); if (d.balanceAuto) setV('i-bal', String(t.rounded - (num(d.advance) || 0)));
  }
  function refreshNo() { if (!DR || DR.id || !DR.noAuto) return; var e = document.getElementById('i-no'), b = document.getElementById('i-no-banner'), n = nextNo(parseDateInput(document.getElementById('i-date').value) || today()); if (e) e.value = n.no; if (b) b.textContent = n.no; DR.no = n.no; }
  var MANUAL = {};
  document.addEventListener('input', function (e) {
    if (S.view.name !== 'invoiceForm' || !DR) return; var id = e.target.id || '', m;
    if ((m = /^i-([qra])-(\d+)$/.exec(id))) {
      var i = m[2];
      if (m[1] === 'a') { MANUAL[i] = true; } else if (!MANUAL[i]) { var q = num(document.getElementById('i-q-' + i).value), r = num(document.getElementById('i-r-' + i).value); document.getElementById('i-a-' + i).value = (q >= 0 && r >= 0) ? String(r2(q * r)) : ''; }
      else if (m[1] !== 'a') { var q2 = num(document.getElementById('i-q-' + i).value), r3 = num(document.getElementById('i-r-' + i).value); MANUAL[i] = false; document.getElementById('i-a-' + i).value = (q2 >= 0 && r3 >= 0) ? String(r2(q2 * r3)) : ''; }
      refreshTotals();
    } else if (id === 'i-words') { DR.wordsAuto = false; }
    else if (id === 'i-bal') { DR.balanceAuto = false; }
    else if (id === 'i-adv') { readForm(); refreshTotals(); }
    else if (id === 'i-no') { DR.noAuto = false; }
    else if (id === 'i-rgstin') { var g = e.target.value.toUpperCase(); if (e.target.value !== g) e.target.value = g; if (g.length >= 2 && STATES[g.slice(0, 2)]) { document.getElementById('i-rcode').value = g.slice(0, 2); document.getElementById('i-rstate').value = STATES[g.slice(0, 2)].toUpperCase(); refreshTotals(); } }
    else if (id === 'i-rcode' || id === 'i-ocode') { refreshTotals(); }
  });
  document.addEventListener('change', function (e) {
    if (S.view.name !== 'invoiceForm' || !DR) return; var id = e.target.id || '';
    if (id === 'i-rate' || id === 'i-taxtype') refreshTotals();
    else if (id === 'i-date') { var iso = parseDateInput(e.target.value); if (iso) { e.target.value = dmy(iso); refreshNo(); } }
    else if (id === 'i-podate' || id === 'i-tdate') { var p2 = parseDateInput(e.target.value); if (p2 && id === 'i-podate') e.target.value = dmy(p2); }
  });

  function cardHtml(r) {
    var t = calc(r), items = r.items.map(function (i) { return i.desc.split('\n')[0]; }).filter(Boolean);
    return '<article class="item"><div class="item-top"><div><div class="item-title">' + esc(r.receiver.name) + '</div><div class="item-sub">' + esc(items.slice(0, 2).join(' · ') + (items.length > 2 ? ' · +' + (items.length - 2) + ' more' : '')) + '</div></div><span class="badge mono">' + esc(r.no) + '</span></div>' +
      '<dl class="facts"><div><dt>Date</dt><dd>' + esc(A.fmtDay(r.date)) + '</dd></div><div><dt>Invoice amount</dt><dd class="mono">₹ ' + money(t.rounded) + '</dd></div>' + (r.poNo ? '<div><dt>PO no</dt><dd>' + esc(r.poNo) + '</dd></div>' : '') + '</dl>' +
      '<div class="actions"><button type="button" class="btn btn-sm" data-act="invPdf" data-id="' + esc(r.id) + '">Download PDF</button><button type="button" class="btn btn-secondary btn-sm" data-act="invEdit" data-id="' + esc(r.id) + '">Edit</button><button type="button" class="btn btn-secondary btn-sm" data-act="invDup" data-id="' + esc(r.id) + '">Copy to new invoice</button><button type="button" class="btn btn-danger btn-sm" data-act="invDelete" data-id="' + esc(r.id) + '">Delete</button></div></article>';
  }
  function listHtml() {
    var q = IQ.q.trim().toLowerCase(), all = V.list.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.no || '').localeCompare(a.no || '', undefined, { numeric: true }); });
    var list = all.filter(function (r) { return !q || (r.no + ' ' + r.receiver.name + ' ' + r.items.map(function (i) { return i.desc; }).join(' ')).toLowerCase().indexOf(q) >= 0; });
    if (!all.length) return '<div class="empty"><strong>No invoices yet</strong><p>Invoices you save appear here, newest first.</p><button type="button" class="btn" data-act="invNew">Generate Invoice</button></div>';
    return list.length ? list.map(cardHtml).join('') : '<div class="empty"><strong>No invoices match “' + esc(IQ.q) + '”</strong></div>';
  }
  function sf(id, label, val, cls) { return '<div class="field' + (cls ? ' ' + cls : '') + '"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="text" value="' + esc(val) + '" autocomplete="off"></div>'; }
  SCREENS.invoiceList = function () {
    var s = V.set, nx = nextNo(today());
    return shell('Saved Invoices', '<div class="toolbar"><div class="grow"><input id="i-search" type="search" placeholder="Search by number, customer or item" value="' + esc(IQ.q) + '" autocomplete="off"></div><button type="button" class="btn" data-act="invNew">Generate Invoice</button></div>' +
      '<div id="i-list" class="list">' + listHtml() + '</div>' +
      '<div class="fieldset"><h2>Invoice numbering and defaults</h2><p class="muted">Next number: <b class="mono">' + esc(nx.no) + '</b>. The first part is your prefix, then the financial year (April to March), then a number that goes up by one and starts again from 1 each April. Invoices already entered in GST Filing with the same prefix are counted too.</p>' +
      '<div class="form-grid">' + sf('is-prefix', 'Prefix', s.prefix) + '<div class="field"><label for="is-series">Year part changes every</label><select id="is-series"><option value="fy"' + (s.series === 'fy' ? ' selected' : '') + '>Financial year (26-27)</option><option value="cal"' + (s.series === 'cal' ? ' selected' : '') + '>Calendar year (2026)</option></select></div>' +
      sf('is-start', 'Next number in ' + s.startFy + ' should not be lower than', s.startSerial) +
      sf('is-company', 'Company name', s.company) + sf('is-gstin', 'Our GSTIN', s.gstin) + sf('is-code', 'Our state code', s.stateCode) + sf('is-state', 'Our state', s.stateName) +
      sf('is-bname', 'Bank name', s.bankName) + sf('is-bacc', 'Account no', s.bankAcc) + sf('is-bifsc', 'IFSC code', s.bankIfsc) + sf('is-bbranch', 'Branch', s.bankBranch) +
      '<div class="field"><label for="is-logo">Logo on the invoice</label><select id="is-logo"><option value="0"' + (!s.logoSite ? ' selected' : '') + '>Without the website line</option><option value="1"' + (s.logoSite ? ' selected' : '') + '>With the website line</option></select></div>' +
      '<div class="field"><label for="is-autogst">New invoices</label><select id="is-autogst"><option value="1"' + (s.autoGst !== false ? ' selected' : '') + '>Go into GST Filing, Sales automatically</option><option value="0"' + (s.autoGst === false ? ' selected' : '') + '>Do not go into GST Filing</option></select></div>' +
      sf('is-addr', 'Address line at the bottom', s.addr, 'wide') + sf('is-reverse', 'Reverse charge note', s.reverse, 'wide') + sf('is-certify', 'Declaration', s.certify, 'wide') + '</div><p class="muted">These are the starting values for every new invoice. Each invoice can still be changed on its own.</p></div>', { sub: plural(V.list.length, 'invoice') + ' saved. Newest first.' });
  };
  A.TITLES.invoiceForm = 'Generate Invoice'; A.TITLES.invoiceList = 'Saved Invoices';
  function widen() { var mn = document.querySelector('main.wrap'); if (mn) mn.style.maxWidth = '1200px'; }
  AFTER.invoiceForm = widen;
  document.addEventListener('input', function (e) { if (e.target.id === 'i-search') { IQ.q = e.target.value; var l = document.getElementById('i-list'); if (l) l.innerHTML = listHtml(); } });
  var SETMAP = { 'is-prefix': 'prefix', 'is-company': 'company', 'is-gstin': 'gstin', 'is-code': 'stateCode', 'is-state': 'stateName', 'is-bname': 'bankName', 'is-bacc': 'bankAcc', 'is-bifsc': 'bankIfsc', 'is-bbranch': 'bankBranch', 'is-addr': 'addr', 'is-reverse': 'reverse', 'is-certify': 'certify' };
  document.addEventListener('change', function (e) {
    var id = e.target.id || ''; if (S.view.name !== 'invoiceList') return;
    if (SETMAP[id]) { V.set[SETMAP[id]] = e.target.value.trim(); if (id === 'is-gstin') V.set.gstin = V.set.gstin.toUpperCase(); saveSet(); A.render(); }
    else if (id === 'is-autogst') { V.set.autoGst = e.target.value === '1'; saveSet(); A.render(); }
    else if (id === 'is-logo') { V.set.logoSite = e.target.value === '1'; saveSet(); A.render(); }
    else if (id === 'is-series') { V.set.series = e.target.value; saveSet(); A.render(); }
    else if (id === 'is-start') { var n = parseInt(e.target.value, 10); if (!(n >= 1)) { toast('Enter a whole number, 1 or more.', 'err'); e.target.value = V.set.startSerial; return; } V.set.startSerial = n; V.set.startFy = fyOf(today()); saveSet(); A.render(); toast('Saved. The next invoice will be ' + nextNo(today()).no + '.'); }
  });

  /* ---------------------------------------------------------------- actions */
  function validate(d) {
    var err = !parseYmd(d.date) ? 'Enter the invoice date as dd/mm/yyyy.' : !String(d.no).trim() ? 'Enter the invoice number.' : !d.receiver.name.trim() ? 'Enter the receiver name.' : !d.items.some(function (i) { return i.desc.trim(); }) ? 'Enter at least one item.' : '';
    if (!err) d.items.forEach(function (i, k) { if (!err && i.desc.trim() && !(num(i.amount) >= 0)) err = 'Item ' + (k + 1) + ' needs a quantity and rate, or an amount.'; });
    return err;
  }
  function saveInvoice() {
    readForm(); var d = DR, err = validate(d); if (err) { toast(err, 'err'); return null; }
    var old = d.id ? V.list.filter(function (r) { return r.id === d.id; })[0] : null, no = String(d.no).trim();
    if (d.noAuto && !old) no = nextNo(d.date).no;
    var dup = V.list.filter(function (r) { return r.id !== (old && old.id) && String(r.no).toLowerCase() === no.toLowerCase(); })[0];
    if (dup) { toast('Invoice number ' + no + ' is already used (' + dup.receiver.name + ').', 'err'); return null; }
    var items = d.items.filter(function (i) { return i.desc.trim() || i.hsn.trim() || String(i.qty).trim(); }).map(function (i) { return { desc: i.desc.replace(/\s+$/g, ''), hsn: i.hsn.trim(), qty: String(i.qty).trim(), rate: String(i.rate).trim(), amount: r2(num(i.amount) || 0) }; });
    var rec = { id: old ? old.id : uid(), no: no, date: d.date, poNo: d.poNo.trim(), poDate: d.poDate, ourGstin: d.ourGstin, ourStateCode: d.ourStateCode, company: d.company, receiver: { name: d.receiver.name.trim(), address: d.receiver.address.trim(), state: d.receiver.state.trim(), stateCode: String(d.receiver.stateCode).trim(), gstin: d.receiver.gstin.trim() },
      items: items, gstRate: d.gstRate, taxType: d.taxType, transport: d.transport, advance: num(d.advance) || 0, reverse: d.reverse, certify: d.certify, bank: d.bank, footer: d.footer, createdAt: old ? old.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString() };
    var t = calc(rec); rec.words = (d.wordsAuto || !d.words.trim()) ? amountWords(t.rounded) : d.words.trim(); rec.balance = (d.balanceAuto || !String(d.balance).trim()) ? String(t.rounded - rec.advance) : String(d.balance).trim();
    if (!put(rec)) return null; if (old) V.list = V.list.map(function (r) { return r.id === rec.id ? rec : r; }); else V.list.push(rec);
    var addGst = d.addGst, msg = '';
    if (addGst) {
      var gs = rec.receiver.gstin;
      if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gs)) msg = ' It was not added to GST Filing because the receiver GSTIN is missing or does not look valid.';
      else {
        var hs = rec.items.map(function (i) { return i.hsn; }).filter(Boolean), t2 = calc(rec);
        var g = GK.fromInvoice({ id: rec.id, date: rec.date, no: rec.no, party: rec.receiver.name, gstin: gs, pos: String(rec.receiver.stateCode) || gs.slice(0, 2), hsn: hs[0] || '', taxable: t2.assess, rate: t2.rate, total: t2.rounded, igst: t2.igst, cgst: t2.cgst, sgst: t2.sgst });
        if (g) msg = ' Added to GST Filing, Sales (' + GK.monthName(g.rm) + ').' + (new Set(hs).size > 1 ? ' It has more than one HSN code; the first one (' + hs[0] + ') is used in the GST entry.' : '');
      }
    } else { if (GK.removeByInvoice(rec.id)) msg = ' Its GST sales entry was removed.'; }
    DR = null; MANUAL = {}; rec._msg = msg; return rec;
  }
  ACTIONS.invNew = function () { DR = null; MANUAL = {}; A.go('invoiceForm', {}); };
  ACTIONS.invList = function () { A.go('invoiceList', {}); };
  ACTIONS.invEdit = function (el) { DR = null; MANUAL = {}; A.go('invoiceForm', { id: el.dataset.id }); };
  ACTIONS.invDup = function (el) { var r = V.list.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!r) return; DR = draftFrom(r, 'new'); DR.id = null; DR.date = today(); DR.no = nextNo(DR.date).no; DR.noAuto = true; DR.wordsAuto = true; DR.balanceAuto = true; DR.poNo = ''; DR.poDate = ''; DR.addGst = V.set.autoGst !== false; MANUAL = {}; A.go('invoiceForm', {}); toast('Copied. A new invoice number is picked when you save.'); };
  ACTIONS.invAddRow = function () { readForm(); if (DR.items.length >= MAX_ITEMS) { toast('Up to ' + MAX_ITEMS + ' items on one invoice.', 'err'); return; } DR.items.push({ desc: '', hsn: '', qty: '', rate: '', amount: '' }); A.render(); var e = document.getElementById('i-d-' + (DR.items.length - 1)); if (e) e.focus(); };
  ACTIONS.invDelRow = function (el) { readForm(); DR.items.splice(+el.dataset.i, 1); if (!DR.items.length) DR.items.push({ desc: '', hsn: '', qty: '', rate: '', amount: '' }); MANUAL = {}; A.render(); };
  ACTIONS.invWordsAuto = function (el, ev) { if (ev && ev.preventDefault) ev.preventDefault(); DR.wordsAuto = true; refreshTotals(); };
  ACTIONS.invSave = function () { var rec = saveInvoice(); if (!rec) return; A.go('invoiceList', {}, { replace: true }); toast('Invoice ' + rec.no + ' saved.' + (rec._msg || ''), null, { label: 'Download PDF', run: function () { invoicePdf(rec); } }); delete rec._msg; };
  ACTIONS.invSavePdf = async function () { var rec = saveInvoice(); if (!rec) return; A.go('invoiceList', {}, { replace: true }); if (rec._msg) toast(rec._msg.trim()); delete rec._msg; await invoicePdf(rec); };
  ACTIONS.invPdf = function (el) { var r = V.list.filter(function (x) { return x.id === el.dataset.id; })[0]; if (r) invoicePdf(r); };
  ACTIONS.invDelete = async function (el) {
    var r = V.list.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!r) return;
    var ok = await A.confirmDialog('Delete invoice ' + r.no + '?', '<p><b>' + esc(r.receiver.name) + '</b> · ₹ ' + money(calc(r).rounded) + '</p><p>This cannot be undone. The matching GST sales entry, if there is one, is removed too.</p>', 'Delete invoice', true); if (!ok) return;
    GK.removeByInvoice(r.id); drop(r.id); X.addTomb('i', r.id); V.list = V.list.filter(function (x) { return x.id !== r.id; }); A.render(); toast('Invoice ' + r.no + ' deleted.');
  };

  /* ---------------------------------------------------------------- PDF (A4, same layout as your invoice) */
  var W = 595, H = 842, SC = 3, F = '"Calibri","Carlito","Roboto","Helvetica Neue",Arial,"Noto Sans",sans-serif', FA = '"Arial","Helvetica Neue","Roboto",sans-serif', OR = '#f0903c', ORD = '#e46c0a', BLK = '#111';
  function wrapText(ctx, text, width) {
    var out = []; String(text || '').split(/\r?\n/).forEach(function (para) {
      var line = ''; para.split(/\s+/).forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width <= width) line = t; else { if (line) out.push(line); line = w; } }); out.push(line);
    }); return out;
  }
  function fit(ctx, text, width) { text = String(text || ''); if (ctx.measureText(text).width <= width) return text; while (text.length > 1 && ctx.measureText(text + '…').width > width) text = text.slice(0, -1); return text + '…'; }
  function line(ctx, x1, y1, x2, y2, w, col) { ctx.strokeStyle = col || BLK; ctx.lineWidth = w || 0.6; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function loadImg(src) { return new Promise(function (res) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = src; }); }
  async function drawInvoice(inv) {
    var cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC; var c = cv.getContext('2d'); c.scale(SC, SC); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.textBaseline = 'alphabetic';
    var logo = await loadImg('./logo-dark.png'), t = calc(inv), L = 32, R = 540;
    if (logo) {
      if (V.set.logoSite) { var lw2 = 188, lh2 = lw2 * logo.height / logo.width; c.drawImage(logo, 58, 28, lw2, lh2); }   // logo with the website line
      else { var lw = 202, sh = Math.round(logo.height * 136 / 195), lh = lw * sh / logo.width; c.drawImage(logo, 0, 0, logo.width, sh, 58, 38, lw, lh); }   // logo without the website line, as on your invoice
    }
    c.fillStyle = BLK; c.font = '800 26px ' + FA; c.textAlign = 'right'; try { c.letterSpacing = '5px'; } catch (e) { /* older engines */ } c.fillText('INVOICE', R + 3, 94); try { c.letterSpacing = '0px'; } catch (e) { /* ignore */ }
    line(c, L, 102, 316, 102, 2.6, BLK); line(c, 316, 102, R, 102, 2.6, OR);
    // receiver and invoice details
    c.textAlign = 'left'; c.font = '700 9px ' + F; c.fillText('DETAILS  OF RECEIVER / BILLED TO', 78, 114); var uw = c.measureText('DETAILS  OF RECEIVER / BILLED TO').width; line(c, 78, 116, 78 + uw, 116, 0.7, BLK);
    c.font = '700 9px ' + F; c.fillText('To :', 56, 129); c.fillText(fit(c, inv.receiver.name, 230), 78, 129);
    c.fillText('Add:', 54, 143); c.font = '9px ' + F; var addr = wrapText(c, inv.receiver.address, 215).slice(0, 2); addr.forEach(function (tx, i) { c.fillText(tx, 77, 143 + i * 11); });
    c.font = '9px ' + F; c.fillText('State :  ' + (inv.receiver.state || ''), 78, 172); c.fillText('Code : ' + (inv.receiver.stateCode || ''), 222, 172); c.fillText('GSTIN : ' + (inv.receiver.gstin || ''), 78, 186);
    var rx = 317; c.fillText('Invoice No :', rx, 114); c.fillText(inv.no, 378, 114); c.fillText('Dated :', rx, 128); c.fillText(dmy(inv.date), 378, 128); c.fillText('State Code :', rx, 142); c.fillText(inv.ourStateCode || '', 378, 142);
    c.fillText('PO No :', rx, 156); c.fillText(inv.poNo || '', 378, 156); c.fillText('Dated :', rx, 170); c.fillText(inv.poDate ? dmy(inv.poDate) : '', 378, 170); c.fillText('Our  GSTIN : ' + (inv.ourGstin || ''), rx, 184);
    // table frame
    var top = 218, hdrB = 250, itemsB = 524, totB = 628, tl = 524, bottomLeft = 558; c.lineWidth = 1.3; c.strokeStyle = OR; c.strokeRect(L, top, R - L, totB - top);
    var cx = [L, 56, 314, 374, 434, R];
    line(c, L, hdrB, R, hdrB, 1.3, OR); [56, 314].forEach(function (x) { line(c, x, top, x, bottomLeft, 1.3, OR); }); [374, 434].forEach(function (x) { line(c, x, top, x, tl, 1.3, OR); }); line(c, 314, top, 314, totB - 0.5, 1.3, OR); line(c, 434, top, 434, totB - 0.5, 1.3, OR);
    line(c, L, bottomLeft, 314, bottomLeft, 1.3, OR);
    c.fillStyle = BLK; c.textAlign = 'center'; c.font = '700 10px ' + F; c.fillText('No.', 44, 238); c.fillText('Description of Goods', 185, 238); c.fillText('Qty', 344, 238); c.fillText('Rate', 404, 238); c.fillText('Total      (Rs)', 487, 238);
    // item rows
    var lines = [], pitch = 15.5, size = 9, cap = itemsB - hdrB - 8;
    function build() { lines = []; c.font = size + 'px ' + F; inv.items.forEach(function (it, i) {
        var ds = [], paras = String(it.desc || '').split(/\r?\n/);
        paras.forEach(function (p, pi) { c.font = (pi === 0 ? '700 ' : '') + size + 'px ' + F; wrapText(c, p, 256).forEach(function (w) { ds.push({ t: w, bold: pi === 0 }); }); });   // first line = item heading (bold), the rest sit under it
        if (it.hsn) ds.push({ t: 'HSN Code - ' + it.hsn, bold: false });
        ds.forEach(function (d, k) { lines.push({ text: d.t, bold: d.bold, item: k === 0 ? i : -1 }); });
      }); }
    build(); while (lines.length * pitch > cap && pitch > 11) { pitch -= 0.5; size = Math.max(7, size - 0.25); build(); }
    if (lines.length * pitch > cap) throw new Error('Too many lines to fit one invoice page. Shorten the descriptions or use fewer items.');
    var y = hdrB + 16; c.textAlign = 'left';
    lines.forEach(function (ln) {
      c.font = (ln.bold ? '700 ' : '') + size + 'px ' + F; c.fillStyle = BLK; c.textAlign = 'left'; c.fillText(ln.text, 60, y);
      if (ln.item >= 0) { var it = inv.items[ln.item]; c.textAlign = 'left'; c.font = '7px ' + F; c.fillText(String(ln.item + 1), 42, y); c.textAlign = 'center'; c.font = size + 'px ' + F; c.fillText(String(it.qty || ''), 344, y); c.fillText(it.rate === '' ? '' : plain(num(it.rate)), 404, y); c.font = '700 ' + size + 'px ' + F; c.fillText(money(it.amount), 487, y); }
      y += pitch;
    });
    // totals block
    var rows = t.intra ? [['Assessable Value :', money(t.assess), true], ['CGST [ ' + plain(t.rate / 2) + ' % ] :', money(t.cgst)], ['SGST [ ' + plain(t.rate / 2) + ' % ] :', money(t.sgst)], ['Total GST Amount :', money(t.gst)], ['Total Amount After Tax :', money(t.after), true], ['Rounded Amount :', String(t.rounded), true]]
      : [['Assessable Value :', money(t.assess), true], ['IGST [ ' + plain(t.rate) + ' % ] :', money(t.igst)], ['Total GST Amount :', money(t.gst)], ['Total Amount After Tax :', money(t.after), true], ['Rounded Amount :', String(t.rounded), true]];
    var rh = (totB - tl) / rows.length;
    rows.forEach(function (r, i) {
      var ry = tl + i * rh; if (i > 0) line(c, 314, ry, R, ry, 1.1, OR);
      c.fillStyle = BLK; c.textAlign = 'right'; c.font = (r[2] ? '700 ' : '') + '9px ' + F; c.fillText(r[0], 430, ry + rh / 2 + 3.2); c.textAlign = 'center'; c.font = (r[2] ? '700 ' : '') + '9px ' + F; c.fillText(r[1], 487, ry + rh / 2 + 3.2);
    });
    // transport
    c.fillStyle = BLK; c.textAlign = 'left'; c.font = '700 8.5px ' + F; c.fillText('Transport Details', 34, 570);
    [[34, 'Mode', inv.transport.mode, 586], [172, 'Vehicle No', inv.transport.vehicle, 586], [34, 'Date', inv.transport.date, 603], [172, 'Driver name', inv.transport.driver, 603]].forEach(function (r) {
      c.font = '9px ' + F; c.fillStyle = BLK; var co = r[0] === 34 ? 28 : 49; c.fillText(r[1], r[0], r[3]); c.fillText(':', r[0] + co, r[3]); c.fillText(fit(c, r[2] || '', r[0] === 34 ? 95 : 125), r[0] + co + 9, r[3]);
    });
    // amount in words banner
    c.fillStyle = ORD; c.fillRect(L, totB, R - L, 17); c.fillStyle = '#fff'; c.font = '700 8.8px ' + F; c.fillText('Invoice Amount In words : ' + (inv.words || amountWords(t.rounded)), 34, totB + 12);
    // advance / balance
    var bx = 76; c.strokeStyle = BLK; c.lineWidth = 0.8; c.strokeRect(bx, 650, 230, 12.5); c.strokeRect(bx, 662.5, 230, 12.5); line(c, 148, 650, 148, 675, 0.8, BLK);
    c.fillStyle = BLK; c.font = '700 7.3px ' + F; c.fillText('ADVANCE Received:', bx + 2, 659.5); c.fillText('Balance Payment', bx + 2, 672); c.font = '7.3px ' + F; c.fillText(plain(inv.advance || 0) + '/- Rs.', 150, 659.5); c.fillText(String(inv.balance) + '/- Rs.', 150, 672);
    c.textAlign = 'right'; c.font = '7.3px ' + F; c.fillStyle = '#333'; c.fillText(inv.reverse || '', 538, 657); c.textAlign = 'left';
    c.fillStyle = BLK; c.font = '9px ' + F; c.fillText('For', 34, 686); c.font = '700 8.5px ' + F; c.fillText(inv.company || '', 56, 686);
    // bank box: the details sit in the middle of the box
    var BX = 310, BY = 688, BW = 218, BH = 86, bcx = BX + BW / 2;
    c.strokeStyle = OR; c.lineWidth = 1.4; (function (x, y2, w, h, r) { c.beginPath(); c.moveTo(x + r, y2); c.arcTo(x + w, y2, x + w, y2 + h, r); c.arcTo(x + w, y2 + h, x, y2 + h, r); c.arcTo(x, y2 + h, x, y2, r); c.arcTo(x, y2, x + w, y2, r); c.closePath(); c.stroke(); })(BX, BY, BW, BH, 13);
    var brows = [['Bank Name', inv.bank.name], ['Acc No.', inv.bank.acc], ['IFSC Code', inv.bank.ifsc], ['Branch', inv.bank.branch]], labW = 54, gap = 14, valW = 0;
    c.font = '8.8px ' + F; brows.forEach(function (r) { valW = Math.max(valW, c.measureText(fit(c, r[1] || '', 140)).width); });
    var blockW = labW + gap + valW, bx0 = bcx - blockW / 2, rowH = 13.4, contentH = 14 + brows.length * rowH, top0 = BY + (BH - contentH) / 2;
    c.fillStyle = BLK; c.textAlign = 'left'; c.font = '800 9.5px ' + F; c.fillText('BANK DETAILS', bx0, top0 + 9); var hw = c.measureText('BANK DETAILS').width; line(c, bx0, top0 + 12, bx0 + hw, top0 + 12, 0.8, OR);
    brows.forEach(function (r, i) {
      var yy = top0 + 14 + (i + 1) * rowH - 2; c.font = '700 8.6px ' + F; c.fillStyle = BLK; c.fillText(r[0], bx0, yy); c.fillText(':', bx0 + labW, yy); c.font = '8.8px ' + F; c.fillText(fit(c, r[1] || '', 140), bx0 + labW + gap, yy);
    });
    c.font = '700 7.5px ' + F; c.fillText('Authorised Signatory', 34, 753); c.font = '7.5px ' + F; c.fillText(inv.certify || '', 34, 765);
    line(c, L, 781, 316, 781, 2.4, OR); line(c, 316, 781, R, 781, 2.4, BLK);
    c.textAlign = 'center'; c.font = '8.4px ' + FA; c.fillStyle = BLK; c.fillText(inv.footer || '', 286, 794);
    return cv;
  }
  function b64ToBytes(b64) { var s = atob(b64), a = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function strBytes(s) { var a = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; }
  function pdfOf(cv) {
    var url = cv.toDataURL('image/jpeg', 0.93), jb = b64ToBytes(url.slice(url.indexOf(',') + 1)), chunks = [], offs = [], pos = 0;
    function push(b) { if (typeof b === 'string') b = strBytes(b); chunks.push(b); pos += b.length; } function obj(n, body) { offs[n] = pos; push(n + ' 0 obj\n'); push(body); push('\nendobj\n'); }
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'); obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, '<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'); var content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q'; obj(4, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    offs[5] = pos; push('5 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jb.length + ' >>\nstream\n'); push(jb); push('\nendstream\nendobj\n');
    var xref = pos; push('xref\n0 6\n0000000000 65535 f \n'); for (var i = 1; i < 6; i++) push(('0000000000' + offs[i]).slice(-10) + ' 00000 n \n'); push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(pos), at = 0; chunks.forEach(function (ch) { out.set(ch, at); at += ch.length; }); return out;
  }
  function fileName(inv) { var clean = function (s, n) { return String(s || '').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_').slice(0, n); }; var first = (inv.items[0] && inv.items[0].desc || '').split('\n')[0].replace(/\(.*$/, ''); return clean(inv.no.replace(/\//g, '-').replace(/\s+/g, '-'), 30) + '_' + clean(inv.receiver.name, 40) + (first ? '_-_' + clean(first, 30) : '') + '.pdf'; }
  async function invoicePdf(inv) {
    try { toast('Making the invoice PDF…'); var cv = await drawInvoice(inv); await A.saveBinary(fileName(inv), pdfOf(cv)); } catch (e) { toast(e && e.message ? e.message : 'Could not make the PDF.', 'err'); }
  }

  /* ---------------------------------------------------------------- sync, backup */
  X.register('invoice', {
    collect: function () { return { records: V.list, settings: V.set, deleted: { i: X.readTombs('i') } }; },
    apply: function (rem) {
      var changed = 0, m = X.mergeKind(V.list, rem.records || [], X.readTombs('i'), (rem.deleted || {}).i), local = {}, keep = {};
      V.list.forEach(function (r) { local[r.id] = r; });
      m.list.forEach(function (r) { keep[r.id] = 1; if (!local[r.id] || JSON.stringify(local[r.id]) !== JSON.stringify(r)) { put(r); changed++; } });
      V.list.forEach(function (r) { if (!keep[r.id]) { drop(r.id); changed++; } });
      V.list = m.list.slice(); X.writeTombs('i', m.tombs);
      if (rem.settings && (rem.settings.updatedAt || '') > (V.set.updatedAt || '')) { V.set = Object.assign({}, DEFAULT_SET, rem.settings); try { localStorage.setItem(SKEY, JSON.stringify(V.set)); } catch (e) { /* ignore */ } changed++; }
      return { changed: changed };
    }
  });
  if (window.MBM && typeof window.MBM.makeBackup === 'function') {
    var prevB = window.MBM.makeBackup;
    window.MBM.makeBackup = function () { var b = prevB.apply(this, arguments); try { if (V.list.length) { b.officeTools = b.officeTools || {}; b.officeTools.invoices = { records: JSON.parse(JSON.stringify(V.list)), settings: V.set }; } } catch (e) { /* keep the normal backup */ } return b; };
  }
  if (window.MBM_OFFICE && typeof window.MBM_OFFICE.restore === 'function') {
    var prevR = window.MBM_OFFICE.restore;
    window.MBM_OFFICE.restore = function (o) {
      var note = prevR.apply(this, arguments) || '';
      if (o && o.invoices && Array.isArray(o.invoices.records)) { var n = 0; o.invoices.records.forEach(function (r) { if (r && typeof r.id === 'string' && r.receiver && Array.isArray(r.items)) { put(r); V.list = V.list.filter(function (x) { return x.id !== r.id; }); V.list.push(r); n++; } }); if (n) note += ' Also restored ' + plural(n, 'invoice') + '.'; }
      return note;
    };
  }
  window.MBM_INVOICE = { words: words, amountWords: amountWords, nextNo: nextNo, calc: calc, draw: drawInvoice, pdfOf: pdfOf, list: function () { return V.list; }, settings: V.set, fileName: fileName };

  var st = document.createElement('style');
  st.textContent = '.inv-check{display:flex;gap:12px;align-items:flex-start;font-size:15px;line-height:1.45;cursor:pointer}.inv-check input{width:22px;height:22px;min-height:0;margin-top:2px;flex:none;accent-color:var(--primary)}.inv-items{width:100%;border-collapse:separate;border-spacing:0}.inv-items th{background:transparent;text-align:left;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line-strong)}' +
    '.inv-items td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}.inv-items td.n{width:40px;color:var(--muted);font-family:var(--f-mono);padding-top:16px}.inv-items td.q{width:110px}.inv-items td.a{width:150px}.inv-items td.x{width:60px}.inv-items textarea{min-height:76px}.inv-hsn{margin-top:6px;max-width:220px}' +
    '.inv-tot{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:14px 0}.inv-tot>div{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;background:var(--gl-in);border:1px solid var(--gl-bd)}.inv-tot span{color:var(--muted);font-size:13px;font-weight:700;letter-spacing:.05em}.inv-tot b{font-family:var(--f-mono);font-size:17px;color:var(--ink)}.inv-tot .big{border-color:var(--primary)}.inv-tot .big b{color:var(--primary);font-size:22px}.inv-tot [hidden]{display:none}';
  document.head.appendChild(st);
})();
