export type VectorClipMode = "drag" | "line" | "bicubic" | "freehand" | "freehand-smooth";

type Node = {
  type: "m" | "l" | "b";
  x: number;
  y: number;
  c1x?: number;
  c1y?: number;
  c2x?: number;
  c2y?: number;
};

export interface VectorClipHandle {
  setMode(mode: VectorClipMode): void;
  convert(): void;
  insert(): void;
  remove(): void;
  close(): void;
}

export interface VectorClipOptions {
  container: HTMLElement;
  width: number;
  height: number;
  text: string;
  onChange(text: string): void;
  onClose?(): void;
}

function parsePath(text: string): { inverse: boolean; nodes: Node[] } {
  const match = text.match(/\\(i?clip)\(([^)]*[mlbsc][^)]*)\)/i);
  if (!match) return { inverse: false, nodes: [] };
  const tokens = match[2].trim().split(/[\s,]+/).filter(Boolean);
  const nodes: Node[] = [];
  let index = 0;
  let lastCmd = "m";
  while (index < tokens.length) {
    const raw = tokens[index];
    const command = /^[a-z]$/i.test(raw) ? (index += 1, lastCmd = raw.toLowerCase()) : lastCmd;
    if (command === "m" || command === "l" || command === "n") {
      const x = Number(tokens[index++]);
      const y = Number(tokens[index++]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        nodes.push({ type: command === "m" ? "m" : "l", x, y });
        if (command === "m") lastCmd = "l";
      }
    } else if (command === "b") {
      const values = tokens.slice(index, index + 6).map(Number);
      index += 6;
      if (values.length === 6 && values.every(Number.isFinite)) {
        nodes.push({ type: "b", c1x: values[0], c1y: values[1], c2x: values[2], c2y: values[3], x: values[4], y: values[5] });
      }
    } else if (command === "s" || command === "p") {
      const x = Number(tokens[index++]);
      const y = Number(tokens[index++]);
      if (Number.isFinite(x) && Number.isFinite(y)) nodes.push({ type: "l", x, y });
    } else if (command === "c") {
      // Close sub-contour marker; canvas closes path automatically.
      continue;
    } else {
      index += 1;
    }
  }
  return { inverse: match[1].toLowerCase() === "iclip", nodes };
}

function pathText(nodes: Node[]): string {
  return nodes.map((node) => node.type === "b"
    ? `b ${Math.round(node.c1x!)} ${Math.round(node.c1y!)} ${Math.round(node.c2x!)} ${Math.round(node.c2y!)} ${Math.round(node.x)} ${Math.round(node.y)}`
    : `${node.type} ${Math.round(node.x)} ${Math.round(node.y)}`).join(" ");
}

function replaceClip(text: string, nodes: Node[], inverse: boolean): string {
  const tag = `\\${inverse ? "iclip" : "clip"}(${pathText(nodes)})`;
  const vector = /\\i?clip\(([^)]*[mlbsc][^)]*)\)/i;
  if (vector.test(text)) return text.replace(vector, tag);
  const firstBlock = text.match(/^\{([^}]*)\}/);
  return firstBlock ? `{${firstBlock[1]}${tag}}${text.slice(firstBlock[0].length)}` : `{${tag}}${text}`;
}

function simplify(points: Node[], tolerance = 4): Node[] {
  if (points.length <= 2) return points;
  const sq = tolerance * tolerance;
  const kept: Node[] = [points[0]];
  let last = points[0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if ((point.x - last.x) ** 2 + (point.y - last.y) ** 2 >= sq) {
      kept.push(point);
      last = point;
    }
  }
  kept.push(points.at(-1)!);
  return kept;
}

