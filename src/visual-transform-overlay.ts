import type { Cue, SubtitleDoc } from "./cue";
import { getPlayRes } from "./formats/ass";
import { setVisualTags, transformDrag, visualState, type Point, type VisualState, type VisualTransformMode } from "./visual-transform";

type TextUpdates = Map<string, string>;
type Rect = { left: number; top: number; width: number; height: number };
interface TransformHost {
  container: HTMLElement;
  mode: VisualTransformMode;
  getDoc(): SubtitleDoc;
  getSelected(): Cue[];
  getPictureRect(): Rect;
  stop(): void;
  preview(updates: TextUpdates): void;
  commit(updates: TextUpdates): void;
  restore(): void;
}

/** Disposable on-frame interaction layer. Preview text stays outside the saved document
 * until pointer-up; Escape/cancel never creates an undo entry or leaks into autosave. */
export class VisualTransformOverlay {
  private element = document.createElement("div");
  private svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private observer: ResizeObserver;
  private raf = 0;
  private closed = false;
  private drag: { pointerId: number; start: Point; state: VisualState; origin: Point; moveOrigin: boolean; cues: Cue[]; updates: TextUpdates } | null = null;

  constructor(private host: TransformHost) {
    this.element.className = "se-visual-transform";
    this.element.dataset.visualTransform = host.mode;
    this.element.tabIndex = 0;
    this.element.setAttribute("aria-label", host.mode === "rotate-z" ? "Z 轴旋转工具" : host.mode === "rotate-xy" ? "XY 轴旋转工具" : "缩放工具");
    this.svg.setAttribute("width", "100%"); this.svg.setAttribute("height", "100%");
    this.element.append(this.svg);
    host.container.append(this.element);
    this.element.addEventListener("pointerdown", this.down);
    this.element.addEventListener("pointermove", this.move);
    this.element.addEventListener("pointerup", this.up);
    this.element.addEventListener("pointercancel", this.cancel);
    this.element.addEventListener("keydown", this.key);
    this.element.addEventListener("wheel", () => requestAnimationFrame(() => this.draw()), { passive: true });
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host.container);
    this.draw();
    this.element.focus({ preventScroll: true });
  }

  private screen(point: Point): Point {
    const picture = this.host.getPictureRect(), box = this.element.getBoundingClientRect(), resolution = getPlayRes(this.host.getDoc());
    return { x: picture.left - box.left + point.x * picture.width / resolution.x, y: picture.top - box.top + point.y * picture.height / resolution.y };
  }

  private draw(): void {
    if (this.closed) return;
    const selected = this.host.getSelected()[0];
    this.svg.replaceChildren();
    if (!selected) return;
    const draft = this.drag?.updates.get(selected.id);
    const state = visualState(this.host.getDoc(), draft === undefined ? selected : { ...selected, text: draft });
    const origin = this.screen(state.origin), position = this.screen(state.position);
    const shape = (tag: string, attrs: Record<string, string | number>, parent: Element = this.svg) => {
      const node = document.createElementNS(this.svg.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      parent.append(node);
      return node;
    };
    const line = (x1: number, y1: number, x2: number, y2: number, parent: Element = this.svg) => shape("line", { x1, y1, x2, y2 }, parent);
    if (this.host.mode === "rotate-z") {
      const radius = Math.max(50, Math.hypot(position.x - origin.x, position.y - origin.y));
      shape("circle", { cx: origin.x, cy: origin.y, r: radius, class: "se-visual-ring" });
      for (let angle = 0; angle < 360; angle += 30) {
        const radians = angle * Math.PI / 180;
        line(origin.x + Math.cos(radians) * (radius - 5), origin.y + Math.sin(radians) * (radius - 5), origin.x + Math.cos(radians) * (radius + 10), origin.y + Math.sin(radians) * (radius + 10));
      }
      const radians = -state.rz * Math.PI / 180;
      line(origin.x - Math.cos(radians) * radius, origin.y - Math.sin(radians) * radius, origin.x + Math.cos(radians) * radius, origin.y + Math.sin(radians) * radius);
      shape("circle", { cx: origin.x + Math.cos(radians) * radius, cy: origin.y + Math.sin(radians) * radius, r: 5 });
    } else if (this.host.mode === "scale") {
      const box = this.element.getBoundingClientRect();
      const x = Math.max(90, Math.min(box.width - 110, position.x));
      const y = Math.max(90, Math.min(box.height - 110, position.y));
      const group = shape("g", { transform: `translate(${x} ${y}) rotate(${-state.rz})` });
      shape("rect", { x: -80, y: 80, width: 160, height: 10 }, group);
      shape("rect", { x: 80, y: -80, width: 10, height: 160 }, group);
      line(-state.sx * .8, 95, state.sx * .8, 95, group);
      line(95, -state.sy * .8, 95, state.sy * .8, group);
      for (const [cx, cy] of [[-state.sx * .8, 95], [state.sx * .8, 95], [95, -state.sy * .8], [95, state.sy * .8]]) shape("circle", { cx, cy, r: 5 }, group);
    } else {
      // Screen guide projection; the subtitle itself is still rendered by libass.
      const project = (x: number, y: number): Point => {
        const rx = state.rx * Math.PI / 180, ry = state.ry * Math.PI / 180, rz = -state.rz * Math.PI / 180;
        const xx = x * Math.cos(ry) + y * Math.sin(rx) * Math.sin(ry), yy = y * Math.cos(rx);
        return { x: origin.x + xx * Math.cos(rz) - yy * Math.sin(rz), y: origin.y + xx * Math.sin(rz) + yy * Math.cos(rz) };
      };
      for (let n = -8; n <= 8; n++) {
        const a = project(n * 20, -160), b = project(n * 20, 160), c = project(-160, n * 20), d = project(160, n * 20);
        line(a.x, a.y, b.x, b.y).setAttribute("opacity", String(1 - Math.abs(n) / 10));
        line(c.x, c.y, d.x, d.y).setAttribute("opacity", String(1 - Math.abs(n) / 10));
      }
    }
    if (this.host.mode !== "scale") {
      shape("circle", { cx: origin.x, cy: origin.y, r: 18, "data-origin": "true", class: "se-visual-origin-hit" });
      shape("path", { d: `M${origin.x} ${origin.y - 8}l-8 16h16z`, "data-origin": "true" });
    }
    const label = shape("text", { x: 40, y: 20, class: "se-visual-readout" });
    label.textContent = this.host.mode === "scale" ? `X ${state.sx}% · Y ${state.sy}%` : this.host.mode === "rotate-z" ? `${state.rz}°` : `X ${state.rx}° · Y ${state.ry}°`;
  }

  private down = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag) return;
    const cues = this.host.getSelected().map(cue => ({ ...cue }));
    if (!cues.length) return;
    event.preventDefault();
    this.element.focus({ preventScroll: true });
    this.host.stop();
    const state = visualState(this.host.getDoc(), cues[0]), local = this.screen(state.origin), box = this.element.getBoundingClientRect();
    this.drag = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, state,
      origin: { x: local.x + box.left, y: local.y + box.top },
      moveOrigin: this.host.mode !== "scale" && !!(event.target as Element).closest("[data-origin]"), cues, updates: new Map() };
    this.element.setPointerCapture(event.pointerId);
  };

  private move = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const current = { x: event.clientX, y: event.clientY };
    const updates = new Map<string, string>();
    if (drag.moveOrigin) {
      const resolution = getPlayRes(this.host.getDoc()), picture = this.host.getPictureRect();
      const dx = (current.x - drag.start.x) * resolution.x / picture.width, dy = (current.y - drag.start.y) * resolution.y / picture.height;
      for (const cue of drag.cues) {
        const origin = visualState(this.host.getDoc(), cue).origin;
        updates.set(cue.id, setVisualTags(cue.text, { org: `(${Math.round(origin.x + dx)},${Math.round(origin.y + dy)})` }));
      }
    } else {
      const tags = transformDrag(this.host.mode, drag.state, drag.start, current, drag.origin, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey });
      for (const cue of drag.cues) updates.set(cue.id, setVisualTags(cue.text, tags));
    }
    drag.updates = updates;
    this.draw();
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.drag) this.host.preview(this.drag.updates); });
  };

  private up = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.drag = null;
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    if (drag.updates.size) this.host.commit(drag.updates);
    this.draw();
  };

  private cancel = (): void => {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.drag) {
      const id = this.drag.pointerId;
      this.drag = null;
      if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
      this.host.restore();
    }
    this.draw();
  };
  private key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.cancel(); }
  };
  refresh(): void { this.cancel(); }
  close(): void {
    this.cancel();
    this.closed = true;
    this.observer.disconnect();
    this.element.remove();
  }
}
