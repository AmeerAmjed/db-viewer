import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useViewport,
  type NodeChange,
  type NodePositionChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportDiagram } from './diagram/exportImage';
import { layoutSchema } from './diagram/layout';
import RelationCard from './diagram/RelationCard';
import RelationEdge, { type RelationEdgeType } from './diagram/RelationEdge';
import { MarkerSample, markerId, RelationMarkers } from './diagram/RelationMarkers';
import TableNode, {
  columnSource,
  columnTarget,
  HEADER_TARGET,
  ToggleTableContext,
  type TableNodeType,
} from './diagram/TableNode';
import type { Schema } from './schema/model';
import { parseOpenApi } from './schema/openApi';
import { parseSql } from './schema/sqlParser';
import { load, save } from './storage';
import DetailPanel from './ui/DetailPanel';
import { DetailsPanelIcon, MoonIcon, SidebarIcon, SunIcon } from './ui/icons';
import Sidebar from './ui/Sidebar';
import { useTheme } from './ui/useTheme';

const nodeTypes = { table: TableNode };
const edgeTypes = { relation: RelationEdge };
const NO_COLUMNS: ReadonlySet<string> = new Set();
// Edge colours are passed inline rather than via CSS variables: SVG strokes and fills set from
// variables are lost when html-to-image exports the diagram.
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
  const { fitView, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  useViewport(); // re-render on pan/zoom so a pinned card follows its line

  const [sql, setSql] = useState(() => load('sv.sql') ?? '');
  const [schema, setSchema] = useState<Schema>(() => parseSql(sql));
  const [sourceLabel, setSourceLabel] = useState('pasted SQL');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{ id: string; x: number; y: number } | null>(null);
  // A clicked line stays lit with its card open; anchored in flow coordinates so it survives pan/zoom
  const [pinnedEdge, setPinnedEdge] = useState<{ id: string; flow: { x: number; y: number } } | null>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const [focus, setFocus] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => load('sv.sidebar') !== 'closed');
  // Hiding the details panel keeps the selection (and its highlight); only the panel goes away
  const [detailsOpen, setDetailsOpen] = useState(() => load('sv.details') !== 'closed');
  // Compact layout of just the focused table and its relatives; base positions stay untouched
  // underneath so leaving focus mode restores the full diagram as it was.
  const [focusPositions, setFocusPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  // Holds only id/position/table; per-render state (expanded, highlight) is layered on in viewNodes
  // so that toggling it never resets positions the user dragged.
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([]);

  const showSchema = useCallback((next: Schema, label: string) => {
    setSchema(next);
    setSourceLabel(label);
    setExpanded(new Set());
    setSelectedId(null);
    setPinnedEdge(null);
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
          data: { table, expanded: false, dimmed: false, active: false, fkColumns: NO_COLUMNS, highlightColumns: NO_COLUMNS },
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
      // In focus mode the focus layout effect fits the view instead
      if (!focus) fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.1 });
    },
    [fitView, focus],
  );

  /** In focus mode: the selected table plus every table it references or is referenced by. */
  const focusSet = useMemo(() => (focus && selectedId ? relatives(schema, selectedId) : null), [focus, selectedId, schema]);

  const wasFocused = useRef(false);
  useEffect(() => {
    if (focusSet) {
      const sub: Schema = {
        tables: schema.tables.filter((t) => focusSet.has(t.id)),
        relations: schema.relations.filter((r) => r.from === selectedId || r.to === selectedId),
        warnings: [],
      };
      setFocusPositions(layoutSchema(sub, expanded));
    } else {
      setFocusPositions(null);
      if (!wasFocused.current) return;
    }
    wasFocused.current = !!focusSet;
    setTimeout(() => fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 }), 50);
  }, [focusSet, selectedId, schema, expanded, fitView]);

  // Drags while focused move the focus layout, not the hidden full-diagram positions
  const handleNodesChange = useCallback(
    (changes: NodeChange<TableNodeType>[]) => {
      if (focusPositions) {
        const moved = changes.filter((c): c is NodePositionChange => c.type === 'position' && !!c.position);
        if (moved.length) setFocusPositions((p) => p && { ...p, ...Object.fromEntries(moved.map((c) => [c.id, c.position!])) });
        changes = changes.filter((c) => c.type !== 'position');
      }
      onNodesChange(changes);
    },
    [focusPositions, onNodesChange],
  );

  const toggleDetails = useCallback(() => {
    setDetailsOpen((open) => {
      save('sv.details', open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      save('sv.sidebar', open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') setFocus((f) => !f);
      if (e.key === '[') toggleSidebar();
      if (e.key === ']') toggleDetails();
      if (e.key === 'Escape') setPinnedEdge(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, toggleDetails]);

  const fkColumns = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of schema.relations) {
      if (!map.has(r.from)) map.set(r.from, new Set());
      r.fromColumns.forEach((c) => map.get(r.from)!.add(c));
    }
    return map;
  }, [schema]);

  const activeId = hoveredId ?? selectedId;
  const hoveredRelation = hoveredEdge ? schema.relations.find((r) => r.id === hoveredEdge.id) : undefined;
  const pinnedRelation = pinnedEdge ? schema.relations.find((r) => r.id === pinnedEdge.id) : undefined;
  // Focus mode can hide the pinned line; its card goes with it
  const pinnedVisible = !!pinnedRelation && (!focusSet || pinnedRelation.from === selectedId || pinnedRelation.to === selectedId);
  // The line being inspected: hovering another line temporarily wins over the pinned one
  const lineRelation = hoveredRelation ?? (pinnedVisible ? pinnedRelation : undefined);
  // A hovered line outranks a hovered/selected table: only its two tables stay lit
  const neighbours = useMemo(
    () =>
      lineRelation ? new Set([lineRelation.from, lineRelation.to]) : activeId ? relatives(schema, activeId) : null,
    [lineRelation, activeId, schema],
  );

  const viewNodes = useMemo(
    () =>
      nodes.map((n) => {
        const highlight =
          lineRelation && n.id === lineRelation.from
            ? new Set(lineRelation.fromColumns)
            : lineRelation && n.id === lineRelation.to
              ? new Set(lineRelation.toColumns)
              : NO_COLUMNS;
        return {
          ...n,
          position: focusPositions?.[n.id] ?? n.position,
          hidden: !!focusSet && !focusSet.has(n.id),
          data: {
            ...n.data,
            expanded: expanded.has(n.id),
            active: lineRelation ? neighbours!.has(n.id) : n.id === activeId,
            dimmed: !!neighbours && !neighbours.has(n.id),
            fkColumns: fkColumns.get(n.id) ?? NO_COLUMNS,
            highlightColumns: highlight,
          },
        };
      }),
    [nodes, expanded, activeId, lineRelation, neighbours, fkColumns, focusSet, focusPositions],
  );

  const edges = useMemo<RelationEdgeType[]>(() => {
    const colors = EDGE_COLORS[theme];
    return schema.relations.map((r) => {
      const lit = lineRelation ? r.id === lineRelation.id : !!activeId && (r.from === activeId || r.to === activeId);
      const anyLit = !!lineRelation || !!activeId;
      const state = lit ? 'active' : 'idle';
      return {
        id: r.id,
        source: r.from,
        target: r.to,
        sourceHandle: columnSource(r.fromColumns[0]),
        targetHandle: r.toColumns.length ? columnTarget(r.toColumns[0]) : HEADER_TARGET,
        type: 'relation',
        className: lit ? 'edge--active' : anyLit ? 'edge--dimmed' : undefined,
        style: { stroke: colors[state], strokeWidth: r.id === lineRelation?.id ? 3 : lit ? 2 : 1.25 },
        markerStart: markerId(r.kind === 'one-to-one' ? 'one' : 'many', state),
        markerEnd: markerId('one', state),
        interactionWidth: 24,
        zIndex: lit ? 1 : 0,
        // Focus mode shows only the focused table's own relations
        hidden: !!focusSet && r.from !== selectedId && r.to !== selectedId,
      };
    });
  }, [schema, activeId, lineRelation, theme, focusSet, selectedId]);

  const trackEdge = (e: React.MouseEvent, id: string) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    setHoveredEdge({ id, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const selected = schema.tables.find((t) => t.id === selectedId);

  const cardPosition = (() => {
    if (hoveredRelation && hoveredEdge) return hoveredEdge;
    if (!lineRelation || !pinnedEdge || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const p = flowToScreenPosition(pinnedEdge.flow);
    return { x: p.x - rect.left, y: p.y - rect.top };
  })();

  return (
    <div className={sidebarOpen ? 'app' : 'app app--no-sidebar'}>
      <Sidebar
        open={sidebarOpen}
        schema={schema}
        sourceLabel={sourceLabel}
        sql={sql}
        selectedId={selectedId}
        onSelect={focusTable}
        onApplySql={applySql}
        onConnect={connect}
      />
      <main className="canvas" ref={canvasRef}>
        <ToggleTableContext.Provider value={toggleTable}>
          <ReactFlow
            nodes={viewNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={handleNodesChange}
            onNodeClick={(_, n) => {
              setSelectedId(n.id);
              setPinnedEdge(null);
            }}
            onNodeMouseEnter={(_, n) => setHoveredId(n.id)}
            onNodeMouseLeave={() => setHoveredId(null)}
            onPaneClick={() => {
              setSelectedId(null);
              setPinnedEdge(null);
            }}
            onEdgeClick={(e, edge) =>
              setPinnedEdge((p) => (p?.id === edge.id ? null : { id: edge.id, flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }) }))
            }
            onEdgeMouseEnter={(e, edge) => trackEdge(e, edge.id)}
            onEdgeMouseMove={(e, edge) => trackEdge(e, edge.id)}
            onEdgeMouseLeave={() => setHoveredEdge(null)}
            nodesConnectable={false}
            edgesFocusable={false}
            colorMode={theme}
            minZoom={0.05}
          >
            <RelationMarkers colors={EDGE_COLORS[theme]} />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (neighbours?.has(n.id) ? EDGE_COLORS[theme].active : EDGE_COLORS[theme].idle)} />
            <Panel position="top-left">
              <button
                className={sidebarOpen ? 'icon-btn' : 'icon-btn icon-btn--on'}
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                aria-expanded={sidebarOpen}
                title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar ([)`}
              >
                <SidebarIcon />
              </button>
            </Panel>
            <Panel position="top-right" className="toolbar">
              <button
                className={focus ? 'btn btn--on' : 'btn'}
                aria-pressed={focus}
                onClick={() => setFocus((f) => !f)}
                title="Show only the selected table and the tables related to it (F)"
              >
                Focus
              </button>
              <button className="btn" onClick={() => setAllExpanded(true)}>
                Expand all
              </button>
              <button className="btn" onClick={() => setAllExpanded(false)}>
                Collapse all
              </button>
              <button className="btn" onClick={() => arrange(expanded)} title="Re-run the automatic layout">
                Arrange
              </button>
              <button className="btn" onClick={() => exportDiagram(viewNodes.filter((n) => !n.hidden), 'png')}>
                PNG
              </button>
              <button className="btn" onClick={() => exportDiagram(viewNodes.filter((n) => !n.hidden), 'svg')}>
                SVG
              </button>
              <button className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
              {/* Only offered while a table is selected: otherwise there are no details to show */}
              {selected && (
                <button
                  className={detailsOpen ? 'icon-btn' : 'icon-btn icon-btn--on'}
                  onClick={toggleDetails}
                  aria-label={detailsOpen ? 'Hide details panel' : 'Show details panel'}
                  aria-expanded={detailsOpen}
                  title={`${detailsOpen ? 'Hide' : 'Show'} table details (])`}
                >
                  <DetailsPanelIcon />
                </button>
              )}
            </Panel>
            <Panel position="bottom-center" className="legend">
              <span>
                <MarkerSample end="many" /> many
              </span>
              <span>
                <MarkerSample end="one" /> one
              </span>
              <span className="muted">hover or click a line for details</span>
            </Panel>
            {focus && !selectedId && schema.tables.length > 0 && (
              <Panel position="top-center" className="empty">
                Focus mode: select a table to show only it and its related tables.
              </Panel>
            )}
            {!schema.tables.length && (
              <Panel position="top-center" className="empty">
                No tables found. Paste SQL or connect a Supabase project from the sidebar.
              </Panel>
            )}
          </ReactFlow>
        </ToggleTableContext.Provider>
        {lineRelation && cardPosition && (
          <RelationCard
            schema={schema}
            relation={lineRelation}
            pinned={!hoveredRelation}
            onClose={() => setPinnedEdge(null)}
            x={cardPosition.x}
            y={cardPosition.y}
            canvasWidth={canvasRef.current?.clientWidth ?? 0}
            canvasHeight={canvasRef.current?.clientHeight ?? 0}
          />
        )}
      </main>
      {selected && detailsOpen && (
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

function relatives(schema: Schema, id: string): Set<string> {
  const set = new Set([id]);
  for (const r of schema.relations) {
    if (r.from === id) set.add(r.to);
    if (r.to === id) set.add(r.from);
  }
  return set;
}
