"use client";

import { memo } from "react";

type Node = { id: string; label: string; source?: string };
type Edge = { from: string; to: string; type: string };

type Section = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  ratio?: number;           // 0..1 share in the mix
  nodes: Node[];
  edges: Edge[];
  accent?: boolean;
  tint?: string;            // section-specific color
};

type Props = {
  title: string;
  subtitle?: string;
  sections: Section[];
  accent?: boolean;
};

function Chip({
  label,
  sub,
  color,
}: {
  label: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px]"
      style={{
        borderColor: `${color}55`,
        background: "rgba(4,10,22,0.85)",
        color: "#cfe0ff",
        boxShadow: `0 0 4px ${color}33 inset`,
        minHeight: 24,
      }}
      title={label}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 4px ${color}` }}
      />
      <span className="max-w-[140px] truncate">{label}</span>
      {sub && (
        <span
          className="ml-auto text-[8px] font-mono"
          style={{ color: `${color}cc` }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function SectionColumn({ section }: { section: Section }) {
  const color = section.tint || (section.accent ? "#33ff88" : "#00d4ff");
  return (
    <div
      className="flex min-w-[180px] max-w-[260px] flex-shrink-0 flex-col rounded-md border p-2"
      style={{
        borderColor: `${color}40`,
        background: "rgba(2,5,12,0.7)",
      }}
    >
      {/* Section header */}
      <div
        className="mb-1.5 flex items-center justify-between border-b pb-1"
        style={{ borderColor: `${color}30` }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {section.icon && (
            <span className="text-[14px]">{section.icon}</span>
          )}
          <div className="min-w-0">
            <div
              className="truncate text-[10px] font-bold tracking-[0.5px]"
              style={{ color }}
            >
              {section.title}
            </div>
            {section.subtitle && (
              <div
                className="truncate text-[8px]"
                style={{ color: `${color}99` }}
              >
                {section.subtitle}
              </div>
            )}
          </div>
        </div>
        {typeof section.ratio === "number" && (
          <span
            className="shrink-0 rounded-full border px-1.5 py-0 font-mono text-[9px]"
            style={{
              borderColor: `${color}80`,
              color,
              background: `${color}15`,
            }}
          >
            {Math.round(section.ratio * 100)}%
          </span>
        )}
      </div>

      {/* Chips grid */}
      <div className="flex flex-wrap gap-1 overflow-auto">
        {section.nodes.length === 0 ? (
          <div
            className="w-full rounded border border-dashed px-2 py-2 text-center text-[9px]"
            style={{
              borderColor: `${color}40`,
              color: `${color}77`,
            }}
          >
            no parts
          </div>
        ) : (
          section.nodes.map((n) => (
            <Chip
              key={n.id}
              label={n.label}
              sub={n.id.slice(0, 6).toUpperCase()}
              color={color}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BlueprintPanelInner({ title, subtitle, sections, accent }: Props) {
  const accentColor = accent ? "#33ff88" : "#00d4ff";
  const hasAnything = sections.some((s) => s.nodes.length > 0);

  return (
    <div
      className="flex h-full flex-col rounded-md border"
      style={{
        borderColor: `${accentColor}66`,
        background:
          "linear-gradient(135deg, rgba(6,12,26,0.92), rgba(3,7,16,0.88))",
        boxShadow: `0 0 12px ${accentColor}22 inset`,
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-1.5"
        style={{ borderColor: `${accentColor}33` }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[1.5px]"
          style={{
            color: accentColor,
            textShadow: `0 0 6px ${accentColor}55`,
          }}
        >
          ▸ {title}
        </div>
        {subtitle && (
          <div className="text-[9px]" style={{ color: "#5a7090" }}>
            {subtitle}
          </div>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto p-2"
        style={{ background: "rgba(2,5,12,0.6)" }}
      >
        {!hasAnything ? (
          <div
            className="flex h-full items-center justify-center text-[10px]"
            style={{ color: "#3a5a80" }}
          >
            no structural breakdown yet — add items or synthesize
          </div>
        ) : (
          <div className="flex h-full flex-row gap-2">
            {sections.map((s) => (
              <SectionColumn key={s.id} section={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(BlueprintPanelInner);
