import dagre from '@dagrejs/dagre';
import { buildDiagramGraph, SALESFORCE_NODE_ID } from '../diagram-model.js';
import { sheetCatalog } from '../actions.js';
import { esc } from '../utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Layout metrics.
const NODE_WIDTH = 190;
const NODE_HEIGHT = 62;
const SF_WIDTH = 150;
const SF_HEIGHT = 82;
const PADDING = 48;

// Action type -> arrow colour. Mirrors the .type-* families in main.css.
const TYPE_COLOR = {
  get: '#2563eb',
  insert: '#16a34a',
  update: '#0891b2',
  upsert: '#4f46e5',
  delete: '#dc2626',
  transform: '#d97706',
  merge: '#9333ea',
};

const TYPE_ICON = {
  get: '⭳',
  insert: '＋',
  update: '↻',
  upsert: '⇅',
  delete: '×',
  transform: 'ƒ',
  merge: '⋈',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class SfDiagramPanel extends HTMLElement {
  constructor() {
    super();
    // View transform (pan/zoom) applied to the SVG root group.
    this.view = { x: 0, y: 0, scale: 1 };
    this.selection = null; // { kind: 'node'|'edge', id }
    this.graph = { nodes: [], edges: [] };
    this.layout = null;
    this.pan = null; // active pointer-drag state
  }

  // `state` is passed in from the host each render so this component stays
  // free of a direct store dependency.
  update(state) {
    this.state = state;
    const catalog = sheetCatalog(state, state.actions.length);
    this.graph = buildDiagramGraph(state, catalog);
    this.layout = this.graph.nodes.length ? computeLayout(this.graph) : null;
    // Drop a stale selection if its target no longer exists.
    if (this.selection && !this.findSelection()) this.selection = null;
    this.render();
    if (this.layout && !this._hasFitted) {
      // Defer to after layout so the canvas has measurable dimensions.
      requestAnimationFrame(() => {
        if (this._hasFitted) return;
        if (this.fit()) this._hasFitted = true;
      });
    }
  }

  findSelection() {
    if (!this.selection) return null;
    if (this.selection.kind === 'node') return this.graph.nodes.find(n => n.id === this.selection.id);
    return this.graph.edges.find(e => e.id === this.selection.id);
  }

  render() {
    if (!this.layout) {
      this.innerHTML = `<section class="panel-section diagram-empty">
        <div class="empty-state">
          <div class="empty-icon">◇</div>
          <h3>Nothing to diagram yet</h3>
          <p>Add pipeline actions to see how data flows between sheets and Salesforce.</p>
        </div>
      </section>`;
      return;
    }

    this.innerHTML = `
      <div class="diagram-wrap">
        <div class="diagram-toolbar">
          <div class="diagram-legend">${this.legend()}</div>
          <div class="diagram-controls">
            <button class="icon-button" data-zoom="out" title="Zoom out">−</button>
            <button class="icon-button" data-zoom="in" title="Zoom in">＋</button>
            <button class="button secondary compact-button" data-fit>Fit</button>
          </div>
        </div>
        <div class="diagram-canvas" data-canvas>
          ${this.svgMarkup()}
        </div>
        ${this.detailPanel()}
      </div>`;
    this.bind();
    this.applyTransform();
  }

  legend() {
    const present = new Set(this.graph.edges.map(edge => edge.type));
    return [...present]
      .map(type => `<span class="diagram-legend-item"><i style="background:${TYPE_COLOR[type] || '#64748b'}"></i>${esc(type)}</span>`)
      .join('');
  }

  svgMarkup() {
    const { width, height } = this.layout;
    const arrowDefs = Object.entries(TYPE_COLOR).map(([type, color]) => `
      <marker id="arrow-${type}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="${color}"></path>
      </marker>`).join('');

    // width/height reserved for future use; the SVG fills the canvas and the
    // root group is pan/zoomed to reveal the full layout.
    void width; void height;
    return `<svg class="diagram-svg" width="100%" height="100%">
      <defs>${arrowDefs}</defs>
      <g data-root transform="translate(0,0) scale(1)">
        <g data-edges>${this.graph.edges.map(edge => this.edgeMarkup(edge)).join('')}</g>
        <g data-nodes>${this.graph.nodes.map(node => this.nodeMarkup(node)).join('')}</g>
      </g>
    </svg>`;
  }

  nodeMarkup(node) {
    const pos = this.layout.nodes.get(node.id);
    if (!pos) return '';
    const selected = this.selection?.kind === 'node' && this.selection.id === node.id;
    const w = pos.width;
    const h = pos.height;
    const x = pos.x - w / 2;
    const y = pos.y - h / 2;

    if (node.kind === 'salesforce') {
      return `<g class="dg-node dg-salesforce ${selected ? 'selected' : ''}" data-node="${esc(node.id)}" transform="translate(${x},${y})">
        <rect width="${w}" height="${h}" rx="16"></rect>
        <text class="dg-sf-icon" x="${w / 2}" y="${h / 2 - 6}" text-anchor="middle">☁</text>
        <text class="dg-sf-label" x="${w / 2}" y="${h / 2 + 18}" text-anchor="middle">Salesforce</text>
      </g>`;
    }

    const count = node.fieldCount == null ? '' : `${node.fieldCount} ${node.fieldCount === 1 ? 'field' : 'fields'}`;
    return `<g class="dg-node dg-sheet ${node.isError ? 'is-error' : ''} ${selected ? 'selected' : ''}" data-node="${esc(node.id)}" transform="translate(${x},${y})">
      <rect width="${w}" height="${h}" rx="12"></rect>
      <text class="dg-sheet-name" x="12" y="26">${esc(truncate(node.name, 24))}</text>
      <text class="dg-sheet-meta" x="12" y="46">${esc(count)}${node.isError ? ' · errors' : ''}</text>
    </g>`;
  }

  edgeMarkup(edge) {
    const path = this.layout.edges.get(edge.id);
    if (!path) return '';
    const color = TYPE_COLOR[edge.type] || '#64748b';
    const selected = this.selection?.kind === 'edge' && this.selection.id === edge.id;
    const { d, mid } = path;
    const label = `${TYPE_ICON[edge.type] || ''} ${edge.name || edge.type}${edge.object ? ` → ${edge.object}` : ''}`;
    // The step badge is always visible; the text label rides on the curve but
    // only fully renders on hover/selection so hub nodes stay uncluttered.
    return `<g class="dg-edge ${selected ? 'selected' : ''}" data-edge="${esc(edge.id)}">
      <path class="dg-edge-hit" d="${d}"></path>
      <path class="dg-edge-line" d="${d}" stroke="${color}" marker-end="url(#arrow-${edge.type})"></path>
      <g class="dg-edge-label" transform="translate(${mid.x},${mid.y})">
        <text class="dg-edge-text" x="15" dy="4">${esc(truncate(label, 30))}</text>
        <circle class="dg-step" r="11" fill="${color}"></circle>
        <text class="dg-step-text" text-anchor="middle" dy="3.5">${edge.step}</text>
      </g>
    </g>`;
  }

  detailPanel() {
    const target = this.findSelection();
    if (!target) {
      return `<aside class="diagram-detail empty"><p>Select a sheet or an action to see its details.</p></aside>`;
    }
    const body = this.selection.kind === 'node' ? this.nodeDetail(target) : this.edgeDetail(target);
    return `<aside class="diagram-detail">
      <button class="icon-button diagram-detail-close" data-close-detail title="Close">×</button>
      ${body}
    </aside>`;
  }

  nodeDetail(node) {
    if (node.kind === 'salesforce') {
      return `<h3 class="dg-detail-title">Salesforce</h3>
        <p class="dg-detail-sub">The connected org — source of GET results and target of writes.</p>`;
    }
    const sheet = (this.state.sheets || []).find(s => s.name.toLowerCase() === node.name.toLowerCase());
    const declared = sheet
      ? `<div class="dg-detail-section"><h4>Column mapping</h4>
          <table class="dg-detail-table"><thead><tr><th>Input</th><th>API field</th></tr></thead>
          <tbody>${(sheet.fields || []).map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.translate && f.apiName ? f.apiName : f.name)}</td></tr>`).join('') || '<tr><td colspan="2">No columns</td></tr>'}</tbody></table>
        </div>`
      : `<p class="dg-detail-sub">Produced during the pipeline (not a declared input sheet).</p>`;
    return `<h3 class="dg-detail-title">${esc(node.name)}${node.isError ? ' <span class="dg-tag error">error sheet</span>' : ''}</h3>
      <p class="dg-detail-sub">${node.fieldCount == null ? 'Unknown field count' : `${node.fieldCount} declared field${node.fieldCount === 1 ? '' : 's'}`}</p>
      ${declared}`;
  }

  edgeDetail(edge) {
    const action = (this.state.actions || [])[edge.step - 1] || {};
    const color = TYPE_COLOR[edge.type] || '#64748b';
    const rows = [];
    const row = (label, value) => { if (value != null && value !== '') rows.push([label, value]); };
    row('Type', edge.type);
    row('Object', action.object);
    row('Input sheet', action.inputSheet);
    row('Primary sheet', action.primarySheet);
    row('Secondary sheet', action.secondarySheet);
    row('Output sheet', action.outputSheet);
    row('External Id field', action.externalIdField);
    row('Id field', action.idField);
    row('Error sheet', action.errorSheet || (action.name ? `${action.name}-errors` : ''));
    row('Error rows', action.errorRows);
    row('Wait before (s)', action.waitBeforeSeconds ? action.waitBeforeSeconds : '');
    row('Continue on error', action.continueOnError ? 'yes' : '');

    const fields = (action.fields || []).length
      ? `<div class="dg-detail-section"><h4>Fields</h4><div class="dg-chips">${action.fields.map(f => `<span class="dg-chip">${esc(f)}</span>`).join('')}</div></div>`
      : '';
    const query = action.query
      ? `<div class="dg-detail-section"><h4>Query</h4><pre class="dg-detail-code">${esc(action.query)}</pre></div>`
      : '';
    const script = action.scriptContent
      ? `<div class="dg-detail-section"><h4>Script</h4><pre class="dg-detail-code">${esc(truncate(action.scriptContent, 600))}</pre><p class="dg-detail-note">A transform may also read other sheets at runtime via <code>lookup()</code>; those links are not drawn.</p></div>`
      : '';

    return `<h3 class="dg-detail-title"><span class="dg-step-badge" style="background:${color}">${edge.step}</span> ${esc(action.name || 'Unnamed action')}</h3>
      <table class="dg-detail-table kv"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
      ${fields}${query}${script}`;
  }

  bind() {
    this.querySelector('[data-fit]')?.addEventListener('click', () => this.fit());
    this.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click', () => {
      this.zoomBy(button.dataset.zoom === 'in' ? 1.2 : 1 / 1.2);
    }));
    this.querySelector('[data-close-detail]')?.addEventListener('click', () => {
      this.selection = null;
      this.render();
    });

    this.querySelectorAll('[data-node]').forEach(el => el.addEventListener('click', event => {
      event.stopPropagation();
      this.select('node', el.dataset.node);
    }));
    this.querySelectorAll('[data-edge]').forEach(el => el.addEventListener('click', event => {
      event.stopPropagation();
      this.select('edge', el.dataset.edge);
    }));

    const canvas = this.querySelector('[data-canvas]');
    if (!canvas) return;
    canvas.addEventListener('click', () => { if (this.selection) { this.selection = null; this.render(); } });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // Scale the step by scroll delta so a small trackpad flick barely zooms;
      // clamped so a single big wheel notch can't jump too far.
      const factor = Math.exp(clamp(-event.deltaY, -40, 40) * 0.002);
      this.zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    canvas.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-node],[data-edge]')) return;
      this.pan = { x: event.clientX, y: event.clientY, vx: this.view.x, vy: this.view.y };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.pan) return;
      this.view.x = this.pan.vx + (event.clientX - this.pan.x);
      this.view.y = this.pan.vy + (event.clientY - this.pan.y);
      this.applyTransform();
    });
    const endPan = () => { this.pan = null; canvas.classList.remove('grabbing'); };
    canvas.addEventListener('pointerup', endPan);
    canvas.addEventListener('pointercancel', endPan);
  }

  select(kind, id) {
    this.selection = { kind, id };
    this.render();
  }

  applyTransform() {
    const root = this.querySelector('[data-root]');
    if (root) root.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`);
  }

  zoomBy(factor) {
    const canvas = this.querySelector('[data-canvas]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.zoomAt(factor, rect.width / 2, rect.height / 2);
  }

  zoomAt(factor, cx, cy) {
    const next = clamp(this.view.scale * factor, 0.2, 2.5);
    const applied = next / this.view.scale;
    // Keep the point under the cursor fixed while scaling.
    this.view.x = cx - (cx - this.view.x) * applied;
    this.view.y = cy - (cy - this.view.y) * applied;
    this.view.scale = next;
    this.applyTransform();
  }

  fit() {
    const canvas = this.querySelector('[data-canvas]');
    if (!canvas || !this.layout) return false;
    const rect = canvas.getBoundingClientRect();
    const { width, height } = this.layout;
    if (!width || !height || !rect.width || !rect.height) return false;
    const scale = clamp(Math.min(rect.width / width, rect.height / height) * 0.92, 0.2, 1.5);
    this.view.scale = scale;
    this.view.x = (rect.width - width * scale) / 2;
    this.view.y = (rect.height - height * scale) / 2;
    this.applyTransform();
    return true;
  }
}

