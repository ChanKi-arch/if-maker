"use client";

/**
 * Compact blueprint block diagram for a slot item.
 * Renders node boxes + connecting lines from the item's diagram field.
 * Pure SVG, cyan alchemy-lab theme.
 */

type Node = { id: string; label: string };
type Edge = { from: string; to: string; type: string };

export default function BlueprintMini({
  nodes,
  edges,
  accent = false,
}: {
  nodes: Node[];
  edges: Edge[];
  accent?: boolean;
}) {
  if (nodes.length === 0) return null;

  // Simple vertical stack layout — works for any node count.
  const NODE_W = 140;
  const NODE_H = 22;
  const GAP = 10;
  const PAD = 14;

  const height = PAD * 2 + nodes.length * NODE_H + (nodes.length - 1) * GAP;
  const width = NODE_W + PAD * 2 + 8;

  const stroke = accent ? "#33ff88" : "#00d4ff";
  const nodeFill = "rgba(4,14,30,0.85)";
  const labelColor = accent ? "#a7f3d0" : "#8ae0ff";
  const idColor = accent ? "#33ff88aa" : "#5aa0c8";

  // positions for each node
  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n, i) => {
    positions[n.id] = { x: PAD, y: PAD + i * (NODE_H + GAP) };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block" }}
    >
      <defs>
        <marker
          id={`bp-arrow-${accent ? "a" : "d"}`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill={stroke} />
        </marker>
      </defs>

      {/* edges */}
      {edges.map((e, i) => {
        const a = positions[e.from];
        const b = positions[e.to];
        if (!a || !b) return null;
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x + NODE_W;
        const y2 = b.y + NODE_H / 2;
        // draw a short right-side bend
        const midX = x1 + 10;
        return (
          <g key={`e-${i}`}>
            <path
              d={`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`}
              fill="none"
              stroke={stroke}
              strokeWidth={1}
              strokeDasharray="3 2"
              strokeOpacity={0.7}
              markerEnd={`url(#bp-arrow-${accent ? "a" : "d"})`}
            />
          </g>
        );
      })}

      {/* nodes */}
      {nodes.map((n, i) => {
        const p = positions[n.id];
        return (
          <g key={`n-${n.id}-${i}`}>
            <rect
              x={p.x}
              y={p.y}
              width={NODE_W}
              height={NODE_H}
              rx={3}
              fill={nodeFill}
              stroke={stroke}
              strokeWidth={1}
              strokeOpacity={0.8}
            />
            <text
              x={p.x + 6}
              y={p.y + 9}
              fontSize="7"
              fill={idColor}
              fontFamily="ui-monospace, monospace"
              letterSpacing="0.3"
            >
              {n.id.toUpperCase().slice(0, 14)}
            </text>
            <text
              x={p.x + 6}
              y={p.y + 18}
              fontSize="8.5"
              fill={labelColor}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight="500"
            >
              {n.label.slice(0, 22)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
