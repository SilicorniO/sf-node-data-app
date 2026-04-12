'use strict';

import { state, uid, bus } from './state.js';
import { esc } from './utils.js';

let _view = 'list';

export function getView() { return _view; }
export function setView(v) { _view = v; }

export function addAction(data = {}) {
  const action = {
    id: uid(),
    name: data.name || '',
    inputSheet: data.inputSheet || '',
    outputSheet: data.outputSheet || '',
    waitStartingTime: data.waitStartingTime || 0,
    copySheetAction:  data.copySheetAction  || null,
    exportAction:     data.exportAction     || null,
    transformAction:  data.transformAction  || null,
    importAction:     data.importAction     || null,
  };
  state.actions.push(action);
  bus.emit('actions-changed');
  if (!data.name) bus.emit('modal-open', action.id);
}

export function removeAction(id) {
  state.actions = state.actions.filter(a => a.id !== id);
  bus.emit('actions-changed');
}

export function moveAction(id, dir) {
  const i = state.actions.findIndex(a => a.id === id);
  const j = i + dir;
  if (j < 0 || j >= state.actions.length) return;
  [state.actions[i], state.actions[j]] = [state.actions[j], state.actions[i]];
  bus.emit('actions-changed');
}

export function actionBadges(a) {
  const parts = [];
  if (a.copySheetAction) parts.push('<span class="badge badge-copy">COPY</span>');
  if (a.exportAction)    parts.push('<span class="badge badge-export">EXPORT</span>');
  if (a.transformAction) parts.push('<span class="badge badge-transform">TRANSFORM</span>');
  if (a.importAction) {
    const t = a.importAction.action || 'insert';
    parts.push(`<span class="badge badge-${t}">${t.toUpperCase()}</span>`);
  }
  return parts.join(' ');
}