// Run dagre and translate its output into node positions + bezier edge paths.
function computeLayout(graph) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: 'LR',
    nodesep: 70,
    ranksep: 150,
    edgesep: 30,
    marginx: PADDING,
    marginy: PADDING,
  });
  g.setDefaultEdgeLabel(() => ({}));

  graph.nodes.forEach(node => {
    const isSf = node.kind === 'salesforce';
    g.setNode(node.id, { width: isSf ? SF_WIDTH : NODE_WIDTH, height: isSf ? SF_HEIGHT : NODE_HEIGHT });
  });
  graph.edges.forEach(edge => {
    // Reserve horizontal room for the edge label so dagre spaces ranks enough
    // that labels don't land on top of the next node.
    g.setEdge(edge.from, edge.to, { minlen: 1, width: 120, height: 24, labelpos: 'c' }, edge.id);
  });

  dagre.layout(g);

  const nodes = new Map();
  graph.nodes.forEach(node => {
    const n = g.node(node.id);
    if (n) nodes.set(node.id, { x: n.x, y: n.y, width: n.width, height: n.height });
  });

  const edges = new Map();
  graph.edges.forEach(edge => {
    const e = g.edge(edge.from, edge.to, edge.id);
    if (!e || !e.points || e.points.length < 2) return;
    const path = buildEdgePath(e.points);
    // dagre positions a collision-avoided label box at (e.x, e.y); prefer it.
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) path.mid = { x: e.x, y: e.y };
    edges.set(edge.id, path);
  });

  const gg = g.graph();
  const width = (gg.width || 0) + PADDING;
  const height = (gg.height || 0) + PADDING;
  return { nodes, edges, width, height };
}

// Smooth the dagre polyline into a rounded cubic-bezier path (Catmull-Rom).
function buildEdgePath(points) {
  const pts = points;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  const mid = pts[Math.floor(pts.length / 2)];
  return { d, mid: { x: mid.x, y: mid.y } };
}

function truncate(value, max) {
  const str = String(value ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

customElements.define('sf-diagram-panel', SfDiagramPanel);
