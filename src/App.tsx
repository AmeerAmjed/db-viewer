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
import { copyDiagram, downloadDiagram, downloadText } from './diagram/exportImage';
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
import example from './schema/example.sql?raw';
import { subset, toDbml, toJson, toMermaid, toSql } from './schema/exporters';
import { parseOpenApi } from './schema/openApi';
import { parseSql } from './schema/sqlParser';
import { CAN_CONNECT } from './env';
import { load, loadSession, remove, removeSession, save, saveSession } from './storage';
import DetailPanel from './ui/DetailPanel';
import ExportMenu, { type CopyFormat, type ExportFormat } from './ui/ExportMenu';
import { DetailsPanelIcon, MoonIcon, SidebarIcon, SunIcon } from './ui/icons';
import Sidebar from './ui/Sidebar';
import { useTheme } from './ui/useTheme';
import MobileNav from './ui/MobileNav';
import WelcomeDialog from './ui/WelcomeDialog';
import { useMediaQuery } from './ui/useDismiss';

const nodeTypes = { table: TableNode };
const edgeTypes = { relation: RelationEdge };
const NO_COLUMNS: ReadonlySet<string> = new Set();
// Edge colours are passed inline rather than via CSS variables: SVG strokes and fills set from
// variables are lost when html-to-image exports the diagram.
const EDGE_COLORS = {
  light: { idle: '#a1a1aa', active: '#16a34a' },
  dark: { idle: '#52525b', active: '#3ecf8e' },
};

