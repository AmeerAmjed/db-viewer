import { Graph, layout } from '@dagrejs/dagre';
import type { Schema, Table } from '../schema/model';

// Must match .tn / .tn-header / .tn-row sizes in styles.css: dagre needs real node sizes.
export const NODE_WIDTH = 280;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 28;

export const nodeHeight = (table: Table, expanded: boolean) =>
  HEADER_HEIGHT + (expanded ? table.columns.length * ROW_HEIGHT + 4 : 0);

type Point = { x: number; y: number };

/**
 * Left-to-right dagre layout: a table sits left of the tables it references. Tables with no
 * relations would otherwise pile up in one tall first rank, so they go in a grid underneath.
 */
export function layoutSchema(schema: Schema, expanded: ReadonlySet<string>): Record<string, Point> {
  const connected = new Set<string>();
  for (const r of schema.relations) {
    if (r.from === r.to) continue;
    connected.add(r.from);
    connected.add(r.to);
  }

  const g = new Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 140, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of schema.tables) {
    if (connected.has(t.id)) g.setNode(t.id, { width: NODE_WIDTH, height: nodeHeight(t, expanded.has(t.id)) });
  }
  for (const r of schema.relations) if (r.from !== r.to) g.setEdge(r.from, r.to);
  layout(g);

  const positions: Record<string, Point> = {};
  let bottom = 0;
  for (const id of g.nodes()) {
    const n = g.node(id);
    positions[id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 };
    bottom = Math.max(bottom, n.y + n.height / 2);
  }

  const isolated = schema.tables.filter((t) => !connected.has(t.id));
  const perRow = Math.max(4, Math.ceil(Math.sqrt(isolated.length * 2)));
  let y = connected.size ? bottom + 120 : 0;
  for (let i = 0; i < isolated.length; i += perRow) {
    const row = isolated.slice(i, i + perRow);
    row.forEach((t, j) => (positions[t.id] = { x: j * (NODE_WIDTH + 40), y }));
    y += Math.max(...row.map((t) => nodeHeight(t, expanded.has(t.id)))) + 40;
  }
  return positions;
}
