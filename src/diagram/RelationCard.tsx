import { kindLabel, type Relation, type Schema } from '../schema/model';
import { CloseIcon } from '../ui/icons';

const OFFSET = 14;
const CARD_WIDTH = 260;
const CARD_HEIGHT = 150;

interface Props {
  schema: Schema;
  relation: Relation;
  /** Opened by clicking the line: stays put and can be closed, instead of following the pointer. */
  pinned: boolean;
  onClose: () => void;
  /** Pointer position relative to the canvas element. */
  x: number;
  y: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** Floating details for the hovered or pinned (clicked) line; the only relation text drawn over the diagram. */
export default function RelationCard({ schema, relation: r, pinned, onClose, x, y, canvasWidth, canvasHeight }: Props) {
  const from = schema.tables.find((t) => t.id === r.from);
  const to = schema.tables.find((t) => t.id === r.to);
  const nullable = r.fromColumns.some((c) => from?.columns.find((col) => col.name === c)?.nullable);
  const name = (id: string) => {
    const t = schema.tables.find((x) => x.id === id);
    return !t || t.schema === 'public' ? (t?.name ?? id) : t.id;
  };

  // Keep the card on screen: flip to the pointer's other side near the right/bottom edge
  const left = x + OFFSET + CARD_WIDTH > canvasWidth ? x - OFFSET - CARD_WIDTH : x + OFFSET;
  const top = y + OFFSET + CARD_HEIGHT > canvasHeight ? Math.max(8, y - OFFSET - CARD_HEIGHT) : y + OFFSET;

  return (
    <div
      className={pinned ? 'rel-card rel-card--pinned' : 'rel-card'}
      style={{ left, top, width: CARD_WIDTH }}
      role={pinned ? 'region' : 'tooltip'}
      aria-label="Relation details"
    >
      <div className="rel-card-head">
        <span className="rel-card-kind">{kindLabel(r.kind)}</span>
        <span>{r.kind}</span>
        {pinned && (
          <button className="rel-card-close" onClick={onClose} aria-label="Unpin relation" title="Unpin (Esc)">
            <CloseIcon />
          </button>
        )}
      </div>
      <div className="rel-card-path">
        <span>
          {name(r.from)}.<b>{r.fromColumns.join(', ')}</b>
        </span>
        <span className="muted">↓ references</span>
        <span>
          {name(r.to)}.<b>{r.toColumns.join(', ')}</b>
        </span>
      </div>
      <div className="badges">
        <span className="badge">{nullable ? 'nullable · optional' : 'not null · required'}</span>
        {r.name && <span className="badge">{r.name}</span>}
        {to?.external && <span className="badge">outside pasted schema</span>}
      </div>
    </div>
  );
}