type TextFormat = 'sql' | 'mermaid' | 'dbml' | 'json';
const TEXT_EXPORTERS: Record<TextFormat, { label: string; ext: string; mime: string; render: (s: Schema) => string }> = {
  sql: { label: 'SQL', ext: 'sql', mime: 'application/sql', render: toSql },
  mermaid: { label: 'Mermaid', ext: 'mmd', mime: 'text/plain', render: toMermaid },
  dbml: { label: 'DBML', ext: 'dbml', mime: 'text/plain', render: toDbml },
  json: { label: 'JSON', ext: 'json', mime: 'application/json', render: toJson },
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
  const phone = useMediaQuery(PHONE_QUERY);
  const { fitView, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  useViewport(); // re-render on pan/zoom so a pinned card follows its line

  const [startup] = useState(restore);
  const [sql, setSql] = useState(() => load('sv.sql') ?? '');
  const [schema, setSchema] = useState<Schema>(startup.schema);
  const [sourceLabel, setSourceLabel] = useState(startup.label);
  // Saving the schema is opt-in; a copy saved before the opt-in existed counts as opted in
  const [remember, setRemember] = useState(() => {
    const stored = load('sv.remember');
    return stored ? stored === 'on' : load('sv.sql') !== null;
  });
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  // The SQL behind the diagram on screen; null for a connected project, which is never saved
  const shownSql = useRef<{ text: string; label: string } | null>(startup.connected || !sql ? null : { text: sql, label: sourceLabel });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{ id: string; x: number; y: number } | null>(null);
  // A clicked line stays lit with its card open; anchored in flow coordinates so it survives pan/zoom
  const [pinnedEdge, setPinnedEdge] = useState<{ id: string; flow: { x: number; y: number } } | null>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const [focus, setFocus] = useState(false);
  // On a phone the sidebar is a drawer over the diagram: it starts closed and its state isn't saved
  const [sidebarOpen, setSidebarOpen] = useState(() => !isPhone() && load('sv.sidebar') !== 'closed');
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
    if (isPhone()) setSidebarOpen(false); // show the diagram that was just loaded
  }, []);

  const applySql = useCallback(
    (text: string, label = 'pasted SQL') => {
      setSql(text);
      shownSql.current = { text, label };
      removeSession('sv.session');
      remove('sv.connected');
      if (remember) {
        save('sv.sql', text);
        save('sv.label', label);
      }
      showSchema(parseSql(text), label);
    },
    [showSchema, remember],
  );

  const changeRemember = (on: boolean) => {
    setRemember(on);
    save('sv.remember', on ? 'on' : 'off');
    if (on && shownSql.current) {
      save('sv.sql', shownSql.current.text);
      save('sv.label', shownSql.current.label);
    } else if (!on) {
      remove('sv.sql');
      remove('sv.label');
    }
  };

  const importFile = useCallback(async (file: File) => applySql(await file.text(), file.name), [applySql]);

  // Dropping a .sql file on the diagram imports it
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  useEffect(() => {
    // A file dropped anywhere else would make the browser navigate away to it
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  const connect = useCallback(
    async (url: string, key: string) => {
      const res = await fetch('/api/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, key }),
      });
      const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      const host = new URL(url).hostname;
      save('sv.url', url);
      // Keep the schema (never the key) for reloads of this tab, and remember that a project was on screen
      saveSession('sv.session', JSON.stringify({ label: host, spec: body }));
      save('sv.connected', host);
      shownSql.current = null;
      showSchema(parseOpenApi(body), host);
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
      // A phone's narrow screen would shrink a wide schema to unreadable; keep it legible and let it pan
      setTimeout(() => fitView({ padding: 0.08, duration: 300, minZoom: isPhone() ? 0.45 : undefined }), 50);
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
      if (isPhone()) setSidebarOpen(false);
      // In focus mode the focus layout effect fits the view instead
      if (!focus) fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.1, padding: phoneSheetPadding(detailsOpen) });
    },
    [fitView, focus, detailsOpen],
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
    setTimeout(
      () => fitView({ padding: phoneSheetPadding(detailsOpen) ?? 0.15, duration: 300, maxZoom: 1.2, minZoom: isPhone() ? 0.45 : undefined }),
      50,
    );
  }, [focusSet, selectedId, schema, expanded, fitView, detailsOpen]);

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
      if (!isPhone()) save('sv.sidebar', open ? 'closed' : 'open');
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
    if (!canHover()) return; // a tap would leave a hover card stuck open; taps pin instead
    const rect = canvasRef.current!.getBoundingClientRect();
    setHoveredEdge({ id, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const selected = schema.tables.find((t) => t.id === selectedId);

  const [toast, setToast] = useState<{ text: string; ms: number } | null>(
    startup.notice ? { text: startup.notice, ms: 7000 } : null,
  );
  const notify = (text: string, ms = 2500) => setToast({ text, ms });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.ms);
    return () => clearTimeout(t);
  }, [toast]);

  // Every export follows what's on screen: in focus mode, only the focused tables
  const visibleNodes = () => viewNodes.filter((n) => !n.hidden);
  const exportText = (format: TextFormat) => TEXT_EXPORTERS[format].render(subset(schema, focusSet ?? undefined));
  const baseName = sourceLabel === 'pasted SQL' ? 'schema' : sourceLabel.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');

  const download = async (format: ExportFormat) => {
    try {
      if (format === 'png' || format === 'svg') {
        await downloadDiagram(visibleNodes(), format, baseName);
        notify(`Downloaded ${baseName}.${format}`);
      } else {
        const { ext, mime } = TEXT_EXPORTERS[format];
        downloadText(exportText(format), `${baseName}.${ext}`, mime);
        notify(`Downloaded ${baseName}.${ext}`);
      }
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`);
    }
  };

  const copy = async (format: CopyFormat) => {
    try {
      if (format === 'image') await copyDiagram(visibleNodes());
      else await navigator.clipboard.writeText(exportText(format));
      notify(`Copied ${format === 'image' ? 'image' : TEXT_EXPORTERS[format].label} to clipboard`);
    } catch (err) {
      notify(`Copy failed: ${(err as Error).message}`);
    }
  };

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
        onClose={toggleSidebar}
        schema={schema}
        sourceLabel={sourceLabel}
        sql={sql}
        selectedId={selectedId}
        onSelect={focusTable}
        onApplySql={applySql}
        onLoadExample={() => applySql(example, 'example')}
        onImportFile={importFile}
        onConnect={connect}
      />
      {sidebarOpen && <div className="drawer-backdrop" onClick={toggleSidebar} aria-hidden="true" />}
      <main
        className="canvas"
        ref={canvasRef}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(false);
          const file = e.dataTransfer.files[0];
          if (file) void importFile(file);
        }}
      >
        {phone && (
          <MobileNav
            title="DB Viewer"
            onOpenSidebar={toggleSidebar}
            onOpenSchema={() => setWelcomeOpen(true)}
            focus={focus}
            onToggleFocus={() => setFocus((f) => !f)}
            onExpandAll={() => setAllExpanded(true)}
            onCollapseAll={() => setAllExpanded(false)}
            onArrange={() => arrange(expanded)}
            dark={theme === 'dark'}
            onToggleTheme={toggleTheme}
            details={selected ? { open: detailsOpen, onToggle: toggleDetails } : null}
            canExport={schema.tables.length > 0}
            exportScope={focusSet ? `Only the ${focusSet.size} tables in focus` : 'All tables'}
            onDownload={download}
            onCopy={copy}
          />
        )}
        {dropping && <div className="drop-overlay">Drop a .sql file to visualize it</div>}
        {/* While the dialog is open it shows the toast itself: a modal covers the canvas */}
        {toast && !welcomeOpen && (
          <div className="toast" role="status">
            {toast.text}
          </div>
        )}
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
            onNodeMouseEnter={(_, n) => canHover() && setHoveredId(n.id)}
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
            {/* Phones get the MobileNav bar instead */}
            {!phone && (
              <>
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
                  <button className="btn" onClick={() => setWelcomeOpen(true)} title="Paste, drop or import another schema">
                    Open schema
                  </button>
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
                  <ExportMenu
                    disabled={!schema.tables.length}
                    scope={focusSet ? `Only the ${focusSet.size} tables in focus` : 'All tables'}
                    onDownload={download}
                    onCopy={copy}
                  />
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
              </>
            )}
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
                No tables found.{' '}
                <button className="link-btn" onClick={() => setWelcomeOpen(true)}>
                  Open a schema
                </button>
                {CAN_CONNECT ? ', connect a Supabase project from the sidebar,' : ''} or{' '}
                <button className="link-btn" onClick={() => applySql(example, 'example')}>
                  load an example
                </button>
                .
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
      <WelcomeDialog
        open={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
        current={
          schema.tables.length
            ? { label: sourceLabel, tables: schema.tables.filter((t) => !t.external).length, saved: remember && shownSql.current !== null }
            : null
        }
        remember={remember}
        onRememberChange={changeRemember}
        onApplySql={applySql}
        onLoadExample={() => applySql(example, 'example')}
        onImportFile={importFile}
        onConnect={connect}
        initialTab={startup.reconnect ? 'connect' : 'sql'}
        toast={toast?.text ?? null}
      />
    </div>
  );
}

/**
 * What to show on launch. A project connected in this tab comes back from sessionStorage. If one was
 * on screen but the tab has since closed, the saved SQL (if any) shows and the user is asked to
 * connect again.
 */
function restore(): { schema: Schema; label: string; connected: boolean; reconnect: boolean; notice: string | null } {
  const sqlSchema = () => parseSql(load('sv.sql') ?? '');
  const sqlLabel = load('sv.label') ?? 'pasted SQL';
  const session = loadSession('sv.session');
  if (session) {
    try {
      const { label, spec } = JSON.parse(session);
      return { schema: parseOpenApi(spec), label, connected: true, reconnect: false, notice: `Restored ${label} from this session` };
    } catch {
      removeSession('sv.session');
    }
  }
  const host = load('sv.connected');
  if (host && CAN_CONNECT) {
    return {
      schema: sqlSchema(),
      label: sqlLabel,
      connected: false,
      reconnect: true,
      notice: `Connect again to load ${host}: connected projects aren't kept after the tab closes`,
    };
  }
  return { schema: sqlSchema(), label: sqlLabel, connected: false, reconnect: false, notice: null };
}

/** Matches the phone layout breakpoint in styles.css. */
const PHONE_QUERY = '(max-width: 800px)';
const isPhone = () => matchMedia(PHONE_QUERY).matches;

/** Touch screens fire hover on tap and never end it, so hover effects are mouse/trackpad only. */
const canHover = () => matchMedia('(hover: hover)').matches;

/**
 * On a phone, while the details bottom sheet is open it covers the lower 60% of the screen and the
 * toolbar the top, so fit tables into the strip between them.
 */
const px = (n: number): `${number}px` => `${n}px`;
const phoneSheetPadding = (sheetOpen: boolean) =>
  isPhone() && sheetOpen ? { top: px(110), bottom: px(Math.round(innerHeight * 0.6) + 16), left: px(16), right: px(16) } : undefined;

function relatives(schema: Schema, id: string): Set<string> {
  const set = new Set([id]);
  for (const r of schema.relations) {
    if (r.from === id) set.add(r.to);
    if (r.to === id) set.add(r.from);
  }
  return set;
}
