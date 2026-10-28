import { ViewportPortal } from '@xyflow/react';

type End = 'one' | 'many';
type State = 'idle' | 'active';

export const markerId = (end: End, state: State) => `sv-${end}-${state}`;

// Crow's-foot notation: `one` is a double bar, `many` a three-pronged foot opening onto the table.
// Drawn pointing at the line's end; orient="auto-start-reverse" mirrors them for markerStart.
const PATHS: Record<End, string> = {
  one: 'M10 3V17M15 3V17',
  many: 'M5 10L20 2M5 10L20 18M5 10H20',
};

/**
 * SVG marker definitions for relation edges. Rendered inside the viewport (not elsewhere in the
 * page) so image export, which clones only the viewport, still finds them.
 */
export function RelationMarkers({ colors }: { colors: Record<State, string> }) {
  return (
    <ViewportPortal>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          {(['idle', 'active'] as const).map((state) =>
            (['one', 'many'] as const).map((end) => (
                <marker
                  key={markerId(end, state)}
                  id={markerId(end, state)}
                  viewBox="0 0 20 20"
                  refX="20"
                  refY="10"
                  markerWidth="20"
                  markerHeight="20"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path d={PATHS[end]} fill="none" stroke={colors[state]} strokeWidth={1.5} strokeLinecap="round" />
                </marker>
            )),
          )}
        </defs>
      </svg>
    </ViewportPortal>
  );
}

/** Legend sample: a short line ending in the given marker shape. */
export const MarkerSample = ({ end }: { end: End }) => (
  <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden>
    <path d={`M0 10H34`} stroke="currentColor" strokeWidth={1.25} />
    <path d={PATHS[end]} transform="translate(14 0)" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
  </svg>
);
