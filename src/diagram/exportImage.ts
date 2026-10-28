import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';

const PADDING = 40;
const MAX_SIDE = 8000;

/**
 * Renders every node (not just what's on screen) by snapshotting the React Flow viewport
 * element with a transform that fits all node bounds into the output image.
 */
export async function exportDiagram(nodes: Node[], format: 'png' | 'svg', fileName = 'schema') {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport || !nodes.length) return;

  const bounds = getNodesBounds(nodes);
  const scale = Math.min(2, MAX_SIDE / Math.max(bounds.width, bounds.height));
  const width = Math.ceil((bounds.width + PADDING * 2) * scale);
  const height = Math.ceil((bounds.height + PADDING * 2) * scale);
  const { x, y, zoom } = getViewportForBounds(bounds, width, height, scale, scale, `${PADDING * scale}px`);

  const options = {
    width,
    height,
    backgroundColor: getComputedStyle(document.body).getPropertyValue('--canvas').trim() || '#fff',
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
  };
  const dataUrl = format === 'png' ? await toPng(viewport, { ...options, pixelRatio: 1 }) : await toSvg(viewport, options);

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${fileName}.${format}`;
  a.click();
}
