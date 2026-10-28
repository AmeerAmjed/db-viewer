import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';
import { toBlob, toPng, toSvg } from 'html-to-image';

const PADDING = 40;
const MAX_SIDE = 8000;

/**
 * html-to-image options that render every given node (not just what's on screen): the React Flow
 * viewport element is snapshotted with a transform fitting all node bounds into the image.
 */
function snapshot(nodes: Node[]) {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport || !nodes.length) throw new Error('Nothing to export');

  const bounds = getNodesBounds(nodes);
  const scale = Math.min(2, MAX_SIDE / Math.max(bounds.width, bounds.height));
  const width = Math.ceil((bounds.width + PADDING * 2) * scale);
  const height = Math.ceil((bounds.height + PADDING * 2) * scale);
  const { x, y, zoom } = getViewportForBounds(bounds, width, height, scale, scale, `${PADDING * scale}px`);

  return {
    viewport,
    options: {
      width,
      height,
      pixelRatio: 1,
      backgroundColor: getComputedStyle(document.body).getPropertyValue('--canvas').trim() || '#fff',
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
    },
  };
}

export async function downloadDiagram(nodes: Node[], format: 'png' | 'svg', fileName = 'schema') {
  const { viewport, options } = snapshot(nodes);
  const dataUrl = format === 'png' ? await toPng(viewport, options) : await toSvg(viewport, options);
  saveUrl(dataUrl, `${fileName}.${format}`);
}

/** Puts a PNG of the diagram on the clipboard (needs a secure context such as localhost). */
export async function copyDiagram(nodes: Node[]) {
  const { viewport, options } = snapshot(nodes);
  // Handing ClipboardItem the pending blob keeps the user-gesture window open while it renders
  const blob = toBlob(viewport, options).then((b) => {
    if (!b) throw new Error('Could not render the diagram');
    return b;
  });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function downloadText(text: string, fileName: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  saveUrl(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveUrl(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}
