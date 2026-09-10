import { buildDiagramGraph } from '../diagram-model.js';
import { sheetCatalog } from '../actions.js';
import { esc } from '../utils.js';

// Layout metrics.
const NODE_WIDTH = 190;
const NODE_HEIGHT = 62;
const SF_WIDTH = 150;
const SF_HEIGHT = 82;
const PADDING = 48;
const ROW_HEIGHT = 108;          // vertical pitch between lanes
const COLUMN_GAP_MIN = 60;       // horizontal gap between columns (excl. box width)
const COLUMN_GAP_MAX = 420;
const COLUMN_GAP_DEFAULT = 150;

// Action type -> arrow colour. Mirrors the .type-* families in main.css.
const TYPE_COLOR = {
  get: '#2563eb',
  insert: '#16a34a',
  update: '#0891b2',
  upsert: '#4f46e5',
  delete: '#dc2626',
  transform: '#d97706',
  merge: '#9333ea',
  check: '#0d9488',
};

const TYPE_ICON = {
  get: '⭳',
  insert: '＋',
  update: '↻',
  upsert: '⇅',
  delete: '×',
  transform: 'ƒ',
  merge: '⋈',
  check: '✓',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class SfDiagramPanel extends HTMLElement {
  constructor() {
    super();
    // View transform (pan/zoom) applied to the SVG root group.
    this.view = { x: 0, y: 0, scale: 1 };
    this.selection = null; // { kind: 'node'|'edge', id }
    this.graph = { nodes: [], edges: [], columnCount: 0 };
    this.layout = null;
    this.pan = null; // active pointer-drag state
    this.columnGap = COLUMN_GAP_DEFAULT;
  }

  // `state` is passed in from the host each render so this component stays
  // free of a direct store dependency.
  update(state) {
    this.state = state;
    const catalog = sheetCatalog(state, state.actions.length);
    this.graph = buildDiagramGraph(state, catalog);
    this.layout = this.graph.nodes.length ? this.computeLayout() : null;
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
            <label class="diagram-gap" title="Spacing between columns">
              <span>Spacing</span>
              <input type="range" min="${COLUMN_GAP_MIN}" max="${COLUMN_GAP_MAX}" step="10" value="${this.columnGap}" data-gap>
            </label>
            <div class="diagram-zoom" role="group" aria-label="Zoom">
              <button class="icon-button" data-zoom="out" title="Zoom out">−</button>
              <button class="dg-zoom-level" data-zoom="reset" title="Reset zoom to 100%">${Math.round(this.view.scale * 100)}%</button>
              <button class="icon-button" data-zoom="in" title="Zoom in">＋</button>
            </div>
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
    const arrowDefs = Object.entries(TYPE_COLOR).map(([type, color]) => `
      <marker id="arrow-${type}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="${color}"></path>
      </marker>`).join('');

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

    if (node.kind === 'check') {
      return `<g class="dg-node dg-check ${selected ? 'selected' : ''}" data-node="${esc(node.id)}" transform="translate(${x},${y})">
        <rect width="${w}" height="${h}" rx="16"></rect>
        <text class="dg-check-icon" x="${w / 2}" y="${h / 2 - 6}" text-anchor="middle">✓</text>
        <text class="dg-check-label" x="${w / 2}" y="${h / 2 + 18}" text-anchor="middle">${esc(truncate(node.name, 16))}</text>
      </g>`;
    }

    const count = node.fieldCount == null ? '' : `${node.fieldCount} ${node.fieldCount === 1 ? 'field' : 'fields'}`;
    // A superseded (re-written) sheet carries a small "overwrites" badge.
    const badge = node.supersedes
      ? `<g class="dg-supersede-badge" transform="translate(${w - 8},-8)">
          <rect class="dg-supersede-rect" x="-96" width="96" height="18" rx="9"></rect>
          <text class="dg-supersede-text" x="-48" y="13" text-anchor="middle">↻ overwrites</text>
        </g>`
      : '';
    return `<g class="dg-node dg-sheet ${node.isError ? 'is-error' : ''} ${selected ? 'selected' : ''}" data-node="${esc(node.id)}" transform="translate(${x},${y})">
      <rect width="${w}" height="${h}" rx="12"></rect>
      <text class="dg-sheet-name" x="12" y="26">${esc(truncate(node.name, 24))}</text>
      <text class="dg-sheet-meta" x="12" y="46">${esc(count)}${node.isError ? ' · errors' : ''}</text>
      ${badge}
    </g>`;
  }

  edgeMarkup(edge) {
    const path = this.layout.edges.get(edge.id);
    if (!path) return '';
    const color = TYPE_COLOR[edge.type] || '#64748b';
    const selected = this.selection?.kind === 'edge' && this.selection.id === edge.id;
    const { d, mid } = path;
    // The action IS the vector; its name is always visible (truncated). The
    // secondary segment of a multi-step action (e.g. insert -> output) is
    // unlabeled since the same action continues through the Salesforce box.
    const label = edge.labeled
      ? `${TYPE_ICON[edge.type] || ''} ${edge.name || edge.type}${edge.object ? ` → ${edge.object}` : ''}`
      : '';
    const labelMarkup = label
      ? `<g class="dg-edge-label" transform="translate(${mid.x},${mid.y})">
          <text class="dg-edge-text" text-anchor="middle" dy="-6">${esc(truncate(label, 40))}</text>
        </g>`
      : '';
    return `<g class="dg-edge ${selected ? 'selected' : ''}" data-edge="${esc(edge.id)}">
      <path class="dg-edge-hit" d="${d}"></path>
      <path class="dg-edge-line" d="${d}" stroke="${color}" marker-end="url(#arrow-${edge.type})"></path>
      ${labelMarkup}
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
    if (node.kind === 'check') {
      return `<h3 class="dg-detail-title">${esc(node.name)}</h3>
        <p class="dg-detail-sub">A CHECK action: a script asserts a condition over its input sheets. Select an incoming arrow for the check's details.</p>`;
    }
    const sheet = (this.state.sheets || []).find(s => s.name.toLowerCase() === node.name.toLowerCase());
    const declared = sheet
      ? `<div class="dg-detail-section"><h4>Column mapping</h4>
          <table class="dg-detail-table"><thead><tr><th>Input</th><th>API field</th></tr></thead>
          <tbody>${(sheet.fields || []).map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.translate && f.apiName ? f.apiName : f.name)}</td></tr>`).join('') || '<tr><td colspan="2">No columns</td></tr>'}</tbody></table>
        </div>`
      : `<p class="dg-detail-sub">Produced during the pipeline (not a declared input sheet).</p>`;
    const supersede = node.supersedes
      ? `<p class="dg-detail-note">This box re-writes an earlier sheet of the same name; later reads use this newer version.</p>`
      : '';
    return `<h3 class="dg-detail-title">${esc(node.name)}${node.isError ? ' <span class="dg-tag error">error sheet</span>' : ''}</h3>
      <p class="dg-detail-sub">${node.fieldCount == null ? 'Unknown field count' : `${node.fieldCount} declared field${node.fieldCount === 1 ? '' : 's'}`}</p>
      ${supersede}${declared}`;
  }

  edgeDetail(edge) {
    const action = (this.state.actions || [])[edge.actionIndex] || {};
    const color = TYPE_COLOR[edge.type] || '#64748b';
    const rows = [];
    const row = (label, value) => { if (value != null && value !== '') rows.push([label, value]); };
    row('Type', edge.type);
    row('Object', action.object);
    row('Input sheet', action.inputSheet);
    row('Input sheets', (action.inputSheets || []).join(', '));
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
    const scriptNote = edge.type === 'check'
      ? 'The check returns true to pass; false is treated like a row error. It may also read other sheets via <code>lookup()</code>; those links are not drawn.'
      : 'A transform may also read other sheets at runtime via <code>lookup()</code>; those links are not drawn.';
    const script = action.scriptContent
      ? `<div class="dg-detail-section"><h4>Script</h4><pre class="dg-detail-code">${esc(truncate(action.scriptContent, 600))}</pre><p class="dg-detail-note">${scriptNote}</p></div>`
      : '';

    return `<h3 class="dg-detail-title"><span class="dg-type-dot" style="background:${color}"></span> ${esc(action.name || 'Unnamed action')}</h3>
      <table class="dg-detail-table kv"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
      ${fields}${query}${script}`;
  }

  bind() {
    this.querySelector('[data-fit]')?.addEventListener('click', () => this.fit());
    this.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click', () => {
      const mode = button.dataset.zoom;
      if (mode === 'reset') this.zoomTo(1);
      else this.zoomBy(mode === 'in' ? 1.2 : 1 / 1.2);
    }));
    this.querySelector('[data-gap]')?.addEventListener('input', event => {
      this.columnGap = clamp(Number(event.target.value) || COLUMN_GAP_DEFAULT, COLUMN_GAP_MIN, COLUMN_GAP_MAX);
      this.layout = this.graph.nodes.length ? this.computeLayout() : null;
      this.render();
    });
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
      if (event.ctrlKey) {
        // Pinch-zoom on a trackpad arrives as a ctrl+wheel event.
        const factor = Math.exp(clamp(-event.deltaY, -40, 40) * 0.01);
        this.zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      // Plain scroll (horizontal or vertical) moves the camera, never zooms.
      this.view.x -= event.deltaX;
      this.view.y -= event.deltaY;
      this.applyTransform();
    }, { passive: false });

    // Track active pointers to support two-finger pinch-zoom on touch screens.
    this.pointers = new Map();
    canvas.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-node],[data-edge]')) return;
      // Prevent the browser from starting a text selection while panning.
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        this.pinch = this.pinchState(canvas);
        this.pan = null;
        canvas.classList.remove('grabbing');
      } else if (this.pointers.size === 1) {
        this.pan = { x: event.clientX, y: event.clientY, vx: this.view.x, vy: this.view.y };
        canvas.classList.add('grabbing');
      }
    });
    canvas.addEventListener('pointermove', event => {
      if (this.pointers.has(event.pointerId)) {
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (this.pinch && this.pointers.size >= 2) {
        const next = this.pinchState(canvas);
        if (this.pinch.dist > 0) this.zoomAt(next.dist / this.pinch.dist, next.cx, next.cy);
        this.pinch = next;
        return;
      }
      if (!this.pan) return;
      this.view.x = this.pan.vx + (event.clientX - this.pan.x);
      this.view.y = this.pan.vy + (event.clientY - this.pan.y);
      this.applyTransform();
    });
    const endPointer = event => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) { this.pan = null; canvas.classList.remove('grabbing'); }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
  }

  // Midpoint + finger distance of the two active pointers, in canvas coords.
  pinchState(canvas) {
    const rect = canvas.getBoundingClientRect();
    const [a, b] = [...this.pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2 - rect.left,
      cy: (a.y + b.y) / 2 - rect.top,
    };
  }

  select(kind, id) {
    this.selection = { kind, id };
    this.render();
  }

  applyTransform() {
    const root = this.querySelector('[data-root]');
    if (root) root.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`);
    const level = this.querySelector('.dg-zoom-level');
    if (level) level.textContent = `${Math.round(this.view.scale * 100)}%`;
  }

  zoomBy(factor) {
    const canvas = this.querySelector('[data-canvas]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.zoomAt(factor, rect.width / 2, rect.height / 2);
  }

  zoomTo(scale) {
    const canvas = this.querySelector('[data-canvas]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.zoomAt(scale / this.view.scale, rect.width / 2, rect.height / 2);
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

  // Manual timeline layout: x is driven by the column (execution moment); y
  // stacks a column's boxes by their creation lane. Edges are smooth curves
  // between resolved box borders and can span arbitrary column distances.
  computeLayout() {
    const { nodes } = this.graph;
    const colStep = NODE_WIDTH + this.columnGap;

    // Assign each node a row *within* its column (compact, top-aligned).
    const rowInColumn = new Map();
    const byColumn = new Map();
    nodes.forEach(node => {
      const list = byColumn.get(node.column) || [];
      list.push(node);
      byColumn.set(node.column, list);
    });
    byColumn.forEach(list => {
      list.sort((a, b) => a.lane - b.lane);
      list.forEach((node, row) => rowInColumn.set(node.id, row));
    });

    const positioned = new Map();
    nodes.forEach(node => {
      const compact = node.kind === 'salesforce' || node.kind === 'check';
      const width = compact ? SF_WIDTH : NODE_WIDTH;
      const height = compact ? SF_HEIGHT : NODE_HEIGHT;
      const x = PADDING + node.column * colStep + NODE_WIDTH / 2;
      const y = PADDING + rowInColumn.get(node.id) * ROW_HEIGHT + NODE_HEIGHT / 2;
      positioned.set(node.id, { x, y, width, height });
    });

    // Bounds.
    let maxX = 0;
    let maxY = 0;
    positioned.forEach(p => {
      maxX = Math.max(maxX, p.x + p.width / 2);
      maxY = Math.max(maxY, p.y + p.height / 2);
    });

    const edges = new Map();
    this.graph.edges.forEach(edge => {
      const a = positioned.get(edge.from);
      const b = positioned.get(edge.to);
      if (!a || !b) return;
      edges.set(edge.id, edgePath(a, b));
    });

    return { nodes: positioned, edges, width: maxX + PADDING, height: maxY + PADDING };
  }
}

// Orthogonal (90°) router with rounded corners: exit A horizontally, turn
// vertically at a mid-x channel, then enter B horizontally. Rounded elbows keep
// it readable. Straight horizontal links (same row) stay a simple line.
function edgePath(a, b) {
  const forward = b.x >= a.x;
  const x1 = a.x + (forward ? a.width / 2 : -a.width / 2);
  const y1 = a.y;
  const x2 = b.x + (forward ? -b.width / 2 : b.width / 2);
  const y2 = b.y;

  if (Math.abs(y1 - y2) < 1) {
    return { d: `M${x1},${y1} L${x2},${y2}`, mid: { x: (x1 + x2) / 2, y: y1 } };
  }

  const midX = (x1 + x2) / 2;
  const dir = forward ? 1 : -1;                       // horizontal travel direction
  const vdir = y2 > y1 ? 1 : -1;                        // vertical travel direction
  const r = Math.min(14, Math.abs(midX - x1), Math.abs(midX - x2), Math.abs(y2 - y1) / 2);

  // A→ elbow1 (down/up) → elbow2 → B, each corner a quadratic arc of radius r.
  const d = [
    `M${x1},${y1}`,
    `L${midX - dir * r},${y1}`,
    `Q${midX},${y1} ${midX},${y1 + vdir * r}`,
    `L${midX},${y2 - vdir * r}`,
    `Q${midX},${y2} ${midX + dir * r},${y2}`,
    `L${x2},${y2}`,
  ].join(' ');
  return { d, mid: { x: midX, y: (y1 + y2) / 2 } };
}

function truncate(value, max) {
  const str = String(value ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

customElements.define('sf-diagram-panel', SfDiagramPanel);