export function openVectorClip(options: VectorClipOptions): VectorClipHandle {
  const parsed = parsePath(options.text);
  let nodes: Node[] = parsed.nodes.length ? parsed.nodes : [
    { type: "m", x: options.width * .3, y: options.height * .3 },
    { type: "l", x: options.width * .7, y: options.height * .3 },
    { type: "l", x: options.width * .7, y: options.height * .7 },
    { type: "l", x: options.width * .3, y: options.height * .7 },
  ];
  let inverse = parsed.inverse;
  let mode: VectorClipMode = "drag";
  let selected = 0;
  let dragHandle: "anchor" | "c1" | "c2" = "anchor";
  let dragging = false;

  const overlay = document.createElement("div");
  overlay.className = "se-vclip-overlay";
  const canvas = document.createElement("canvas");
  canvas.className = "se-vclip-canvas";
  const toolbar = document.createElement("div");
  toolbar.className = "se-vclip-toolbar";
  overlay.append(canvas, toolbar);
  options.container.append(overlay);
  const context = canvas.getContext("2d")!;

  const resize = (): void => {
    const rect = overlay.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    draw();
  };
  const toCanvas = (node: Node): { x: number; y: number } => ({ x: node.x / options.width * canvas.clientWidth, y: node.y / options.height * canvas.clientHeight });
  const toPlay = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / Math.max(1, rect.width) * options.width, y: (event.clientY - rect.top) / Math.max(1, rect.height) * options.height };
  };
  const emit = (): void => options.onChange(replaceClip(options.text, nodes, inverse));
  const draw = (): void => {
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.strokeStyle = "#66aaff";
    context.fillStyle = "rgba(60,130,255,.15)";
    context.lineWidth = 2;
    context.beginPath();
    nodes.forEach((node, index) => {
      const point = toCanvas(node);
      if (index === 0 || node.type === "m") context.moveTo(point.x, point.y);
      else if (node.type === "b") {
        const c1 = toCanvas({ type: "l", x: node.c1x!, y: node.c1y! });
        const c2 = toCanvas({ type: "l", x: node.c2x!, y: node.c2y! });
        context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, point.x, point.y);
      } else context.lineTo(point.x, point.y);
    });
    if (nodes.length > 2) context.closePath();
    context.fill("evenodd");
    context.stroke();
    nodes.forEach((node, index) => {
      if (node.type === "b" && node.c1x != null && node.c1y != null && node.c2x != null && node.c2y != null) {
        const prev = toCanvas(nodes[index - 1] ?? node);
        const p1 = toCanvas({ type: "l", x: node.c1x, y: node.c1y });
        const p2 = toCanvas({ type: "l", x: node.c2x, y: node.c2y });
        const anchor = toCanvas(node);
        context.save();
        context.strokeStyle = "rgba(255,190,80,.75)";
        context.lineWidth = 1;
        context.setLineDash([3, 3]);
        context.beginPath();
        context.moveTo(prev.x, prev.y);
        context.lineTo(p1.x, p1.y);
        context.moveTo(anchor.x, anchor.y);
        context.lineTo(p2.x, p2.y);
        context.stroke();
        context.restore();
        for (const [cp, kind] of [[p1, "c1"], [p2, "c2"]] as const) {
          const activeCp = index === selected && dragHandle === kind;
          context.beginPath();
          context.rect(cp.x - (activeCp ? 4.5 : 3.5), cp.y - (activeCp ? 4.5 : 3.5), activeCp ? 9 : 7, activeCp ? 9 : 7);
          context.fillStyle = activeCp ? "#fff" : "#ffbe50";
          context.fill();
          context.strokeStyle = "#945b00";
          context.stroke();
        }
      }
      const point = toCanvas(node);
      context.beginPath();
      context.arc(point.x, point.y, index === selected && dragHandle === "anchor" ? 6 : 4, 0, Math.PI * 2);
      context.fillStyle = index === selected && dragHandle === "anchor" ? "#fff" : "#66aaff";
      context.fill();
      context.strokeStyle = "#1759b7";
      context.stroke();
    });
  };
  const nearest = (point: { x: number; y: number }): { index: number; handle: "anchor" | "c1" | "c2" } => {
    let result = -1;
    let handle: "anchor" | "c1" | "c2" = "anchor";
    let distance = Infinity;
    nodes.forEach((node, index) => {
      const candidates: [number, number, "anchor" | "c1" | "c2"][] = [[node.x, node.y, "anchor"]];
      if (node.type === "b" && node.c1x != null && node.c1y != null && node.c2x != null && node.c2y != null) {
        candidates.push([node.c1x, node.c1y, "c1"], [node.c2x, node.c2y, "c2"]);
      }
      for (const [cx, cy, kind] of candidates) {
        const current = (cx - point.x) ** 2 + (cy - point.y) ** 2;
        if (current < distance) { result = index; handle = kind; distance = current; }
      }
    });
    return { index: result, handle };
  };

  canvas.addEventListener("pointerdown", (event) => {
    const point = toPlay(event);
    if (mode === "drag") {
      const picked = nearest(point);
      selected = picked.index;
      dragHandle = picked.handle;
      dragging = selected >= 0;
    } else if (mode === "line" || mode === "bicubic") {
      const previous = nodes.at(-1) ?? { x: point.x, y: point.y };
      nodes.push(mode === "line" ? { type: nodes.length ? "l" : "m", ...point } : {
        type: "b", c1x: previous.x + (point.x - previous.x) / 3, c1y: previous.y + (point.y - previous.y) / 3,
        c2x: previous.x + (point.x - previous.x) * 2 / 3, c2y: previous.y + (point.y - previous.y) * 2 / 3, ...point,
      });
      selected = nodes.length - 1;
      dragHandle = "anchor";
      emit();
    } else {
      nodes = [{ type: "m", ...point }];
      selected = 0;
      dragHandle = "anchor";
      dragging = true;
    }
    canvas.setPointerCapture(event.pointerId);
    draw();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const point = toPlay(event);
    if (mode === "drag" && selected >= 0) {
      const node = nodes[selected];
      if (dragHandle === "c1") { node.c1x = point.x; node.c1y = point.y; }
      else if (dragHandle === "c2") { node.c2x = point.x; node.c2y = point.y; }
      else Object.assign(node, point);
    } else if (mode === "freehand" || mode === "freehand-smooth") nodes.push({ type: "l", ...point });
    draw();
  });
  canvas.addEventListener("pointerup", () => {
    if (mode === "freehand-smooth") nodes = simplify(nodes);
    dragging = false;
    emit();
    draw();
  });

  const makeButton = (label: string, action: () => void): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    toolbar.append(button);
    return button;
  };
  const modeButtons = new Map<VectorClipMode, HTMLButtonElement>();
  for (const [value, label] of [["drag", "Drag"], ["line", "Line"], ["bicubic", "Bicubic"], ["freehand", "Freehand"], ["freehand-smooth", "Smooth"]] as const) {
    modeButtons.set(value, makeButton(label, () => setMode(value)));
  }
  makeButton("Convert", convert);
  makeButton("Insert", insert);
  makeButton("Remove", remove);
  makeButton("Inverse", () => { inverse = !inverse; emit(); });
  makeButton("Done", close);

  function setMode(value: VectorClipMode): void {
    mode = value;
    for (const [key, button] of modeButtons) button.classList.toggle("on", key === value);
  }
  function convert(): void {
    const node = nodes[selected];
    if (!node || selected === 0) return;
    if (node.type === "b") node.type = "l";
    else {
      const previous = nodes[selected - 1];
      node.type = "b";
      node.c1x = previous.x + (node.x - previous.x) / 3;
      node.c1y = previous.y + (node.y - previous.y) / 3;
      node.c2x = previous.x + (node.x - previous.x) * 2 / 3;
      node.c2y = previous.y + (node.y - previous.y) * 2 / 3;
    }
    emit(); draw();
  }
  function insert(): void {
    const current = nodes[selected];
    const next = nodes[(selected + 1) % nodes.length];
    if (!current || !next) return;
    nodes.splice(selected + 1, 0, { type: "l", x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
    selected += 1;
    emit(); draw();
  }
  function remove(): void {
    if (nodes.length <= 2 || selected < 0) return;
    nodes.splice(selected, 1);
    selected = Math.max(0, Math.min(selected, nodes.length - 1));
    emit(); draw();
  }
  function close(): void {
    observer.disconnect();
    overlay.remove();
    options.onClose?.();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(overlay);
  setMode("drag");
  resize();
  emit();
  return { setMode, convert, insert, remove, close };
}
