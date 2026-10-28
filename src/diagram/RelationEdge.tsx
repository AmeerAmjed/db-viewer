import { BaseEdge, getBezierPath, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

// Lines carry no text: details appear in a RelationCard while a line is hovered.
export type RelationEdgeType = Edge<Record<string, never>, 'relation'>;

function RelationEdge(props: EdgeProps<RelationEdgeType>) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const params = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  // Curves fan out instead of sharing one vertical segment. A self-reference has to route around
  // its own table, which only the step path does.
  const [path] = source === target ? getSmoothStepPath({ ...params, offset: 24 }) : getBezierPath(params);

  return (
    <BaseEdge
      id={id}
      path={path}
      style={props.style}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      interactionWidth={props.interactionWidth}
    />
  );
}

export default memo(RelationEdge);
