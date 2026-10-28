import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { exportDiagram } from './diagram/exportImage';
import { layoutSchema } from './diagram/layout';
import TableNode, {
  columnSource,
  columnTarget,
  HEADER_TARGET,
  ToggleTableContext,
  type TableNodeType,
} from './diagram/TableNode';
import sample from './sample.sql?raw';
import type { Schema } from './schema/model';
import { parseOpenApi } from './schema/openApi';
import { parseSql } from './schema/sqlParser';
import { load, save } from './storage';
import DetailPanel from './ui/DetailPanel';
import { MoonIcon, SunIcon } from './ui/icons';
import Sidebar from './ui/Sidebar';
import { useTheme } from './ui/useTheme';

const nodeTypes = { table: TableNode };
const NO_COLUMNS: ReadonlySet<string> = new Set();
const EDGE_COLORS = {
  light: { idle: '#a1a1aa', active: '#16a34a' },
  dark: { idle: '#52525b', active: '#3ecf8e' },
};

export default function App() {
  return (
    <ReactFlowProvider>
      <Viewer />
    </ReactFlowProvider>
  );
}

function Viewer() {
  const [theme, toggleTheme] = useTheme();
  const { fitView } = useReactFlow();

  const [sql, setSql] = useState(() => load('sv.sql') ?? sample);
  const [schema, setSchema] = useState<Schema>(() => parseSql(sql));
  const [sourceLabel, setSourceLabel] = useState('pasted SQL');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Holds only id/position/table; per-render state (expanded, highlight) is layered on in viewNodes
  // so that toggling it never resets positions the user dragged.
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([]);

  const showSchema = useCallback((next: Schema, label: string) => {
    setSchema(next);
    setSourceLabel(label);
    setExpanded(new Set());
    setSelectedId(null);
  }, []);

  const applySql = useCallback(
    (text: string) => {
      setSql(text);
      save('sv.sql', text);
      showSchema(parseSql(text), 'pasted SQL');
    },
    [showSchema],
  );

  const connect = useCallback(
    async (url: string, key: string) => {
      const res = await fetch('/api/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, key }),
      });
      const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      save('sv.url', url);
      showSchema(parseOpenApi(body), new URL(url).hostname);
    },
    [showSchema],
  );

  const arrange = useCallback(
    (exp: ReadonlySet<string>) => {
      const positions = layoutSchema(schema, exp);
      setNodes(
        schema.tables.map((table) => ({
          id: table.id,
          type: 'table',
          position: positions[table.id],
          data: { table, expanded: false, dimmed: false, active: false, fkColumns: NO_COLUMNS },
        })),
      );
      // Let React Flow measure the new nodes before fitting
      setTimeout(() => fitView({ padding: 0.08, duration: 300 }), 50);
    },
    [schema, setNodes, fitView],
  );

  useEffect(() => arrange(new Set()), [arrange]);

  // Expanding one table re-runs the layout so it doesn't overlap its neighbours, shifted so the
  // toggled table stays put on screen.
  const toggleTable = useCallback(
    (id: string) => {
      const next = new Set(expanded);
      if (!next.delete(id)) next.add(id);
      setExpanded(next);
      const positions = layoutSchema(schema, next);
      const before = nodes.find((n) => n.id === id)?.position;
      const dx = before ? before.x - positions[id].x : 0;
      const dy = before ? before.y - positions[id].y : 0;
      setNodes((ns) => ns.map((n) => ({ ...n, position: { x: positions[n.id].x + dx, y: positions[n.id].y + dy } })));
    },
    [expanded, schema, nodes, setNodes],
  );

  const setAllExpanded = (all: boolean) => {
    const next = all ? new Set(schema.tables.map((t) => t.id)) : new Set<string>();
    setExpanded(next);
    arrange(next);
  };

  const focusTable = useCallback(
    (id: string) => {
      setSelectedId(id);
      fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.1 });
    },
    [fitView],
  );

  const fkColumns = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of schema.relations) {
      if (!map.has(r.from)) map.set(r.from, new Set());
      r.fromColumns.forEach((c) => map.get(r.from)!.add(c));
    }
    return map;
  }, [schema]);

  const activeId = hoveredId ?? selectedId;
  const neighbours = useMemo(() => {
    if (!activeId) return null;
    const set = new Set([activeId]);
    for (const r of schema.relations) {
      if (r.from === activeId) set.add(r.to);
      if (r.to === activeId) set.add(r.from);
    }
    return set;
  }, [activeId, schema]);

  const viewNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          expanded: expanded.has(n.id),
          active: n.id === activeId,
          dimmed: !!neighbours && !neighbours.has(n.id),
          fkColumns: fkColumns.get(n.id) ?? NO_COLUMNS,
        },
      })),
    [nodes, expanded, activeId, neighbours, fkColumns],
  );

  const edges = useMemo<Edge[]>(() => {
    const colors = EDGE_COLORS[theme];
    return schema.relations.map((r) => {
      const touches = !!activeId && (r.from === activeId || r.to === activeId);
      const color = touches ? colors.active : colors.idle;
      return {
        id: r.id,
        source: r.from,
        target: r.to,
        sourceHandle: columnSource(r.fromColumns[0]),
        targetHandle: r.toColumns.length ? columnTarget(r.toColumns[0]) : HEADER_TARGET,
        type: 'smoothstep',
        animated: touches,
        label: touches ? `${r.fromColumns.join(', ')} → ${r.toColumns.join(', ')}` : undefined,
        className: touches ? 'edge--active' : activeId ? 'edge--dimmed' : undefined,
        style: { stroke: color, strokeWidth: touches ? 2 : 1.25 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        zIndex: touches ? 1 : 0,
      };
    });
  }, [schema, activeId, theme]);

  const selected = schema.tables.find((t) => t.id === selectedId);

  return (
    <div className="app">
      <Sidebar
        schema={schema}
        sourceLabel={sourceLabel}
        sql={sql}
        selectedId={selectedId}
        onSelect={focusTable}
        onApplySql={applySql}
        onLoadSample={() => applySql(sample)}
        onConnect={connect}
      />
      <main className="canvas">
        <ToggleTableContext.Provider value={toggleTable}>
          <ReactFlow
            nodes={viewNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onNodeMouseEnter={(_, n) => setHoveredId(n.id)}
            onNodeMouseLeave={() => setHoveredId(null)}
            onPaneClick={() => setSelectedId(null)}
            nodesConnectable={false}
            edgesFocusable={false}
            colorMode={theme}
            minZoom={0.05}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (neighbours?.has(n.id) ? EDGE_COLORS[theme].active : EDGE_COLORS[theme].idle)} />
            <Panel position="top-right" className="toolbar">
              <button className="btn" onClick={() => setAllExpanded(true)}>
                Expand all
              </button>
              <button className="btn" onClick={() => setAllExpanded(false)}>
                Collapse all
              </button>
              <button className="btn" onClick={() => arrange(expanded)} title="Re-run the automatic layout">
                Arrange
              </button>
              <button className="btn" onClick={() => exportDiagram(viewNodes, 'png')}>
                PNG
              </button>
              <button className="btn" onClick={() => exportDiagram(viewNodes, 'svg')}>
                SVG
              </button>
              <button className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </Panel>
            {!schema.tables.length && (
              <Panel position="top-center" className="empty">
                No tables found. Paste SQL or connect a Supabase project from the sidebar.
              </Panel>
            )}
          </ReactFlow>
        </ToggleTableContext.Provider>
      </main>
      {selected && (
        <DetailPanel
          schema={schema}
          table={selected}
          expanded={expanded.has(selected.id)}
          onToggleExpanded={() => toggleTable(selected.id)}
          onSelect={focusTable}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
