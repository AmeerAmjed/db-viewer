import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { createContext, memo, useContext, useEffect } from 'react';
import type { Table } from '../schema/model';
import { ColumnIcon, Chevron } from '../ui/icons';
import { NODE_WIDTH } from './layout';

export type TableNodeData = {
  table: Table;
  expanded: boolean;
  dimmed: boolean;
  active: boolean;
  fkColumns: ReadonlySet<string>;
};
export type TableNodeType = Node<TableNodeData, 'table'>;

/** Lets nodes toggle expansion without putting a callback in node data. */
export const ToggleTableContext = createContext<(id: string) => void>(() => {});

// Edges always attach to per-column handles. While a table is collapsed those handles sit in
// the header; expanding moves them onto the rows. Keeping the ids mounted either way means edges
// never point at a handle React Flow hasn't measured yet.
export const HEADER_SOURCE = 'h-s';
export const HEADER_TARGET = 'h-t';
export const columnSource = (column: string) => `c-${column}-s`;
export const columnTarget = (column: string) => `c-${column}-t`;

const ColumnHandles = ({ column }: { column: string }) => (
  <>
    <Handle type="target" position={Position.Left} id={columnTarget(column)} isConnectable={false} />
    <Handle type="source" position={Position.Right} id={columnSource(column)} isConnectable={false} />
  </>
);

function TableNode({ id, data }: NodeProps<TableNodeType>) {
  const { table, expanded, dimmed, active, fkColumns } = data;
  const toggle = useContext(ToggleTableContext);
  const updateNodeInternals = useUpdateNodeInternals();

  // Column handles move between header and rows on expansion; React Flow must re-measure them.
  useEffect(() => updateNodeInternals(id), [expanded, id, updateNodeInternals]);

  const className = ['tn', active && 'tn--active', dimmed && 'tn--dimmed', table.external && 'tn--external']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} style={{ width: NODE_WIDTH }}>
      <div className="tn-header" onDoubleClick={() => toggle(id)}>
        <Handle type="target" position={Position.Left} id={HEADER_TARGET} isConnectable={false} />
        <button
          className="tn-toggle nodrag"
          onClick={(e) => {
            e.stopPropagation();
            toggle(id);
          }}
          aria-label={expanded ? 'Collapse columns' : 'Expand columns'}
          aria-expanded={expanded}
        >
          <Chevron open={expanded} />
        </button>
        <span className="tn-name" title={table.id}>
          {table.name}
        </span>
        {table.schema !== 'public' && <span className="tn-schema">{table.schema}</span>}
        <span className="tn-count">{table.columns.length}</span>
        <Handle type="source" position={Position.Right} id={HEADER_SOURCE} isConnectable={false} />
        {!expanded && table.columns.map((c) => <ColumnHandles key={c.name} column={c.name} />)}
      </div>
      {expanded && (
        <div className="tn-body">
          {table.columns.map((c) => (
            <div className="tn-row" key={c.name}>
              <ColumnHandles column={c.name} />
              <ColumnIcon column={c} foreign={fkColumns.has(c.name)} />
              <span className="tn-col">{c.name}</span>
              <span className="tn-type" title={c.type}>
                {c.type}
                {c.nullable && !c.primary ? '?' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(TableNode);