export function renderActions() {
  const list  = document.getElementById('actions-list');
  const empty = document.getElementById('actions-empty');
  if (!list || !empty) return;

  document.getElementById('badge-actions').textContent = state.actions.length;

  if (!state.actions.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = state.actions.map((a, i) => `
    <div class="bg-white rounded-xl border border-slate-200 hover:border-indigo-200 transition" id="acard-${a.id}">
      <div class="flex items-center gap-3 px-4 py-3">
        <span class="w-7 h-7 bg-slate-100 text-slate-600 text-[11px] font-bold rounded-full flex items-center justify-center flex-shrink-0">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-slate-800 text-sm truncate">${esc(a.name || 'Unnamed Action')}</div>
          <div class="flex items-center gap-1 mt-0.5 text-[11px]">
            ${a.inputSheet ? `<span class="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-mono">${esc(a.inputSheet)}</span>` : `<span class="text-slate-300 italic">no input sheet</span>`}
            ${a.outputSheet && a.outputSheet !== a.inputSheet ? `<span class="text-slate-400">→</span><span class="bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-mono">${esc(a.outputSheet)}</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">${actionBadges(a)}</div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button onclick="window._sfApp.moveAction('${a.id}',-1)" ${i === 0 ? 'disabled' : ''} title="Move up"
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-25 text-base">↑</button>
          <button onclick="window._sfApp.moveAction('${a.id}',1)" ${i === state.actions.length - 1 ? 'disabled' : ''} title="Move down"
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-25 text-base">↓</button>
          <button onclick="window._sfApp.openModal('${a.id}')" title="Edit"
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 text-base">✎</button>
          <button onclick="window._sfApp.removeAction('${a.id}')" title="Delete"
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500 text-base">×</button>
        </div>
      </div>
      ${(a.copySheetAction || a.exportAction || a.transformAction || a.importAction) ? `
      <div class="border-t border-slate-50 px-4 pb-2.5 pt-2 flex flex-wrap gap-1.5 text-[11px]">
        ${a.copySheetAction  ? `<span class="bg-violet-50 text-violet-700 rounded px-2 py-0.5"><b>Copy</b> ${a.copySheetAction.copyFields?.length || 0} fields</span>` : ''}
        ${a.exportAction     ? `<span class="bg-blue-50 text-blue-700 rounded px-2 py-0.5 max-w-xs truncate" title="${esc(a.exportAction.query)}"><b>Export</b> ${esc((a.exportAction.query || '').substring(0, 60))}${(a.exportAction.query || '').length > 60 ? '…' : ''}</span>` : ''}
        ${a.transformAction  ? `<span class="bg-amber-50 text-amber-700 rounded px-2 py-0.5"><b>Transform</b> ${a.transformAction.fieldsConf?.length || 0} fields</span>` : ''}
        ${a.importAction     ? `<span class="bg-green-50 text-green-700 rounded px-2 py-0.5"><b>${(a.importAction.action || 'insert').toUpperCase()}</b> → ${esc(a.importAction.objectName || '')}</span>` : ''}
      </div>` : ''}
    </div>
  `).join('');
}

export function renderDiagram() {
  const svg = document.getElementById('diagram-svg');
  if (!svg) return;
  const acts = state.actions;

  if (!acts.length) {
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '240');
    svg.innerHTML = `<text x="50%" y="120" text-anchor="middle" font-size="13" fill="#94a3b8" dominant-baseline="middle">No actions yet — add some in the List view.</text>`;
    return;
  }

  const sheetOrder = [];
  const sheetSI    = {};
  acts.forEach(a => {
    [a.inputSheet, a.outputSheet].filter(Boolean).forEach(s => {
      if (!(s in sheetSI)) { sheetSI[s] = sheetOrder.length; sheetOrder.push(s); }
    });
  });

  const PAL = [
    { bg: '#e0e7ff', st: '#818cf8', tx: '#4338ca' },
    { bg: '#dcfce7', st: '#4ade80', tx: '#15803d' },
    { bg: '#fef9c3', st: '#fbbf24', tx: '#78350f' },
    { bg: '#fce7f3', st: '#f472b6', tx: '#9d174d' },
    { bg: '#e0f2fe', st: '#38bdf8', tx: '#0369a1' },
    { bg: '#f3e8ff', st: '#c084fc', tx: '#7e22ce' },
    { bg: '#fff7ed', st: '#fb923c', tx: '#9a3412' },
    { bg: '#ecfdf5', st: '#34d399', tx: '#065f46' },
  ];
  const colMap = {};
  sheetOrder.forEach((s, i) => { colMap[s] = PAL[i % PAL.length]; });
  const sc = s => colMap[s] || PAL[0];

  const LABEL_W = 152, STEP_W = 152, LANE_H = 62, HDR_H = 90;
  const ML = 10, MR = 14, SF_H = 30, CIRC_R = 9;

  const nS = sheetOrder.length, nA = acts.length;
  const CW = ML + LABEL_W + nA * STEP_W + MR;
  const CH = HDR_H + nS * LANE_H + SF_H;

  const laneTop = si => HDR_H + si * LANE_H;
  const laneMid = si => HDR_H + si * LANE_H + LANE_H / 2;
  const lMid    = s  => (s in sheetSI) ? laneMid(sheetSI[s]) : HDR_H;
  const colL    = ai => ML + LABEL_W + ai * STEP_W;
  const colM    = ai => colL(ai) + STEP_W / 2;

  const svgEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const trn    = (s, n = 17) => s.length > n ? s.slice(0, n - 1) + '…' : s;

  let o = '';

  o += `<defs><style>
.anode:hover .abox{stroke:#818cf8!important;stroke-width:2.5!important;}
.anode:hover .ahov{fill:rgba(255,255,255,.06);}
</style></defs>`;

  o += `<rect width="${CW}" height="${CH}" fill="#f1f5f9"/>`;

  sheetOrder.forEach((s, si) => {
    const c = sc(s), ty = laneTop(si);
    o += `<rect x="${ML + LABEL_W}" y="${ty}" width="${nA * STEP_W + MR}" height="${LANE_H}" fill="${si % 2 === 0 ? '#fff' : '#f8fafc'}"/>`;
    o += `<rect x="${ML}" y="${ty}" width="${LABEL_W}" height="${LANE_H}" fill="${c.bg}" opacity="0.55"/>`;
    o += `<rect x="${ML}" y="${ty + 10}" width="4" height="${LANE_H - 20}" rx="2" fill="${c.st}"/>`;
    o += `<line x1="${ML}" y1="${ty}" x2="${CW}" y2="${ty}" stroke="#e2e8f0" stroke-width="1"/>`;
  });
  o += `<line x1="${ML}" y1="${HDR_H + nS * LANE_H}" x2="${CW}" y2="${HDR_H + nS * LANE_H}" stroke="#e2e8f0" stroke-width="1"/>`;
  o += `<line x1="${ML + LABEL_W}" y1="${HDR_H}" x2="${ML + LABEL_W}" y2="${HDR_H + nS * LANE_H}" stroke="#cbd5e1" stroke-width="1"/>`;

  for (let ai = 1; ai < nA; ai++) {
    const x = colL(ai);
    o += `<line x1="${x}" y1="${HDR_H}" x2="${x}" y2="${HDR_H + nS * LANE_H}" stroke="#e2e8f0" stroke-width="1"/>`;
  }

  o += `<rect width="${CW}" height="${HDR_H}" fill="#1e293b"/>`;

  sheetOrder.forEach(s => {
    const c = sc(s), cy = lMid(s);
    const touching = acts.reduce((arr, a, ai) => {
      const outS = a.outputSheet || a.inputSheet;
      if (a.inputSheet === s || outS === s) arr.push(ai);
      return arr;
    }, []);
    for (let k = 0; k < touching.length - 1; k++) {
      const x1 = colM(touching[k]) + CIRC_R + 1;
      const x2 = colM(touching[k + 1]) - CIRC_R - 1;
      if (x2 <= x1) continue;
      const mx = (x1 + x2) / 2;
      o += `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="${c.st}" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.6"/>`;
      o += `<polygon points="${mx - 4},${cy - 3.5} ${mx + 5},${cy} ${mx - 4},${cy + 3.5}" fill="${c.st}" opacity="0.75"/>`;
    }
  });

  acts.forEach((a, ai) => {
    const cx   = colM(ai);
    const inS  = a.inputSheet;
    const outS = a.outputSheet || a.inputSheet;
    const touched = [...new Set([inS, outS].filter(Boolean))];

    if (!touched.length) {
      o += `<line x1="${cx}" y1="${HDR_H}" x2="${cx}" y2="${HDR_H + LANE_H / 2}" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.35"/>`;
      return;
    }

    const ys   = touched.map(s => lMid(s));
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    o += `<line x1="${cx}" y1="${HDR_H}" x2="${cx}" y2="${minY}" stroke="#475569" stroke-width="1.5" opacity="0.45"/>`;
    if (minY !== maxY) {
      o += `<line x1="${cx}" y1="${minY}" x2="${cx}" y2="${maxY}" stroke="#475569" stroke-width="2" opacity="0.55"/>`;
    }

    touched.forEach(s => {
      const c  = sc(s);
      const cy = lMid(s);
      const isProducing = outS === s && a.outputSheet && a.outputSheet !== a.inputSheet;
      if (isProducing) {
        o += `<circle cx="${cx}" cy="${cy}" r="${CIRC_R}" fill="${c.st}" stroke="white" stroke-width="1.5"/>`;
        o += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="white" font-weight="900">+</text>`;
      } else {
        o += `<circle cx="${cx}" cy="${cy}" r="${CIRC_R}" fill="${c.bg}" stroke="${c.st}" stroke-width="2"/>`;
        o += `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${c.st}" opacity="0.8"/>`;
      }
    });
  });

  sheetOrder.forEach((s, si) => {
    const c = sc(s), cy = laneMid(si);
    o += `<text x="${ML + LABEL_W - 10}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="11" font-family="ui-monospace,monospace" fill="${c.tx}" font-weight="700">${svgEsc(trn(s))}</text>`;
  });

  const sfColors = {
    insert: { bg: '#f0fdf4', st: '#22c55e', tx: '#15803d' },
    update: { bg: '#e0f2fe', st: '#0ea5e9', tx: '#0369a1' },
    upsert: { bg: '#eef2ff', st: '#6366f1', tx: '#4338ca' },
    delete: { bg: '#fff1f2', st: '#f43f5e', tx: '#be123c' },
  };
  acts.forEach((a, ai) => {
    if (!a.importAction) return;
    const cx  = colM(ai);
    const sfY = HDR_H + nS * LANE_H;
    const act = a.importAction.action || 'insert';
    const obj = a.importAction.objectName || '';
    const sfc = sfColors[act] || sfColors.insert;
    const tw = 78, th = 22, ty = sfY + 4;
    o += `<line x1="${cx}" y1="${sfY}" x2="${cx}" y2="${ty}" stroke="${sfc.st}" stroke-width="1.5" opacity="0.75"/>`;
    o += `<rect x="${cx - tw / 2}" y="${ty}" width="${tw}" height="${th}" rx="5" fill="${sfc.bg}" stroke="${sfc.st}" stroke-width="1"/>`;
    o += `<text x="${cx}" y="${ty + 8}" text-anchor="middle" dominant-baseline="middle" font-size="7" font-weight="700" fill="${sfc.tx}" font-family="sans-serif">SF · ${act.toUpperCase()}</text>`;
    o += `<text x="${cx}" y="${ty + 16}" text-anchor="middle" dominant-baseline="middle" font-size="7.5" fill="${sfc.tx}" font-family="ui-monospace,monospace">${svgEsc(trn(obj, 10))}</text>`;
  });

  const BW = STEP_W - 12, BH = HDR_H - 12;
  acts.forEach((a, ai) => {
    const cx = colM(ai), bx = cx - BW / 2, by = 6;

    const badges = [];
    if (a.copySheetAction) badges.push({ l: 'COPY',   bg: '#ede9fe', tx: '#6d28d9' });
    if (a.exportAction)    badges.push({ l: 'EXPORT',  bg: '#dbeafe', tx: '#1d4ed8' });
    if (a.transformAction) badges.push({ l: 'TRANSF',  bg: '#fef3c7', tx: '#92400e' });
    if (a.importAction) {
      const t = a.importAction.action || 'insert';
      badges.push({
        l: t.toUpperCase(),
        bg: ({ insert: '#dcfce7', update: '#cffafe', upsert: '#e0e7ff', delete: '#fee2e2' }[t] || '#dcfce7'),
        tx: ({ insert: '#15803d', update: '#0e7490', upsert: '#3730a3', delete: '#991b1b' }[t] || '#15803d'),
      });
    }

    o += `<g class="anode" onclick="window._sfApp.openModal('${a.id}')" style="cursor:pointer">`;
    o += `<rect class="abox" x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="8" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>`;
    o += `<text x="${bx + 8}" y="${by + 11}" font-size="7.5" fill="#475569" font-weight="700" font-family="sans-serif">#${ai + 1}</text>`;
    const hasB = badges.length > 0;
    o += `<text x="${cx}" y="${by + BH / 2 - (hasB ? 7 : 0)}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="#e2e8f0" font-family="sans-serif">${svgEsc(trn(a.name || 'Unnamed', 18))}</text>`;
    if (hasB) {
      let bx2 = bx + 6, bY = by + BH - 16;
      badges.forEach(b => {
        const blen = b.l.length * 4.5 + 8;
        o += `<rect x="${bx2}" y="${bY}" width="${blen}" height="11" rx="2" fill="${b.bg}"/>`;
        o += `<text x="${bx2 + blen / 2}" y="${bY + 5.5}" text-anchor="middle" dominant-baseline="middle" font-size="6.5" font-weight="800" fill="${b.tx}" font-family="sans-serif">${b.l}</text>`;
        bx2 += blen + 3;
      });
    }
    o += `<rect class="ahov" x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="8" fill="transparent"/></g>`;
  });

  svg.setAttribute('viewBox', `0 0 ${CW} ${CH}`);
  svg.setAttribute('width', CW);
  svg.setAttribute('height', CH);
  svg.innerHTML = o;
}

export function dZoom(f) {
  const svg = document.getElementById('diagram-svg');
  const w = parseFloat(svg.getAttribute('width') || '790');
  svg.setAttribute('width', w * f);
}

export function dFit() {
  document.getElementById('diagram-svg').setAttribute('width', '100%');
}
