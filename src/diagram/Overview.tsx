import { useEffect, useRef } from 'react';
import type { Relation } from '../schema/model';
import { HEADER_HEIGHT, NODE_WIDTH } from './layout';

export type Box = { x: number; y: number; height: number };

interface Props {
  boxes: ReadonlyMap<string, Box>;
  relations: readonly Relation[];
  viewport: { x: number; y: number; zoom: number };
  width: number;
  height: number;
  /** Tables drawn in the accent colour, with the lines between them: the selection and its relatives. */
  lit: ReadonlySet<string> | null;
  colors: { table: string; border: string; idle: string; active: string };
}

/**
 * The zoomed-out view of a schema too large for React Flow to hold: every table as a box and every
 * relation as a straight line on one canvas, redrawn in a few milliseconds per pan or zoom frame.
 * It ignores the pointer, so panning and zooming still reach React Flow underneath.
 */
export default function Overview({ boxes, relations, viewport, width, height, lit, colors }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { x, y, zoom } = viewport;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * x, dpr * y);
    // The flow-space rectangle on screen; anything outside it is skipped
    const left = -x / zoom;
    const top = -y / zoom;
    const right = left + width / zoom;
    const bottom = top + height / zoom;
    const px = 1 / zoom; // one screen pixel in flow units

    // Lines first so boxes sit on top, idle ones before lit ones; each group is a single stroke
    const idle = new Path2D();
    const active = new Path2D();
    for (const r of relations) {
      if (r.from === r.to) continue;
      const a = boxes.get(r.from);
      const b = boxes.get(r.to);
      if (!a || !b) continue;
      const ax = a.x + NODE_WIDTH;
      const ay = a.y + HEADER_HEIGHT / 2;
      const bx = b.x;
      const by = b.y + HEADER_HEIGHT / 2;
      if (Math.max(ax, bx) < left || Math.min(ax, bx) > right || Math.max(ay, by) < top || Math.min(ay, by) > bottom) continue;
      const path = lit?.has(r.from) && lit.has(r.to) ? active : idle;
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
    }
    ctx.lineWidth = px;
    ctx.strokeStyle = colors.idle;
    ctx.stroke(idle);
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = colors.active;
    ctx.stroke(active);

    const plain = new Path2D();
    const marked = new Path2D();
    for (const [id, box] of boxes) {
      if (box.x > right || box.x + NODE_WIDTH < left || box.y > bottom || box.y + box.height < top) continue;
      (lit?.has(id) ? marked : plain).rect(box.x, box.y, NODE_WIDTH, box.height);
    }
    ctx.fillStyle = colors.table;
    ctx.fill(plain);
    ctx.fill(marked);
    // Outlines only while boxes are big enough on screen for an outline to read as one
    if (zoom > 0.02) {
      ctx.lineWidth = px;
      ctx.strokeStyle = colors.border;
      ctx.stroke(plain);
    }
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = colors.active;
    ctx.stroke(marked);
  }, [boxes, relations, viewport, width, height, lit, colors]);

  return <canvas ref={ref} className="overview" style={{ width, height }} aria-hidden="true" />;
}

/** The table under a flow-space point, if any. */
export function boxAt(boxes: ReadonlyMap<string, Box>, p: { x: number; y: number }): string | null {
  for (const [id, b] of boxes) {
    if (p.x >= b.x && p.x <= b.x + NODE_WIDTH && p.y >= b.y && p.y <= b.y + b.height) return id;
  }
  return null;
}
