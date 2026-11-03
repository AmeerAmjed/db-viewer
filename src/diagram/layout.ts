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

  const heights = new Map(schema.tables.map((t) => [t.id, nodeHeight(t, expanded.has(t.id))]));
  const { positions, bottom } =
    connected.size > DAGRE_LIMIT ? layeredLayout(schema, connected, heights) : dagreLayout(schema, connected, heights);

  const isolated = schema.tables.filter((t) => !connected.has(t.id));
  const perRow = Math.max(4, Math.ceil(Math.sqrt(isolated.length * 2)));
  let y = connected.size ? bottom + 120 : 0;
  for (let i = 0; i < isolated.length; i += perRow) {
    const row = isolated.slice(i, i + perRow);
    row.forEach((t, j) => (positions[t.id] = { x: j * (NODE_WIDTH + 40), y }));
    y += Math.max(...row.map((t) => heights.get(t.id)!)) + 40;
  }
  return positions;
}

/**
 * dagre's ranking and crossing reduction grow much faster than linearly (about 20 s for 2,000
 * tables), which freezes the page. Past this many connected tables `layeredLayout` takes over.
 */
export const DAGRE_LIMIT = 300;

const NODE_SEP = 32;
// Leaves room for a relation label plus the crow's-foot markers at both ends
const RANK_SEP = 200;

type Layout = { positions: Record<string, Point>; bottom: number };

function dagreLayout(schema: Schema, connected: ReadonlySet<string>, heights: ReadonlyMap<string, number>): Layout {
  const g = new Graph();
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of connected) g.setNode(id, { width: NODE_WIDTH, height: heights.get(id)! });
  for (const r of schema.relations) if (r.from !== r.to) g.setEdge(r.from, r.to);
  layout(g);

  const positions: Record<string, Point> = {};
  let bottom = 0;
  for (const id of g.nodes()) {
    const n = g.node(id);
    positions[id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 };
    bottom = Math.max(bottom, n.y + n.height / 2);
  }
  return { positions, bottom };
}

/**
 * A linear-time stand-in for dagre on large schemas, with the same direction: each table goes one
 * column right of the rightmost table that references it (FK cycles are broken where a depth-first
 * walk finds them). Within a column, tables sort by the average row of the tables referencing them,
 * which keeps most lines short, and each column is centred on the tallest one.
 */
function layeredLayout(schema: Schema, connected: ReadonlySet<string>, heights: ReadonlyMap<string, number>): Layout {
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const id of connected) {
    out.set(id, []);
    into.set(id, []);
  }
  for (const r of schema.relations) {
    if (r.from === r.to) continue;
    out.get(r.from)!.push(r.to);
    into.get(r.to)!.push(r.from);
  }

  // Reverse post-order of an iterative DFS is a topological order once back edges are ignored
  const state = new Map<string, 1 | 2>(); // 1: on the DFS stack, 2: done
  const post: string[] = [];
  for (const root of connected) {
    if (state.has(root)) continue;
    state.set(root, 1);
    const stack: [string, number][] = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = out.get(top[0])![top[1]++];
      if (next === undefined) {
        state.set(top[0], 2);
        post.push(top[0]);
        stack.pop();
      } else if (!state.has(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  const order = post.reverse();
  const index = new Map(order.map((id, i) => [id, i]));

  const rank = new Map<string, number>();
  const columns: string[][] = [];
  const row = new Map<string, number>();
  for (const id of order) {
    let r = 0;
    for (const from of into.get(id)!) if (index.get(from)! < index.get(id)!) r = Math.max(r, rank.get(from)! + 1);
    rank.set(id, r);
    (columns[r] ??= []).push(id);
  }

  const columnHeights = columns.map((col, c) => {
    // Earlier columns are already ordered, so their rows are known when this one is sorted
    const key = new Map<string, number>();
    col.forEach((id, i) => {
      const rows = into.get(id)!.filter((f) => rank.get(f)! < c).map((f) => row.get(f)!);
      key.set(id, rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : i);
    });
    col.sort((a, b) => key.get(a)! - key.get(b)!);
    col.forEach((id, i) => row.set(id, i));
    return col.reduce((h, id) => h + heights.get(id)!, 0) + NODE_SEP * (col.length - 1);
  });

  const tallest = Math.max(...columnHeights);
  const positions: Record<string, Point> = {};
  columns.forEach((col, c) => {
    let y = (tallest - columnHeights[c]) / 2;
    for (const id of col) {
      positions[id] = { x: c * (NODE_WIDTH + RANK_SEP), y };
      y += heights.get(id)! + NODE_SEP;
    }
  });
  return { positions, bottom: tallest };
}
