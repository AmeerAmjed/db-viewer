import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesState,
  useReactFlow,
  useViewport,
  type NodeChange,
  type NodeDimensionChange,
  type NodePositionChange,
  type NodeSelectionChange,
  type XYPosition,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copyDiagram, downloadDiagram, downloadText } from './diagram/exportImage';
import { DAGRE_LIMIT, HEADER_HEIGHT, layoutSchema, NODE_WIDTH, nodeHeight } from './diagram/layout';
import Overview, { boxAt, type Box } from './diagram/Overview';
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
import { findTable, relationsOf, tableIndex, type Relation, type Schema, type Table } from './schema/model';
import example from './schema/example.sql?raw';
import { subset, toDbml, toJson, toMermaid, toSql } from './schema/exporters';
import { parseOpenApi } from './schema/openApi';
import { parseSql, parseSqlInBatches } from './schema/sqlParser';
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
const DEFAULT_MIN_ZOOM = 0.05;
/** Below this zoom a huge schema is drawn by the overview canvas: table names are unreadable anyway. */
const OVERVIEW_ZOOM = 0.25;
// Canvas fills can't read CSS variables: these match --node and --border in styles.css
const OVERVIEW_COLORS = {
  light: { table: '#ffffff', border: '#e4e4e7' },
  dark: { table: '#1f1f1f', border: '#2e2e2e' },
};
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
  const { fitView, screenToFlowPosition, flowToScreenPosition, setCenter, setViewport } = useReactFlow();
  // Re-renders on pan/zoom: a pinned card follows its line, and a huge schema redraws what's on screen
  const viewport = useViewport();
  const flowRef = useRef<HTMLDivElement>(null);
  const flowSize = useElementSize(flowRef);
  // Lowered for huge schemas so the whole diagram fits on screen
  const [minZoom, setMinZoom] = useState(DEFAULT_MIN_ZOOM);

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
  // What a slow step on a large schema is doing; shown over the canvas (or in the dialog) until it ends
  const [busy, setBusy] = useState<string | null>(() =>
    isLarge(startup.schema) ? `Drawing ${startup.schema.tables.length.toLocaleString()} tables…` : null,
  );
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

  // Whether the SQL on screen is in localStorage: a large schema can be past the storage quota
  const [stored, setStored] = useState(() => load('sv.sql') !== null);
  // Why the SQL on screen couldn't be stored, for the dialog to say so next to it
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const storeSql = (text: string, label: string) => {
    const ok = save('sv.sql', text) && save('sv.label', label);
    setStored(ok);
    setUnsaved(null);
    if (ok) return;
    remove('sv.sql'); // never leave a copy that doesn't match its label
    // save() can't say why it failed; past the quota is by far the likelier reason for big SQL
    const tooBig = text.length > STORAGE_QUOTA_BYTES;
    setUnsaved(tooBig ? 'too large to save on this device' : 'browser storage is blocked');
    notify(
      tooBig
        ? `Couldn't remember ${label} on this device: at ${Math.round(text.length / 1024 / 1024)} MB it's over the browser's storage limit of about 5 MB.`
        : `Couldn't remember ${label}: this browser is blocking site storage.`,
      6000,
    );
  };

  const applySql = useCallback(
    async (text: string, label = 'pasted SQL') => {
      // Check before touching state, so a bad paste or file leaves the current diagram alone
      tooLarge(text.length);
      let next: Schema;
      try {
        // A large schema is parsed in batches with its progress painted in between
        next =
          text.length < LARGE_FILE_BYTES
            ? parseSql(text)
            : await parseSqlInBatches(text, async (done) => {
                setBusy(`Parsing ${label}… ${Math.round(done * 100)}%`);
                await nextPaint();
              });
        if (!next.tables.some((t) => !t.external)) {
          // The parser's warnings say which statement it could not read
          const why = next.warnings.slice(0, 3).map((w) => `\n• ${w}`).join('');
          throw new Error(`No tables found. Paste or import CREATE TABLE statements (Supabase “Schema for context”, pg_dump or migrations).${why}`);
        }
      } catch (err) {
        setBusy(null);
        throw err;
      }
      // Cleared by `arrange` once the new diagram has been drawn
      if (isLarge(next)) setBusy(`Drawing ${next.tables.length.toLocaleString()} tables…`);
      setSql(text);
      shownSql.current = { text, label };
      removeSession('sv.session');
      remove('sv.connected');
      if (remember) storeSql(text, label);
      else setUnsaved(null);
      showSchema(next, label);
    },
    [showSchema, remember],
  );

  const changeRemember = (on: boolean) => {
    setRemember(on);
    save('sv.remember', on ? 'on' : 'off');
    if (on && shownSql.current) {
      storeSql(shownSql.current.text, shownSql.current.label);
    } else if (!on) {
      remove('sv.sql');
      remove('sv.label');
      setStored(false);
      setUnsaved(null);
    }
  };

  const importFile = useCallback(
    async (file: File) => {
      tooLarge(file.size); // before reading: a 1 GB file.text() alone can exhaust the tab's memory
      // Reading a big file takes a moment; applySql then reports the parsing itself
      if (file.size >= LARGE_FILE_BYTES) {
        setBusy(`Reading ${file.name}…`);
        await nextPaint();
      }
      let text: string;
      try {
        text = await file.text();
      } catch (err) {
        setBusy(null);
        throw err;
      }
      await applySql(text, file.name);
    },
    [applySql],
  );

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
          // Known sizes let React Flow cull and fit tables it hasn't rendered and measured yet
          initialWidth: NODE_WIDTH,
          initialHeight: nodeHeight(table, exp.has(table.id)),
          data: { table, expanded: false, dimmed: false, active: false, fkColumns: NO_COLUMNS, highlightColumns: NO_COLUMNS },
        })),
      );
      // A huge schema's tables aren't all in React Flow, so fitView can't see them: fit their bounds,
      // first lowering the zoom limit far enough for them to fit
      const el = flowRef.current;
      const fit = isHuge(schema) && el ? fitBounds(schema.tables, positions, exp, el.clientWidth, el.clientHeight) : null;
      setMinZoom(fit ? Math.min(DEFAULT_MIN_ZOOM, fit.zoom) : DEFAULT_MIN_ZOOM);
      // Let React Flow measure the new nodes before fitting. The timer only fires once the drawing
      // is done, so it also ends a loading message.
      // A phone's narrow screen would shrink a wide schema to unreadable; keep it legible and let it pan
      setTimeout(() => {
        setBusy(null);
        if (fit) setViewport(fit);
        else fitView({ padding: 0.08, duration: 300, minZoom: isPhone() ? 0.45 : undefined });
      }, 50);
    },
    [schema, setNodes, fitView, setViewport],
  );

  useEffect(() => arrange(new Set()), [arrange]);

  /** Runs `work` after painting `label`, on schemas big enough for it to freeze the page a while. */
  const withBusy = async (label: string, work: () => void) => {
    if (isLarge(schema)) {
      setBusy(label);
      await nextPaint();
    }
    work();
  };

  // Expanding one table re-runs the layout so it doesn't overlap its neighbours, shifted so the
  // toggled table stays put on screen.
  const toggleTable = useCallback(
    (id: string) => {
      const next = new Set(expanded);
      if (!next.delete(id)) next.add(id);
      setExpanded(next);
      const positions = layoutSchema(schema, next);
      // Read `before` inside the updater rather than depending on `nodes`: this callback is the
      // context value of every table, and a new one on each measured size re-renders them all.
      setNodes((ns) => {
        const before = ns.find((n) => n.id === id)?.position;
        const dx = before ? before.x - positions[id].x : 0;
        const dy = before ? before.y - positions[id].y : 0;
        return ns.map((n) => ({ ...n, position: { x: positions[n.id].x + dx, y: positions[n.id].y + dy } }));
      });
    },
    [expanded, schema, setNodes],
  );

  const setAllExpanded = (all: boolean) =>
    withBusy(all ? 'Expanding all tables…' : 'Collapsing all tables…', () => {
      const next = all ? new Set(schema.tables.map((t) => t.id)) : new Set<string>();
      setExpanded(next);
      arrange(next);
    });
  const rearrange = () => withBusy('Arranging tables…', () => arrange(expanded));

  // Read at call time by zoomTo, which would otherwise change identity on every drag frame
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  /** Centres a table at full size. On a huge schema it may not be in React Flow yet, so fitView can't. */
  const zoomTo = useCallback(
    (id: string) => {
      if (!isHuge(schema)) {
        fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.1, padding: phoneSheetPadding(detailsOpen) });
        return;
      }
      const n = nodeOf(schema, nodesRef.current, id);
      if (n) setCenter(n.position.x + NODE_WIDTH / 2, n.position.y + HEADER_HEIGHT / 2, { zoom: 1, duration: 400 });
    },
    [schema, fitView, setCenter, detailsOpen],
  );

  const focusTable = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (isPhone()) setSidebarOpen(false);
      // In focus mode the focus layout effect fits the view instead
      if (!focus) zoomTo(id);
    },
    [zoomTo, focus],
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
      // applyNodeChanges walks every node; on a huge schema, patch just the ones that changed
      const patches = changes.filter(
        (c): c is NodeDimensionChange | NodePositionChange | NodeSelectionChange =>
          c.type === 'dimensions' || c.type === 'position' || c.type === 'select',
      );
      if (!isHuge(schema) || patches.length < changes.length) return onNodesChange(changes);
      setNodes((ns) => {
        const out = ns.slice();
        for (const c of patches) {
          const i = tableIndex(schema, c.id);
          if (i !== undefined && out[i]?.id === c.id) out[i] = applyNodeChanges([c], [out[i]])[0];
        }
        return out;
      });
    },
    [focusPositions, onNodesChange, schema, setNodes],
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

  // A huge schema never goes into React Flow whole: every store update would walk all of it.
  // Zoomed out, a canvas draws it; zoomed in, React Flow gets the tables on screen plus the tables
  // they are related to, so lines leading off screen still have both ends.
  const huge = isHuge(schema);
  const overview = huge && !focusSet && viewport.zoom < OVERVIEW_ZOOM;
  const boxes = useMemo(
    () =>
      overview
        ? new Map<string, Box>(nodes.map((n) => [n.id, { ...n.position, height: nodeHeight(n.data.table, expanded.has(n.id)) }]))
        : null,
    [overview, nodes, expanded],
  );
  const onScreen = useMemo(() => {
    if (!huge || overview || focusSet || !flowSize.width) return null;
    const { x, y, zoom } = viewport;
    // A margin so tables just past the edge are already mounted when a pan brings them in
    const margin = 200 / zoom;
    const left = -x / zoom - margin;
    const top = -y / zoom - margin;
    const right = left + flowSize.width / zoom + 2 * margin;
    const bottom = top + flowSize.height / zoom + 2 * margin;
    const ids = new Set<string>();
    const visible: string[] = [];
    for (const n of nodes) {
      const { x: nx, y: ny } = n.position;
      if (nx > right || nx + NODE_WIDTH < left || ny > bottom || ny + nodeHeight(n.data.table, expanded.has(n.id)) < top) continue;
      visible.push(n.id);
      ids.add(n.id);
    }
    const relations = new Map<string, Relation>();
    for (const id of visible) {
      for (const r of relationsOf(schema, id)) {
        relations.set(r.id, r);
        ids.add(r.from);
        ids.add(r.to);
      }
    }
    return { ids, relations: [...relations.values()] };
  }, [huge, overview, focusSet, flowSize, viewport, nodes, expanded, schema]);
  // The nodes and relations handed to React Flow
  const flowNodes = useMemo(() => {
    if (!huge) return nodes;
    const ids = focusSet ?? onScreen?.ids;
    return ids ? [...ids].flatMap((id) => nodeOf(schema, nodes, id) ?? []) : [];
  }, [huge, schema, nodes, focusSet, onScreen]);
  const flowRelations = useMemo(() => {
    if (!huge) return schema.relations;
    if (focusSet) return selectedId ? relationsOf(schema, selectedId) : [];
    return onScreen?.relations ?? [];
  }, [huge, schema, focusSet, selectedId, onScreen]);

  // The previous render's node objects. A node whose flags didn't change keeps its object, so hovering
  // re-renders only the tables whose highlight changed rather than every table in a large schema.
  const prevViewNodes = useRef(new Map<string, { source: TableNodeType; view: TableNodeType }>());
  const viewNodes = useMemo(() => {
    const prev = prevViewNodes.current;
    const next = new Map<string, { source: TableNodeType; view: TableNodeType }>();
    const out = flowNodes.map((n) => {
      const highlight =
        lineRelation && n.id === lineRelation.from
          ? new Set(lineRelation.fromColumns)
          : lineRelation && n.id === lineRelation.to
            ? new Set(lineRelation.toColumns)
            : NO_COLUMNS;
      const position = focusPositions?.[n.id] ?? n.position;
      const hidden = !!focusSet && !focusSet.has(n.id);
      const data = {
        ...n.data,
        expanded: expanded.has(n.id),
        active: lineRelation ? neighbours!.has(n.id) : n.id === activeId,
        dimmed: !!neighbours && !neighbours.has(n.id),
        fkColumns: fkColumns.get(n.id) ?? NO_COLUMNS,
        highlightColumns: highlight,
      };
      const old = prev.get(n.id);
      const same =
        old &&
        old.source === n &&
        old.view.position === position &&
        old.view.hidden === hidden &&
        (Object.keys(data) as (keyof typeof data)[]).every((k) => old.view.data[k] === data[k]);
      const view = same ? old.view : { ...n, position, hidden, data };
      next.set(n.id, { source: n, view });
      return view;
    });
    prevViewNodes.current = next;
    return out;
  }, [flowNodes, expanded, activeId, lineRelation, neighbours, fkColumns, focusSet, focusPositions]);

  const edges = useMemo<RelationEdgeType[]>(() => {
    const colors = EDGE_COLORS[theme];
    return flowRelations.map((r) => {
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
  }, [flowRelations, activeId, lineRelation, theme, focusSet, selectedId]);

  const trackEdge = (e: React.MouseEvent, id: string) => {
    if (!canHover()) return; // a tap would leave a hover card stuck open; taps pin instead
    const rect = canvasRef.current!.getBoundingClientRect();
    setHoveredEdge({ id, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const selected = selectedId ? findTable(schema, selectedId) : undefined;
  const ownTables = useMemo(() => schema.tables.filter((t) => !t.external).length, [schema]);

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
          if (file) importFile(file).catch((err: Error) => notify(err.message, 5000));
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
            onArrange={rearrange}
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
        {busy && !welcomeOpen && <BusyOverlay label={busy} />}
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
            onPaneClick={(e) => {
              setPinnedEdge(null);
              // The overview canvas lets clicks through to the pane; a click on one of its tables opens it
              const hit = boxes && boxAt(boxes, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              setSelectedId(hit || null);
              if (hit) zoomTo(hit);
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
            minZoom={minZoom}
            ref={flowRef}
            // Mounting thousands of tables at once stalls the browser; render only what's in view.
            // A huge schema is already cut down to what's on screen, and the related tables off
            // screen must still render for the lines to them to be drawn.
            onlyRenderVisibleElements={isLarge(schema) && !huge}
          >
            <RelationMarkers colors={EDGE_COLORS[theme]} />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            {boxes && (
              <Overview
                boxes={boxes}
                relations={schema.relations}
                viewport={viewport}
                width={flowSize.width}
                height={flowSize.height}
                lit={neighbours}
                colors={{ ...OVERVIEW_COLORS[theme], ...EDGE_COLORS[theme] }}
              />
            )}
            <Controls showInteractive={false} />
            {/* At this size the minimap is an unreadable smear that redraws every table on each pan */}
            {!huge && (
              <MiniMap pannable zoomable nodeColor={(n) => (neighbours?.has(n.id) ? EDGE_COLORS[theme].active : EDGE_COLORS[theme].idle)} />
            )}
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
                  <button className="btn" onClick={rearrange} title="Re-run the automatic layout">
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
            ? { label: sourceLabel, tables: ownTables, saved: remember && stored && shownSql.current !== null, unsaved: shownSql.current && unsaved }
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
        busy={busy}
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

/**
 * About 250,000 tables. Past that, reading the file and holding the parsed schema take more memory
 * than a tab reliably has, so larger input is refused up front.
 */
const MAX_SQL_BYTES = 128 * 1024 * 1024;
/** Files above this are slow enough to read and parse that the steps get a loading message. */
const LARGE_FILE_BYTES = 256 * 1024;
/** About what browsers let one site keep in localStorage (Chrome refuses 5 MB of text). */
const STORAGE_QUOTA_BYTES = 4.5 * 1024 * 1024;

/** Schemas past the dagre limit take long enough to draw that they get a loading message. */
const isLarge = (schema: Schema) => schema.tables.length > DAGRE_LIMIT;
/**
 * Schemas too big to hand to React Flow whole (see `flowNodes`). Past this the minimap goes too: it
 * would be an unreadable smear that redraws every table on each pan.
 */
const isHuge = (schema: Schema) => schema.tables.length > 3000;

/** The viewport that fits every table on a `width` × `height` screen, at most at full size. */
function fitBounds(tables: Table[], positions: Record<string, XYPosition>, expanded: ReadonlySet<string>, width: number, height: number) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of tables) {
    const p = positions[t.id];
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_WIDTH);
    maxY = Math.max(maxY, p.y + nodeHeight(t, expanded.has(t.id)));
  }
  const zoom = Math.min(1, (width * 0.92) / (maxX - minX), (height * 0.92) / (maxY - minY));
  return { zoom, x: (width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (height - (maxY - minY) * zoom) / 2 - minY * zoom };
}

/** The node for table `id`: nodes are in `schema.tables` order, so no search is needed. */
function nodeOf(schema: Schema, nodes: TableNodeType[], id: string): TableNodeType | undefined {
  const i = tableIndex(schema, id);
  const n = i === undefined ? undefined : nodes[i];
  return n?.id === id ? n : undefined; // nodes still from the previous schema until arrange runs
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Resolves after the browser has painted, so a loading message shows before blocking work starts. */
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

function BusyOverlay({ label }: { label: string }) {
  return (
    <div className="busy-overlay" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

function tooLarge(bytes: number) {
  if (bytes <= MAX_SQL_BYTES) return;
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
  throw new Error(`This schema is ${mb(bytes)}, more than the ${mb(MAX_SQL_BYTES)} the diagram can draw. Export only the schemas or tables you need.`);
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
  for (const r of relationsOf(schema, id)) {
    if (r.from === id) set.add(r.to);
    if (r.to === id) set.add(r.from);
  }
  return set;
}
