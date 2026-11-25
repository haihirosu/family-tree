/** Shared world transform for HTML cards and SVG relationships. */
export class Viewport {
  constructor(element, world, { onTapBackground = () => {}, onTransform = () => {} } = {}) {
    this.element = element;
    this.world = world;
    this.scale = 1;
    this.x = 32;
    this.y = 32;
    this.onTapBackground = onTapBackground;
    this.onTransform = onTransform;
    this.pointers = new Map();
    this.dragging = false;
    this.pinch = null;
    this.suppressClickUntil = 0;
    this.controller = new AbortController();
    this.world.style.transformOrigin = '0 0';
    this.element.style.touchAction = 'none';
    const signal = this.controller.signal;
    this.element.addEventListener('pointerdown', e => this.pointerDown(e), { signal });
    this.element.addEventListener('pointermove', e => this.pointerMove(e), { signal });
    this.element.addEventListener('pointerup', e => this.pointerEnd(e), { signal });
    this.element.addEventListener('pointercancel', e => this.pointerEnd(e, true), { signal });
    // Uncaptured taps may finish outside the canvas or after the window loses focus.
    globalThis.window?.addEventListener('pointerup', e => this.pointerEnd(e), { signal });
    globalThis.window?.addEventListener('pointercancel', e => this.pointerEnd(e, true), { signal });
    globalThis.window?.addEventListener('blur', () => this.stopGesture(), { signal });
    this.element.addEventListener('wheel', e => {
      if (e.target.closest('input, textarea, select')) return;
      e.preventDefault();
      const position = this.local(e.clientX, e.clientY);
      this.zoomAt(this.scale * Math.exp(-e.deltaY * 0.0015), position.x, position.y);
    }, { passive: false, signal });
    this.element.addEventListener('click', e => {
      if (e.detail !== 0 && performance.now() < this.suppressClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (!e.target.closest('button, a, input, select, textarea, [role="button"], [data-person-id]')) this.onTapBackground(e);
    }, { capture: true, signal });
    this.apply();
  }

  local(clientX, clientY) {
    const rect = this.element.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  capture(id) {
    try { this.element.setPointerCapture(id); } catch { /* The pointer may already be released. */ }
  }

  pointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('input, select, textarea')) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    if (this.pointers.size >= 2) {
      this.dragging = true;
      for (const id of this.pointers.keys()) this.capture(id);
      this.startPinch();
    }
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) { this.pinch = null; return; }
    const center = this.local((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale: this.scale,
      worldX: (center.x - this.x) / this.scale,
      worldY: (center.y - this.y) / this.scale
    };
  }

  pointerMove(e) {
    const point = this.pointers.get(e.pointerId);
    if (!point) return;
    const dx = e.clientX - point.x;
    const dy = e.clientY - point.y;
    point.x = e.clientX;
    point.y = e.clientY;
    if (this.pointers.size >= 2) {
      if (!this.pinch) this.startPinch();
      const [a, b] = [...this.pointers.values()];
      const center = this.local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      this.scale = Math.min(2.5, Math.max(0.25, this.pinch.scale * distance / this.pinch.distance));
      this.x = center.x - this.pinch.worldX * this.scale;
      this.y = center.y - this.pinch.worldY * this.scale;
      e.preventDefault();
      this.apply();
      return;
    }
    if (!this.dragging && Math.hypot(point.x - point.startX, point.y - point.startY) >= 8) {
      this.dragging = true;
      this.capture(e.pointerId);
      this.x += point.x - point.startX;
      this.y += point.y - point.startY;
    } else if (this.dragging) {
      this.x += dx;
      this.y += dy;
    } else return;
    e.preventDefault();
    this.apply();
  }

  pointerEnd(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    if (this.dragging || cancelled || this.pinch) this.suppressClickUntil = performance.now() + 450;
    this.pointers.delete(e.pointerId);
    try { if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId); } catch { /* No active pointer. */ }
    this.pinch = null;
    if (this.pointers.size === 1) {
      const point = [...this.pointers.values()][0];
      point.startX = point.x;
      point.startY = point.y;
    }
    if (this.pointers.size === 0) this.dragging = false;
  }

  stopGesture() {
    const active = this.dragging || this.pinch;
    for (const id of this.pointers.keys()) {
      try { if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id); } catch { /* No active pointer. */ }
    }
    this.pointers.clear();
    this.dragging = false;
    this.pinch = null;
    if (active) this.suppressClickUntil = performance.now() + 450;
  }

  apply() {
    this.world.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.onTransform({ scale: this.scale, x: this.x, y: this.y });
  }

  zoomAt(next, screenX, screenY) {
    const worldX = (screenX - this.x) / this.scale;
    const worldY = (screenY - this.y) / this.scale;
    this.scale = Math.max(0.25, Math.min(2.5, next));
    this.x = screenX - worldX * this.scale;
    this.y = screenY - worldY * this.scale;
    this.apply();
  }

  zoomBy(factor) {
    this.zoomAt(this.scale * factor, this.element.clientWidth / 2, this.element.clientHeight / 2);
  }

  fit(bounds) {
    this.stopGesture();
    const width = this.element.clientWidth || 360;
    const height = this.element.clientHeight || 480;
    const worldWidth = Math.max(1, bounds.width || 1);
    const worldHeight = Math.max(1, bounds.height || 1);
    this.scale = Math.max(0.01, Math.min(1.1, (width - 48) / worldWidth, (height - 48) / worldHeight));
    this.x = (width - worldWidth * this.scale) / 2;
    this.y = (height - worldHeight * this.scale) / 2;
    this.apply();
  }

  snapshot(nodes = [], selectedPersonId = null) {
    const screenX = this.element.clientWidth / 2;
    const screenY = this.element.clientHeight / 2;
    const worldX = (screenX - this.x) / this.scale;
    const worldY = (screenY - this.y) / this.scale;
    let anchor = nodes.find(node => node.personId === selectedPersonId);
    if (!anchor && nodes.length) anchor = [...nodes].sort((a, b) =>
      Math.hypot(a.x + a.width / 2 - worldX, a.y + a.height / 2 - worldY) -
      Math.hypot(b.x + b.width / 2 - worldX, b.y + b.height / 2 - worldY))[0];
    return {
      scale: this.scale, x: this.x, y: this.y, worldX, worldY,
      personId: anchor?.personId ?? null,
      anchorX: anchor ? (anchor.x + anchor.width / 2) * this.scale + this.x : screenX,
      anchorY: anchor ? (anchor.y + anchor.height / 2) * this.scale + this.y : screenY
    };
  }

  restore(snapshot, nodes = []) {
    if (!snapshot) return;
    this.stopGesture();
    this.scale = snapshot.scale;
    const anchor = nodes.find(node => node.personId === snapshot.personId);
    if (anchor) {
      this.x = snapshot.anchorX - (anchor.x + anchor.width / 2) * this.scale;
      this.y = snapshot.anchorY - (anchor.y + anchor.height / 2) * this.scale;
    } else {
      this.x = this.element.clientWidth / 2 - snapshot.worldX * this.scale;
      this.y = this.element.clientHeight / 2 - snapshot.worldY * this.scale;
    }
    this.apply();
  }

  focus(node) {
    if (!node) return;
    this.stopGesture();
    this.scale = Math.min(2.5, Math.max(0.75, this.scale));
    this.x = this.element.clientWidth / 2 - (node.x + node.width / 2) * this.scale;
    this.y = this.element.clientHeight / 2 - (node.y + node.height / 2) * this.scale;
    this.apply();
  }

  destroy() {
    this.stopGesture();
    this.controller.abort();
  }
}
