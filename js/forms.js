/* Shared helpers for the tester pages: identity, drafts, rendering questions, and sending to the pilot's Sheet. */
(() => {
'use strict';
const ls = {
  get(k, d){ try{ const v = localStorage.getItem('pecan.' + k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem('pecan.' + k, JSON.stringify(v)); return true; }catch{ return false; } },
  del(k){ try{ localStorage.removeItem('pecan.' + k); }catch{} }
};
const settings = ls.get('pilot', {});
const PLATFORM = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS'
  : /Android/.test(navigator.userAgent) ? 'Android' : 'other';
const standalone = () => !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const endpoint = () => settings.hook || (window.PECAN_CONFIG && window.PECAN_CONFIG.logEndpoint) || '';
const testerCode = () => settings.tester || ls.get('tid', '') || '';
const recent = () => ls.get('events', []);
const appVersion = () => { const e = recent(); return e.length ? (e[e.length - 1].app || '') : ''; };
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));

// Same event shape the game sends, so the receiver logs it in Events and also files it in its own tab.
function send(type, tester, fields){
  const url = endpoint();
  if (!url) return Promise.reject(new Error('no endpoint'));
  const now = new Date();
  const ev = Object.assign({type, tester, at:now.toISOString(), day:localDay(now), session:'form', app:appVersion(),
    id:now.getTime().toString(36) + Math.floor(Math.random()*1e8).toString(36), platform:PLATFORM, standalone:standalone()}, fields);
  return fetch(url, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({v:1, events:[ev]})});
}

// Questions: {id, label, type: text|choice|checks|scale|para, options, ends, hint, required}
function render(root, questions, draft){
  root.innerHTML = questions.map(q => {
    if (q.section) return `<h2>${esc(q.section)}</h2>`;
    const req = q.required ? '<span class="req" aria-hidden="true">*</span>' : '';
    const hint = q.hint ? `<p class="hint">${esc(q.hint)}</p>` : '';
    const v = draft[q.id];
    if (q.type === 'text' || q.type === 'para'){
      const field = q.type === 'text'
        ? `<input type="text" id="${q.id}" name="${q.id}" value="${esc(v || '')}" autocomplete="off"${q.required ? ' required' : ''}>`
        : `<textarea id="${q.id}" name="${q.id}"${q.required ? ' required' : ''}>${esc(v || '')}</textarea>`;
      return `<div class="q" data-q="${q.id}"><label class="qt" for="${q.id}">${esc(q.label)}${req}</label>${hint}${field}</div>`;
    }
    if (q.type === 'scale'){
      const pills = [1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="${q.id}" value="${n}"${String(v) === String(n) ? ' checked' : ''}>${n}</label>`).join('');
      return `<fieldset data-q="${q.id}"><legend>${esc(q.label)}${req}</legend>${hint}<div class="scale">${pills}</div><div class="ends"><span>${esc(q.ends[0])}</span><span>${esc(q.ends[1])}</span></div></fieldset>`;
    }
    const multi = q.type === 'checks', chosen = multi ? (Array.isArray(v) ? v : []) : [v];
    const opts = q.options.map(o => `<label class="opt"><input type="${multi ? 'checkbox' : 'radio'}" name="${q.id}" value="${esc(o)}"${chosen.includes(o) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('');
    return `<fieldset data-q="${q.id}"><legend>${esc(q.label)}${req}</legend>${hint}<div class="opts">${opts}</div></fieldset>`;
  }).join('');
}
function collect(form, questions){
  const out = {};
  for (const q of questions){
    if (q.section) continue;
    if (q.type === 'checks') out[q.id] = [...form.querySelectorAll(`input[name="${q.id}"]:checked`)].map(i => i.value);
    else if (q.type === 'choice' || q.type === 'scale'){ const c = form.querySelector(`input[name="${q.id}"]:checked`); out[q.id] = c ? c.value : ''; }
    else out[q.id] = (form.querySelector(`[name="${q.id}"]`).value || '').trim();
  }
  return out;
}
// Returns the first unanswered required question, outlining every one that's missing.
function validate(form, questions, answers){
  let first = null;
  for (const q of questions){
    if (q.section) continue;
    const el = form.querySelector(`[data-q="${q.id}"]`);
    const empty = Array.isArray(answers[q.id]) ? !answers[q.id].length : !answers[q.id];
    const missing = !!q.required && empty;
    el.classList.toggle('missing', missing);
    if (missing && !first) first = el;
  }
  return first;
}

window.PecanForms = {ls, send, render, collect, validate, endpoint, testerCode, recent, appVersion, PLATFORM, standalone, esc};
})();
