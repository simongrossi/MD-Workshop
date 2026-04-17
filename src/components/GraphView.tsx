import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum
} from 'd3-force';
import type { GraphData, GraphMode, GraphNode } from '../types';

type Props = {
  rootFolder: string;
  activeFilePath: string | null;
  mode: GraphMode;
  depth: number;
  filterFolder: string;
  filterTags: string[];
  showOrphans: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onNavigate: (path: string) => void;
  onOpenInEditor?: (path: string) => void;
};

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { kind: 'wiki' | 'md' };

function readCssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#666';
}

export function GraphView({
  rootFolder,
  activeFilePath,
  mode,
  depth,
  filterFolder,
  filterTags,
  showOrphans,
  fullscreen,
  onToggleFullscreen,
  onNavigate,
  onOpenInEditor
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<SimNode | null>(null);
  const draggingRef = useRef<SimNode | null>(null);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const mouseDownPosRef = useRef<{ px: number; py: number } | null>(null);
  const didDragRef = useRef(false);

  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);

  // Fetch graph data. In global mode the active file only affects the node highlight,
  // not the fetched data, so exclude it from deps to avoid refetching on navigation.
  const fetchKey = mode === 'local' ? activeFilePath : '__global__';
  useEffect(() => {
    let cancelled = false;
    if (!rootFolder) return;
    if (mode === 'local' && !activeFilePath) {
      setData({ nodes: [], edges: [] });
      return;
    }

    setLoading(true);
    setError(null);

    const handle = window.setTimeout(() => {
      invoke<GraphData>('get_graph_data', {
        rootPath: rootFolder,
        mode,
        filePath: mode === 'local' ? activeFilePath : null,
        depth,
        filterFolder: mode === 'global' ? filterFolder || null : null,
        filterTags: mode === 'global' ? filterTags : [],
        includeOrphans: mode === 'global' ? showOrphans : true
      })
        .then((res) => {
          if (cancelled) return;
          setData(res);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(String(err));
          setData({ nodes: [], edges: [] });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder, fetchKey, mode, depth, filterFolder, filterTags.join('|'), showOrphans]);

  // When the active file changes in global mode, just redraw so the highlight moves.
  useEffect(() => {
    if (mode === 'global') draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath, mode]);

  // Build simulation when data changes
  useEffect(() => {
    if (!data) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 400;

    // Preserve positions for existing nodes so the view doesn't jump on refresh
    const prev = new Map(nodesRef.current.map((n) => [n.path, n]));
    const nodes: SimNode[] = data.nodes.map((n) => {
      const old = prev.get(n.path);
      return {
        ...n,
        x: old?.x,
        y: old?.y,
        vx: old?.vx,
        vy: old?.vy
      };
    });

    const byPath = new Map(nodes.map((n) => [n.path, n]));
    const links: SimLink[] = data.edges
      .map((e) => {
        const s = byPath.get(e.source);
        const t = byPath.get(e.target);
        if (!s || !t) return null;
        return { source: s, target: t, kind: e.kind } as SimLink;
      })
      .filter((l): l is SimLink => l !== null);

    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.path)
          .distance(50)
          .strength(0.4)
      )
      .force('charge', forceManyBody<SimNode>().strength(-140))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d) + 2))
      .alphaDecay(0.05)
      .on('tick', draw);

    simRef.current = sim;

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Observe theme changes to redraw with new colors
  useEffect(() => {
    const obs = new MutationObserver(() => draw());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver(() => {
      resizeCanvas();
      const sim = simRef.current;
      if (sim) {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        sim.force('center', forceCenter(width / 2, height / 2));
        sim.alpha(0.3).restart();
      }
    });
    ro.observe(container);
    resizeCanvas();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function nodeRadius(n: SimNode): number {
    if (n.is_unresolved) return 3.5;
    return Math.min(14, 4 + Math.sqrt(n.degree || 0) * 2);
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const accent = readCssVar('--accent');
    const text = readCssVar('--text');
    const muted = readCssVar('--muted');
    const line = readCssVar('--line');
    const canvasBg = readCssVar('--canvas');
    void canvasBg;

    const { x: tx, y: ty, k } = transformRef.current;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(k, k);

    // Edges
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    for (const l of linksRef.current) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      if (l.kind === 'md') {
        ctx.setLineDash([3, 3]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const r = nodeRadius(n);
      const isActive = !n.is_unresolved && n.path === activeFilePath;
      const isHover = hoverRef.current?.path === n.path;

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (n.is_unresolved) {
        ctx.fillStyle = muted;
        ctx.globalAlpha = 0.6;
      } else if (isActive) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = text;
        ctx.globalAlpha = (n.degree || 0) === 0 ? 0.4 : 0.75;
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isActive || isHover) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label for important or hovered nodes
      if (isActive || isHover || (k >= 1.2 && !n.is_unresolved)) {
        ctx.fillStyle = text;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.name, n.x + r + 3, n.y);
      }
    }

    ctx.restore();
  }

  // Mouse interactions
  function screenToWorld(ev: React.MouseEvent | MouseEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const { x: tx, y: ty, k } = transformRef.current;
    return { x: (px - tx) / k, y: (py - ty) / k, px, py };
  }

  function findNodeAt(x: number, y: number): SimNode | null {
    // Iterate in reverse so the top-drawn is picked first
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      if (n.x == null || n.y == null) continue;
      const r = nodeRadius(n) + 2;
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  function onMouseDown(ev: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y, px, py } = screenToWorld(ev);
    mouseDownPosRef.current = { px, py };
    didDragRef.current = false;
    const node = findNodeAt(x, y);
    if (node) {
      draggingRef.current = node;
      node.fx = node.x;
      node.fy = node.y;
      simRef.current?.alphaTarget(0.3).restart();
    } else {
      panStartRef.current = {
        x: px,
        y: py,
        tx: transformRef.current.x,
        ty: transformRef.current.y
      };
    }
  }

  function onMouseMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y, px, py } = screenToWorld(ev);
    // Track drag distance from mousedown origin; mark as drag past 4px
    const origin = mouseDownPosRef.current;
    if (origin && !didDragRef.current) {
      const dx = px - origin.px;
      const dy = py - origin.py;
      if (dx * dx + dy * dy > 16) didDragRef.current = true;
    }
    const drag = draggingRef.current;
    if (drag) {
      drag.fx = x;
      drag.fy = y;
      return;
    }
    const pan = panStartRef.current;
    if (pan) {
      transformRef.current.x = pan.tx + (px - pan.x);
      transformRef.current.y = pan.ty + (py - pan.y);
      draw();
      return;
    }
    // Hover
    const node = findNodeAt(x, y);
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = node ? 'pointer' : 'default';
    if (hoverRef.current?.path !== node?.path) {
      hoverRef.current = node;
      setHoveredNode(node);
      draw();
    }
  }

  function onMouseUp() {
    const drag = draggingRef.current;
    if (drag) {
      drag.fx = null;
      drag.fy = null;
      simRef.current?.alphaTarget(0);
      draggingRef.current = null;
    }
    panStartRef.current = null;
  }

  function onClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    // Ignore the click if the user was dragging or panning
    if (didDragRef.current) return;
    const { x, y } = screenToWorld(ev);
    const node = findNodeAt(x, y);
    if (node && !node.is_unresolved) {
      onNavigate(node.path);
    }
  }

  function onDoubleClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = screenToWorld(ev);
    const node = findNodeAt(x, y);
    if (node && !node.is_unresolved && onOpenInEditor) {
      onOpenInEditor(node.path);
    }
  }

  function onWheel(ev: React.WheelEvent<HTMLCanvasElement>) {
    ev.preventDefault();
    const { px, py } = screenToWorld(ev.nativeEvent as MouseEvent);
    const factor = ev.deltaY > 0 ? 0.9 : 1.1;
    const t = transformRef.current;
    const nextK = Math.min(4, Math.max(0.2, t.k * factor));
    const realFactor = nextK / t.k;
    t.x = px - (px - t.x) * realFactor;
    t.y = py - (py - t.y) * realFactor;
    t.k = nextK;
    draw();
  }

  function recenter() {
    transformRef.current = { x: 0, y: 0, k: 1 };
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (sim && canvas) {
      sim.force('center', forceCenter(canvas.clientWidth / 2, canvas.clientHeight / 2));
      sim.alpha(0.5).restart();
    }
    draw();
  }

  const stats = useMemo(() => {
    if (!data) return { nodes: 0, edges: 0 };
    return { nodes: data.nodes.length, edges: data.edges.length };
  }, [data]);

  return (
    <div className="graph-view-pane" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
      <div className="graph-overlay">
        <div className="graph-stats">
          {loading ? 'Chargement…' : `${stats.nodes} nœuds · ${stats.edges} liens`}
        </div>
        <button className="graph-recenter" onClick={recenter} title="Recentrer">
          Recentrer
        </button>
        {onToggleFullscreen && (
          <button
            className="graph-recenter"
            onClick={onToggleFullscreen}
            title={fullscreen ? 'Quitter le plein écran (Esc)' : 'Plein écran'}
          >
            {fullscreen ? 'Quitter' : 'Plein écran'}
          </button>
        )}
      </div>
      {error && <div className="graph-error">{error}</div>}
      {hoveredNode && (
        <div className="graph-tooltip">
          <div className="graph-tooltip-title">
            {hoveredNode.is_unresolved ? '⚠ ' : ''}
            {hoveredNode.name}
          </div>
          {!hoveredNode.is_unresolved && (
            <div className="graph-tooltip-path">{hoveredNode.relative_path}</div>
          )}
          {hoveredNode.tags.length > 0 && (
            <div className="graph-tooltip-tags">
              {hoveredNode.tags.map((t) => (
                <span key={t} className="graph-tooltip-tag">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {!loading && stats.nodes === 0 && (
        <div className="graph-empty">
          {mode === 'local' && !activeFilePath
            ? 'Ouvre un fichier pour voir son graphe local.'
            : 'Aucun nœud à afficher avec ces filtres.'}
        </div>
      )}
    </div>
  );
}
