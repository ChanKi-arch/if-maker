"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Viewport3D from "@/components/Viewport3D";
import BlueprintPanel from "@/components/BlueprintPanel";

/* ========================= Types ========================= */

export type SearchItem = {
  id: string;
  name: string;
  category: string;
  group?: string;
  emoji?: string;
  summary: string;
  tags: string[];
};

export type GroupInfo = {
  group: string;
  category: string;
  count: number;
};

export type ItemDetail = {
  id: string;
  name: string;
  category: string;
  group?: string;
  emoji?: string;
  summary: string;
  tags: string[];
  properties: Record<string, number>;
  structure: { type: string; parts?: string[]; layers?: string[]; form?: string };
  diagram: {
    type: string;
    nodes: { id: string; label: string }[];
    edges: { from: string; to: string; type: string }[];
  };
  uses: string[];
  risks: string[];
};

export type MixResult = {
  experiment_id: string;
  inputs: string[];
  goal: string;
  rule_id: string;
  concept_name: string;
  summary: string;
  combined_properties: Record<string, number>;
  diagram: { nodes: { id: string; label: string }[]; edges: { from: string; to: string; type: string }[] };
  advantages: string[];
  risks: string[];
  use_cases: string[];
  visual?: {
    base_id?: string;
    base_group?: string;
    base_category?: string;
    element_id?: string;
    element_effect?: string;
    intensity?: number;
  };
  source_items: { id: string; name: string; category: string; group?: string; emoji?: string }[];
  analysis?: AnalysisReport;
  invention?: InventionBlock;
};

export type AnalysisReport = {
  narrative: string[];
  composition_notes: Array<{
    source: string;
    category: string;
    ratio: number | null;
    contribution: string;
  }>;
  dominant_traits: Array<{ property: string; value: number; note: string }>;
  weak_points: Array<{ property: string; value: number; note: string }>;
  form_note: string;
  element_note: string | null;
  tradeoffs: string[];
};

export type InventionBlock = {
  signature: string;
  goal_fit: {
    score: number;
    matched_keywords: string[];
    matched_properties: Array<{
      goal_term: string;
      property: string;
      direction: "high" | "low";
      value: number;
      satisfied: boolean;
    }>;
    note?: string;
  };
  novelty: {
    score: number;
    duplicate_of: string | null;
    nearest: string[];
  };
  claim: {
    claim_1: string;
    abstract: string;
    source: "llm" | "fallback";
    elapsed_s?: number;
  } | null;
  prior_art: {
    hit_count: number;
    results: Array<{ title: string }>;
    status: string;
    reason?: string;
    query_url: string;
  };
  logged_at: string | null;
  error?: string;
};

export type ExploreVariant = MixResult & {
  strategy_id: string;
  strategy_label: string;
  strategy_icon: string;
  strategy_description: string;
  strategy_hint: string;
};

export type ExploreResult = {
  goal: string;
  form_mode: string;
  ratios: number[];
  inputs: string[];
  variants: ExploreVariant[];
  strategy_source?: "llm" | "static";
};

export type DecomposeResult = {
  concept_name: string;
  confidence: string;
  components: { id: string; name: string; category: string; group?: string; summary: string }[];
};

type FocusTarget =
  | { kind: "material"; id: string; data: ItemDetail }
  | { kind: "concept"; emoji: string; name: string; summary: string; data?: MixResult }
  | { kind: "phantom"; name: string; emoji: string }
  | null;

type LogKind = "ok" | "info" | "warn" | "err";
type LogLine = { ts: string; kind: LogKind; msg: string };

type Toast = {
  id: number;
  kind: LogKind;
  title: string;
  detail?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const INITIAL_SLOTS = 2;
const MAX_SLOTS = 8;

const STORAGE_KEYS = {
  created: "ifmaker:created",
  slots: "ifmaker:slots",
  goal: "ifmaker:goal",
  tab: "ifmaker:tab",
  focus: "ifmaker:focus",
} as const;

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or serialization — silently ignore
  }
}

/* ========================= Page ========================= */

export default function HomePage() {
  const [items, setItems] = useState<SearchItem[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [slots, setSlots] = useState<Array<string | null>>(() =>
    loadJSON<Array<string | null>>(STORAGE_KEYS.slots, Array(INITIAL_SLOTS).fill(null))
  );
  const [ratios, setRatios] = useState<number[]>(() =>
    loadJSON<number[]>("ifmaker:ratios", Array(INITIAL_SLOTS).fill(1))
  );
  const [formMode, setFormMode] = useState<string>(() =>
    loadJSON<string>("ifmaker:formMode", "solid")
  );
  const [goal, setGoal] = useState<string>(() =>
    loadJSON<string>(STORAGE_KEYS.goal, "")
  );
  const [leftTab, setLeftTab] = useState<"library" | "created">(() =>
    loadJSON<"library" | "created">(STORAGE_KEYS.tab, "library")
  );
  const [createdConcepts, setCreatedConcepts] = useState<MixResult[]>(() =>
    loadJSON<MixResult[]>(STORAGE_KEYS.created, [])
  );

  const [focus, setFocus] = useState<FocusTarget>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, ItemDetail>>({});

  const [logs, setLogs] = useState<LogLine[]>([
    { ts: tsNow(), kind: "info", msg: "imagination engine online" },
  ]);
  const [ops, setOps] = useState(0);
  const [latency, setLatency] = useState("1.8");
  const [llmStatus, setLlmStatus] = useState<{ enabled: boolean; model?: string }>(
    { enabled: false }
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exploreResult, setExploreResult] = useState<ExploreResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const [mixResult, setMixResult] = useState<MixResult | null>(null);
  const [decomposeResult, setDecomposeResult] =
    useState<DecomposeResult | null>(null);

  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const itemById = useMemo(() => {
    const map: Record<string, SearchItem> = {};
    for (const it of items) map[it.id] = it;
    return map;
  }, [items]);

  const filledSlots = slots.filter(Boolean).length;

  function tsNow() {
    const d = new Date();
    return d.toLocaleTimeString("ko-KR", { hour12: false });
  }

  function log(kind: LogKind, msg: string) {
    setLogs((prev) =>
      [...prev, { ts: tsNow(), kind, msg }].slice(-80)
    );
    // Also surface err/warn as toasts so users notice
    if (kind === "err" || kind === "warn") {
      pushToast(kind, msg);
    }
  }

  function pushToast(kind: LogKind, title: string, detail?: string) {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, kind, title, detail }].slice(-4));
    // Auto-dismiss after 4 seconds
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function showFlash(emoji: string) {
    setFlash(emoji);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 700);
  }

  /* ---------------- API ---------------- */

  const fetchItems = useCallback(async (q: string, group: string | null) => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (group) params.set("group", group);
      const r = await fetch(`${API_BASE}/items/search?${params}`);
      const data = await r.json();
      setItems(data.items || []);
    } catch (e) {
      log("err", "library load failed");
    }
  }, []);

  const fetchDetail = useCallback(
    async (id: string): Promise<ItemDetail | null> => {
      if (detailsCache[id]) return detailsCache[id];
      try {
        const r = await fetch(`${API_BASE}/items/${id}`);
        if (!r.ok) throw new Error();
        const data: ItemDetail = await r.json();
        setDetailsCache((prev) => ({ ...prev, [id]: data }));
        return data;
      } catch {
        log("err", `detail fetch failed: ${id}`);
        return null;
      }
    },
    [detailsCache]
  );

  const createItem = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const r = await fetch(`${API_BASE}/items/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!r.ok) throw new Error();
        const item = await r.json();
        // Refresh library + groups so the new item and its group show up
        await fetchItems("", activeGroup);
        fetch(`${API_BASE}/items/groups`)
          .then((r) => r.json())
          .then((d) => setGroups(d.groups || []))
          .catch(() => {});
        const detail = await fetchDetail(item.id);
        if (detail) {
          setFocus({ kind: "material", id: item.id, data: detail });
        }
        setQuery("");
        log("ok", `created: ${item.name} (${item.group})`);
        showFlash(item.emoji || "◇");
      } catch {
        log("err", `create failed: ${trimmed}`);
      }
    },
    [fetchItems, fetchDetail, activeGroup]
  );

  useEffect(() => {
    fetch(`${API_BASE}/items/groups`)
      .then((r) => r.json())
      .then((d) => setGroups(d.groups || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchItems("", null);
  }, [fetchItems]);

  useEffect(() => {
    const t = setTimeout(() => fetchItems(query, activeGroup), 250);
    return () => clearTimeout(t);
  }, [query, activeGroup, fetchItems]);

  useEffect(() => {
    const t = setInterval(() => {
      setLatency((1.5 + Math.random() * 0.8).toFixed(1));
    }, 2500);
    return () => clearInterval(t);
  }, []);

  // Persist state to localStorage whenever it changes.
  useEffect(() => saveJSON(STORAGE_KEYS.created, createdConcepts), [createdConcepts]);
  useEffect(() => saveJSON(STORAGE_KEYS.slots, slots), [slots]);
  useEffect(() => saveJSON("ifmaker:ratios", ratios), [ratios]);
  useEffect(() => saveJSON("ifmaker:formMode", formMode), [formMode]);
  useEffect(() => saveJSON(STORAGE_KEYS.goal, goal), [goal]);
  useEffect(() => saveJSON(STORAGE_KEYS.tab, leftTab), [leftTab]);

  // Keep ratios in sync with slots length (fill new slots with 1.0)
  useEffect(() => {
    setRatios((prev) => {
      if (prev.length === slots.length) return prev;
      const next = slots.map((_, i) => (prev[i] !== undefined ? prev[i] : 1));
      return next;
    });
  }, [slots.length]);

  // Re-register any previously-created concepts with the backend so that
  // after a page refresh, their experiment_ids are still valid for remix /
  // export / share. Best-effort, swallows errors.
  useEffect(() => {
    const restored = loadJSON<MixResult[]>(STORAGE_KEYS.created, []);
    if (!restored.length) return;
    (async () => {
      for (const c of restored) {
        if (!c.inputs || c.inputs.length < 2) continue;
        try {
          await fetch(`${API_BASE}/mix/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item_ids: c.inputs,
              goal: c.goal || "",
              enhance: false,
            }),
          });
        } catch {
          // ignore — will be regenerated on user action
        }
      }
      // Refresh library so re-registered synthesized items show up
      fetchItems("", null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/mix/llm-status`)
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => {
        setLlmStatus({ enabled: Boolean(d.enabled), model: d.model });
        if (d.enabled) {
          log("ok", `LLM online: ${d.model}`);
        }
      })
      .catch(() => {});
  }, []);

  // Load shared concept from URL ?c=<experiment_id>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get("c");
    if (!sharedId) return;
    // Backend auto-registers synthesis results; fetch detail and focus
    fetch(`${API_BASE}/items/${sharedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) {
          log("warn", `공유 링크의 아이템을 찾을 수 없음: ${sharedId}`);
          return;
        }
        if (data.category === "synthesized") {
          // Rebuild a MixResult-ish object from the stored item
          const pseudo: MixResult = {
            experiment_id: data.id,
            inputs: (data.source_items || []).map((s: any) => s.id),
            goal: "",
            rule_id: "shared",
            concept_name: data.name,
            summary: data.summary,
            combined_properties: data.properties || {},
            diagram: data.diagram || { nodes: [], edges: [] },
            advantages: [],
            risks: data.risks || [],
            use_cases: data.uses || [],
            source_items: data.source_items || [],
            visual: data.visual || undefined,
          };
          setMixResult(pseudo);
          setFocus({
            kind: "concept",
            emoji: "⚗️",
            name: data.name,
            summary: data.summary,
            data: pseudo,
          });
          setCreatedConcepts((prev) =>
            prev.some((p) => p.experiment_id === pseudo.experiment_id)
              ? prev
              : [pseudo, ...prev].slice(0, 40)
          );
          log("ok", `shared load: ${data.name}`);
        } else {
          setFocus({ kind: "material", id: data.id, data });
          log("ok", `shared load: ${data.name}`);
        }
      })
      .catch(() => {});
  }, []);

  /* ---------------- Actions ---------------- */

  async function selectItem(id: string) {
    const item = itemById[id];
    const detail = await fetchDetail(id);
    if (detail) {
      setFocus({ kind: "material", id, data: detail });
      log("info", `library: ${item?.name || id} 선택`);
    }
  }

  async function addToSlot(id: string, slotIdx?: number) {
    const item = itemById[id];
    if (!item) return;

    // Prefetch detail early (before state updates) so the viewport grid
    // has the data as soon as the slot appears.
    fetchDetail(id);

    // Auto-grow: fill first empty slot, else append a new one
    setSlots((prev) => {
      const next = [...prev];
      if (typeof slotIdx === "number") {
        next[slotIdx] = id;
        return next;
      }
      const emptyIdx = next.findIndex((s) => s === null);
      if (emptyIdx !== -1) {
        next[emptyIdx] = id;
        return next;
      }
      if (next.length < MAX_SLOTS) {
        next.push(id);
        return next;
      }
      log("warn", `슬롯이 가득 찼습니다 (max ${MAX_SLOTS})`);
      return prev;
    });
    // Clear any previous concept result when new slot is filled
    setMixResult(null);
    setFocus(null);
    setOps((n) => n + 1);
    log("ok", `slot ← ${item.name}`);
    showFlash(item.emoji || "◆");
  }

  function clearSlot(idx: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
    log("warn", `slot ${idx + 1} 비움`);
  }

  function clearAllSlots() {
    setSlots(Array(INITIAL_SLOTS).fill(null));
    setRatios(Array(INITIAL_SLOTS).fill(1));
    log("info", "슬롯 전체 초기화");
  }

  function resetRatios() {
    setRatios(Array(slots.length).fill(1));
    log("info", "ratios reset (equal)");
  }

  function currentExportIds(): string[] {
    // Priority: focused concept → filled slots → preview focus
    if (focus?.kind === "concept" && focus.data) {
      return [focus.data.experiment_id];
    }
    const filled = slots.filter((s): s is string => !!s);
    if (filled.length > 0) return filled;
    if (focus?.kind === "material") return [focus.id];
    return [];
  }

  async function exportAs(format: "unity" | "json" | "csv") {
    const ids = currentExportIds();
    if (ids.length === 0) {
      log("warn", "export: 내보낼 아이템 없음");
      return;
    }
    setExportOpen(false);
    try {
      const res = await fetch(`${API_BASE}/export/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_ids: ids, format, download: true }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "csv" ? "csv" : "json";
      const firstId = ids[0].replace(/[^a-z0-9]+/gi, "_");
      a.download = `ifmaker_${firstId}_${format}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      log("ok", `export: ${format} (${ids.length} items)`);
      showFlash("📦");
    } catch {
      log("err", "export 실패");
    }
  }

  async function shareCurrent() {
    const ids = currentExportIds();
    if (ids.length === 0) {
      log("warn", "share: 공유할 대상 없음");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?c=${encodeURIComponent(
      ids[0]
    )}`;
    try {
      await navigator.clipboard.writeText(url);
      log("ok", `링크 복사됨: ${ids[0]}`);
      showFlash("🔗");
    } catch {
      log("err", "클립보드 접근 실패");
    }
  }

  function addSlot() {
    setSlots((prev) => {
      if (prev.length >= MAX_SLOTS) {
        log("warn", `max ${MAX_SLOTS} slots`);
        return prev;
      }
      return [...prev, null];
    });
  }

  function removeEmptySlot() {
    setSlots((prev) => {
      if (prev.length <= INITIAL_SLOTS) return prev;
      // remove the last empty slot
      const idx = [...prev].reverse().findIndex((s) => s === null);
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const next = [...prev];
      next.splice(realIdx, 1);
      return next;
    });
  }

  async function synthesize() {
    const filled = slots.filter((s): s is string => !!s);
    if (filled.length < 2) {
      log("err", "합성: 최소 2개 슬롯 필요");
      showFlash("⚠");
      return;
    }
    setOps((n) => n + 1);
    try {
      // Build ratios for filled slots only (skip empty slot positions)
      const filledRatios: number[] = [];
      slots.forEach((s, i) => {
        if (s) filledRatios.push(ratios[i] ?? 1);
      });

      const r = await fetch(`${API_BASE}/mix/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_ids: filled,
          goal,
          enhance: llmStatus.enabled,
          ratios: filledRatios,
          form_mode: formMode,
        }),
      });
      if (!r.ok) throw new Error();
      const data: MixResult = await r.json();
      setMixResult(data);
      setDecomposeResult(null);
      // Refresh library + groups so the newly registered synthesis item
      // shows up in search/filter and can be re-used in further mixes.
      fetchItems(query, activeGroup);
      fetch(`${API_BASE}/items/groups`)
        .then((r) => r.json())
        .then((d) => setGroups(d.groups || []))
        .catch(() => {});
      // add to created library (dedup by experiment_id)
      setCreatedConcepts((prev) => {
        if (prev.some((p) => p.experiment_id === data.experiment_id)) {
          return prev;
        }
        return [data, ...prev].slice(0, 40);
      });
      setFocus({
        kind: "concept",
        emoji: "⚗️",
        name: data.concept_name,
        summary: data.summary,
        data,
      });
      // clear slots after successful synthesis
      setSlots(Array(INITIAL_SLOTS).fill(null));
      log(
        "ok",
        `SYN → ${data.concept_name}  [${data.source_items
          .map((s) => s.name)
          .join(" + ")}]`
      );
      showFlash("⚗️");
    } catch {
      log("err", "합성 실패");
      showFlash("⚠");
    }
  }

  async function exploreSynthesize() {
    const filled = slots.filter((s): s is string => !!s);
    if (filled.length < 2) {
      log("err", "explore: 최소 2개 슬롯 필요");
      return;
    }
    const filledRatios: number[] = [];
    slots.forEach((s, i) => {
      if (s) filledRatios.push(ratios[i] ?? 1);
    });
    setOps((n) => n + 1);
    try {
      const r = await fetch(`${API_BASE}/mix/explore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_ids: filled,
          goal,
          ratios: filledRatios,
          form_mode: formMode,
        }),
      });
      if (!r.ok) throw new Error();
      const data: ExploreResult = await r.json();
      setExploreResult(data);
      setMixResult(null);
      setFocus(null);
      log("ok", `explore: ${data.variants.length} variants`);
      showFlash("🎲");
    } catch {
      log("err", "explore 실패");
    }
  }

  function commitVariant(v: ExploreVariant) {
    setMixResult(v);
    setFocus({
      kind: "concept",
      emoji: v.strategy_icon || "⚗️",
      name: v.concept_name,
      summary: v.summary,
      data: v,
    });
    setCreatedConcepts((prev) => {
      if (prev.some((p) => p.experiment_id === v.experiment_id)) return prev;
      return [v, ...prev].slice(0, 40);
    });
    setExploreResult(null);
    setSlots(Array(INITIAL_SLOTS).fill(null));
    setRatios(Array(INITIAL_SLOTS).fill(1));
    // Refresh library + groups: committed variants register as first-class
    // items and may introduce new synthesis_* groups.
    fetchItems(query, activeGroup);
    fetch(`${API_BASE}/items/groups`)
      .then((r) => r.json())
      .then((d) => setGroups(d.groups || []))
      .catch(() => {});
    log("ok", `committed: ${v.concept_name} (${v.strategy_label})`);
    showFlash(v.strategy_icon || "⚗️");
  }

  async function decompose() {
    // Prefer decomposing the currently focused concept, else the latest mix.
    const targetConcept =
      focus && focus.kind === "concept" && focus.data
        ? focus.data
        : mixResult;

    setOps((n) => n + 1);

    // Exact inverse: if we already have the source items from the synthesis,
    // put them straight back into slots. This matches user expectation that
    // synthesize and decompose are inverses.
    if (targetConcept && targetConcept.source_items?.length) {
      const sources = targetConcept.source_items;
      const n = Math.min(sources.length, MAX_SLOTS);
      const newSlots: Array<string | null> = Array(
        Math.max(n, INITIAL_SLOTS)
      ).fill(null);
      sources.slice(0, n).forEach((s, i) => {
        newSlots[i] = s.id;
      });
      setSlots(newSlots);
      sources.forEach((s) => fetchDetail(s.id));

      const invResult: DecomposeResult = {
        concept_name: targetConcept.concept_name,
        confidence: "high",
        components: sources.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          group: s.group,
          summary: "",
        })),
      };
      setDecomposeResult(invResult);
      setMixResult(null);
      setFocus(null);
      log(
        "ok",
        `DEC ← ${targetConcept.concept_name}  →  [${sources
          .map((s) => s.name)
          .join(", ")}]`
      );
      showFlash("🔬");
      return;
    }

    // Fallback: heuristic decompose for arbitrary concept names
    const target =
      focus && focus.kind === "concept"
        ? focus.name
        : mixResult?.concept_name || "";
    if (!target) {
      log("err", "분해: 현재 focus가 합성물이 아닙니다");
      showFlash("⚠");
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/mix/decompose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept_name: target, goal }),
      });
      if (!r.ok) throw new Error();
      const data: DecomposeResult = await r.json();
      setDecomposeResult(data);
      const n = Math.min(data.components.length, MAX_SLOTS);
      const newSlots: Array<string | null> = Array(
        Math.max(n, INITIAL_SLOTS)
      ).fill(null);
      data.components.slice(0, n).forEach((c, i) => {
        newSlots[i] = c.id;
      });
      setSlots(newSlots);
      data.components.forEach((c) => fetchDetail(c.id));
      setMixResult(null);
      setFocus(null);
      log(
        "ok",
        `DEC ← ${target}  →  [${data.components.map((c) => c.name).join(", ")}] (heuristic)`
      );
      showFlash("🔬");
    } catch {
      log("err", "분해 실패");
      showFlash("⚠");
    }
  }

  /* ---------------- Drag/Drop ---------------- */

  function onDragStartLib(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "copy";
  }

  function onDropSlot(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) addToSlot(id, idx);
  }

  /* ---------------- Render ---------------- */

  const focusedEmoji =
    focus?.kind === "material"
      ? focus.data.emoji || "◆"
      : focus?.kind === "concept"
      ? focus.emoji
      : focus?.kind === "phantom"
      ? focus.emoji
      : "◎";

  const focusedName =
    focus?.kind === "material"
      ? focus.data.name
      : focus?.kind === "concept"
      ? focus.name
      : focus?.kind === "phantom"
      ? focus.name
      : "—";

  const focusedSummary =
    focus?.kind === "material"
      ? focus.data.summary
      : focus?.kind === "concept"
      ? focus.summary
      : focus?.kind === "phantom"
      ? "unregistered — phantom state"
      : "좌측 라이브러리에서 재료를 선택하거나, 슬롯에 넣고 합성하세요";

  const focusMeta =
    focus?.kind === "material"
      ? `type: material  /  group: ${focus.data.group || "—"}`
      : focus?.kind === "concept" && focus.data
      ? `type: synthesized  /  rule: ${focus.data.rule_id}`
      : focus?.kind === "phantom"
      ? "type: phantom"
      : "type: idle";

  const state =
    filledSlots === 0 ? "IDLE" : filledSlots >= 2 ? "READY" : "PARTIAL";
  const resonance = filledSlots === 0 ? "—" : (filledSlots * 0.25).toFixed(2);

  return (
    <>
      <div className="stars" />

      <div
        className="relative z-[1] flex h-screen flex-col gap-2.5 p-2.5"
        style={{ gridTemplateRows: "52px 1fr 36px" }}
      >
        {/* ========== HEADER ========== */}
        <header className="panel flex h-[52px] items-center gap-5 px-5">
          <h1 className="text-[14px] font-bold tracking-[3px] cyan-glow" style={{ color: "#00d4ff" }}>
            ⚛ IF MAKER — ALCHEMY LAB
          </h1>
          <div className="text-[9px] tracking-[2px]" style={{ color: "#4a5a78" }}>
            VIRTUAL MATERIAL SIMULATOR / V0
          </div>
          <div className="ml-auto flex items-center gap-4">
            <Stat label="MATERIALS" value={String(items.length)} />
            <Stat label="SLOTS" value={`${filledSlots}/${slots.length}`} />
            <Stat label="OPS" value={String(ops)} />
            <Stat label="LAT" value={`${latency}ms`} />
            <div
              className="rounded-full border px-2.5 py-0.5 text-[9px] font-bold tracking-[1.2px]"
              style={{
                borderColor: llmStatus.enabled
                  ? "rgba(51,255,136,0.6)"
                  : "rgba(80,90,110,0.4)",
                background: llmStatus.enabled
                  ? "rgba(4,30,14,0.7)"
                  : "rgba(10,14,26,0.6)",
                color: llmStatus.enabled ? "#33ff88" : "#5a6a80",
                textShadow: llmStatus.enabled
                  ? "0 0 6px rgba(51,255,136,0.4)"
                  : "none",
              }}
              title={
                llmStatus.enabled
                  ? `LLM online: ${llmStatus.model || ""}`
                  : "LLM offline (heuristic mode)"
              }
            >
              {llmStatus.enabled ? "◉ sLLM" : "○ sLLM"}
            </div>
          </div>
        </header>

        {/* ========== MAIN ========== */}
        <main
          className="grid min-h-0 flex-1 gap-2.5"
          style={{ gridTemplateColumns: "260px 1fr 300px" }}
        >
          {/* ---------- LEFT ---------- */}
          <aside className="panel flex min-h-0 flex-col p-3.5">
            {/* tabs */}
            <div className="mb-2.5 flex gap-1 border-b pb-1.5" style={{ borderColor: "rgba(40,80,140,0.4)" }}>
              <button
                onClick={() => setLeftTab("library")}
                className="flex-1 rounded-t px-2 py-1.5 text-[10px] font-bold tracking-[1.2px] transition"
                style={{
                  background:
                    leftTab === "library" ? "rgba(0,80,160,0.3)" : "transparent",
                  color: leftTab === "library" ? "#00d4ff" : "#4a6a90",
                  textShadow:
                    leftTab === "library"
                      ? "0 0 8px rgba(0,212,255,0.4)"
                      : "none",
                }}
              >
                ◆ LIBRARY
              </button>
              <button
                onClick={() => setLeftTab("created")}
                className="flex-1 rounded-t px-2 py-1.5 text-[10px] font-bold tracking-[1.2px] transition"
                style={{
                  background:
                    leftTab === "created" ? "rgba(0,120,60,0.3)" : "transparent",
                  color: leftTab === "created" ? "#33ff88" : "#4a6a90",
                  textShadow:
                    leftTab === "created"
                      ? "0 0 8px rgba(51,255,136,0.4)"
                      : "none",
                }}
              >
                ⟡ CREATED
                {createdConcepts.length > 0 && (
                  <span className="ml-1 rounded-full px-1 text-[9px]" style={{ background: "rgba(51,255,136,0.25)" }}>
                    {createdConcepts.length}
                  </span>
                )}
              </button>
            </div>

            {leftTab === "library" ? (
              <LibraryView
                query={query}
                setQuery={setQuery}
                groups={groups}
                activeGroup={activeGroup}
                setActiveGroup={setActiveGroup}
                items={items}
                slots={slots}
                focus={focus}
                onSelect={selectItem}
                onAdd={addToSlot}
                onDragStart={onDragStartLib}
                onCreate={createItem}
              />
            ) : (
              <CreatedView
                concepts={createdConcepts}
                focus={focus}
                onSelect={(c) => {
                  setFocus({
                    kind: "concept",
                    emoji: "⚗️",
                    name: c.concept_name,
                    summary: c.summary,
                    data: c,
                  });
                  setMixResult(c);
                  log("info", `created: ${c.concept_name}`);
                }}
                onAddToSlot={(c) => {
                  // use experiment_id as the item id — backend registered it
                  addToSlot(c.experiment_id);
                }}
                onClear={() => {
                  setCreatedConcepts([]);
                  log("warn", "created list cleared");
                }}
              />
            )}
          </aside>

          {/* ---------- CENTER ---------- */}
          <section className="flex min-h-0 flex-col gap-2.5">
            {/* Input bar */}
            <div className="panel flex items-center gap-3 px-4 py-3">
              <span
                className="text-[10px] font-bold tracking-[1.5px] cyan-glow"
                style={{ color: "#00d4ff" }}
              >
                A ▸ GOAL
              </span>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="목표를 입력하세요 (예: impact absorption, lightweight grip ...)"
                className="flex-1 rounded-md border px-3 py-2 text-[12px] outline-none"
                style={{
                  background: "rgba(2,6,14,0.8)",
                  borderColor: "rgba(40,80,140,0.6)",
                  color: "#b8e0ff",
                }}
              />
              <FormModeSelector value={formMode} onChange={setFormMode} />
              <button
                onClick={synthesize}
                className="rounded-md px-4 py-2 text-[11px] font-bold tracking-[1.2px] transition"
                style={{
                  background: "linear-gradient(135deg, #00a8d4, #00d4ff)",
                  color: "#020810",
                }}
              >
                ▸ 생성
              </button>
            </div>

            {/* Viewport */}
            <div
              className="panel relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(0,40,80,0.35) 0%, rgba(2,6,14,0.9) 70%), linear-gradient(135deg, rgba(6,14,30,0.95), rgba(2,6,16,0.95))",
                boxShadow: "0 0 40px rgba(0,80,160,0.15) inset",
              }}
            >
              {/* grid floor */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(0,150,220,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,150,220,0.07) 1px, transparent 1px)",
                  backgroundSize: "40px 40px",
                  maskImage:
                    "radial-gradient(ellipse at center, black 30%, transparent 80%)",
                  WebkitMaskImage:
                    "radial-gradient(ellipse at center, black 30%, transparent 80%)",
                }}
              />

              {/* status badge */}
              <div
                className="absolute right-3.5 top-3.5 text-[9px] tracking-[1px]"
                style={{ color: "#4a6a90" }}
              >
                <span
                  className="blink-anim mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                  style={{
                    background: "#33ff88",
                    boxShadow: "0 0 8px #33ff88",
                  }}
                />
                IMAGINATION ACTIVE
              </div>

              {/* 3D viewport — explore variants > concept > slot grid */}
              {exploreResult ? (
                <ExploreGrid
                  result={exploreResult}
                  onCommit={commitVariant}
                  onCancel={() => setExploreResult(null)}
                />
              ) : focus?.kind === "concept" ? (
                <ConceptView
                  concept={focus.data!}
                  visual={focus.data?.visual}
                />
              ) : (
                <>
                  <SlotGrid
                    slots={slots}
                    itemById={itemById}
                    detailsCache={detailsCache}
                    previewFocus={
                      focus?.kind === "material" ? focus.data : null
                    }
                  />
                  {(() => {
                    // Per-item analysis overlay for slot / preview state.
                    // Priority: hovered material > latest filled slot.
                    let detail: ItemDetail | null = null;
                    let label = "ITEM ANALYSIS";
                    if (focus?.kind === "material") {
                      detail = focus.data;
                      label = "PREVIEW";
                    } else {
                      const lastFilledRevIdx = [...slots]
                        .reverse()
                        .findIndex((s) => !!s);
                      if (lastFilledRevIdx !== -1) {
                        const idx = slots.length - 1 - lastFilledRevIdx;
                        const id = slots[idx];
                        if (id && detailsCache[id]) {
                          detail = detailsCache[id];
                          label = `SLOT S-${idx + 1}`;
                        }
                      }
                    }
                    if (!detail) return null;
                    return (
                      <ItemAnalysisPanel detail={detail} label={label} />
                    );
                  })()}
                  {decomposeResult && (
                    <DecomposeReportPanel
                      result={decomposeResult}
                      itemById={itemById}
                    />
                  )}
                </>
              )}

              {/* Concentric decorative rings above the 3D scene */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={{ perspective: 900 }}
              >
                <div
                  className="orbit-1 absolute rounded-full border border-dashed"
                  style={{
                    width: 340,
                    height: 340,
                    borderColor: "rgba(0,212,255,0.2)",
                  }}
                />
                <div
                  className="orbit-2 absolute rounded-full border border-dashed"
                  style={{
                    width: 380,
                    height: 380,
                    borderColor: "rgba(0,180,255,0.14)",
                  }}
                />
              </div>

              {/* object info overlay — hidden for concept focus (ConceptView handles it) */}
              {focus?.kind !== "concept" && (
              <div
                className="absolute bottom-4 left-4 max-h-[60%] max-w-[380px] overflow-y-auto rounded-md border px-3.5 py-2.5"
                style={{
                  background: "rgba(2,6,14,0.9)",
                  borderColor: "rgba(40,80,140,0.5)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <div
                  className="text-[12px] font-bold tracking-[1.5px] cyan-glow"
                  style={{ color: "#00d4ff" }}
                >
                  {focusedName}
                </div>
                <div
                  className="mt-0.5 text-[9px]"
                  style={{ color: "#6a8ab0" }}
                >
                  {focusMeta}
                </div>
                <div
                  className="mt-1 text-[10px] leading-snug"
                  style={{ color: "#8aa8c8" }}
                >
                  {focusedSummary}
                </div>

                {focus?.kind === "material" && focus.data && (
                  <>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {focus.data.tags.slice(0, 5).map((t) => (
                        <span
                          key={t}
                          className="rounded-full border px-1.5 py-0 text-[8px]"
                          style={{
                            borderColor: "rgba(40,80,140,0.5)",
                            color: "#5a7090",
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    {Object.keys(focus.data.properties).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {Object.entries(focus.data.properties)
                          .slice(0, 6)
                          .map(([k, v]) => (
                            <div key={k}>
                              <div className="flex justify-between text-[8px]" style={{ color: "#5a7090" }}>
                                <span>{k.replace(/_/g, " ")}</span>
                                <span>{v}</span>
                              </div>
                              <div className="h-[3px] rounded-full" style={{ background: "rgba(4,10,24,0.8)" }}>
                                <div
                                  className="h-[3px] rounded-full"
                                  style={{
                                    width: `${Math.min(Number(v) * 10, 100)}%`,
                                    background: "#00d4ff",
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}

              </div>
              )}
            </div>

            {/* Analysis strip — quick info for the currently focused item */}
            <AnalysisStrip
              focus={focus}
              slots={slots}
              ratios={ratios}
              itemById={itemById}
              detailsCache={detailsCache}
            />

            {/* Blueprint panel (bottom, dedicated) */}
            <div className="h-[200px] shrink-0">
              <BlueprintPanel
                title={
                  focus?.kind === "concept"
                    ? "MERGED BLUEPRINT"
                    : filledSlots > 0
                    ? "SLOT BREAKDOWN"
                    : focus?.kind === "material"
                    ? "STRUCTURE"
                    : "BLUEPRINT"
                }
                subtitle={
                  focus?.kind === "concept" && focus.data
                    ? `${focus.data.diagram?.nodes?.length ?? 0} parts · ${focus.data.diagram?.edges?.length ?? 0} bonds`
                    : undefined
                }
                sections={buildBlueprintSections({
                  focus,
                  slots,
                  ratios,
                  itemById,
                  detailsCache,
                })}
                accent={focus?.kind === "concept"}
              />
            </div>

            {/* Action buttons */}
            <div
              className="relative flex gap-2 rounded-md border p-2.5"
              style={{
                background:
                  "linear-gradient(135deg, rgba(6,12,26,0.92), rgba(3,7,16,0.88))",
                borderColor: "rgba(40,80,140,0.5)",
              }}
            >
              <ActButton
                onClick={synthesize}
                label="⟡ SYNTHESIZE"
                hoverBorder="#33ff88"
                hoverShadow="rgba(51,255,136,0.35)"
                hoverText="#80ffb0"
              />
              <ActButton
                onClick={exploreSynthesize}
                label="🎲 EXPLORE"
                hoverBorder="#a855f7"
                hoverShadow="rgba(168,85,247,0.35)"
                hoverText="#e0c8ff"
              />
              <ActButton
                onClick={decompose}
                label="⟠ DECOMPOSE"
                hoverBorder="#ff9944"
                hoverShadow="rgba(255,153,68,0.35)"
                hoverText="#ffcc88"
              />
              <ActButton
                onClick={shareCurrent}
                label="🔗 SHARE"
                hoverBorder="#00d4ff"
                hoverShadow="rgba(0,212,255,0.35)"
                hoverText="#aaeeff"
              />
              <div className="relative flex-1">
                <button
                  onClick={() => setExportOpen((v) => !v)}
                  className="h-full w-full rounded-md border px-3 py-3 text-[11px] font-bold tracking-[1.5px] transition"
                  style={{
                    background: "rgba(8,16,32,0.8)",
                    borderColor: exportOpen
                      ? "#a855f7"
                      : "rgba(40,80,140,0.6)",
                    color: exportOpen ? "#e0c8ff" : "#8acfff",
                    boxShadow: exportOpen
                      ? "0 0 18px rgba(168,85,247,0.35)"
                      : "none",
                  }}
                >
                  📦 EXPORT
                </button>
                {exportOpen && (
                  <div
                    className="absolute bottom-full right-0 z-50 mb-1 min-w-[180px] rounded-md border p-1"
                    style={{
                      background: "rgba(10,14,26,0.98)",
                      borderColor: "rgba(168,85,247,0.5)",
                      boxShadow: "0 0 20px rgba(168,85,247,0.25)",
                    }}
                  >
                    <ExportItem
                      onClick={() => exportAs("unity")}
                      icon="🎮"
                      label="Unity ScriptableObject"
                      sub=".json · engine-ready"
                    />
                    <ExportItem
                      onClick={() => exportAs("json")}
                      icon="⎘"
                      label="Generic JSON"
                      sub=".json · full schema"
                    />
                    <ExportItem
                      onClick={() => exportAs("csv")}
                      icon="▤"
                      label="CSV Spreadsheet"
                      sub=".csv · flat rows"
                    />
                  </div>
                )}
              </div>
              <ActButton
                onClick={clearAllSlots}
                label="✕ RESET"
                hoverBorder="#ff5566"
                hoverShadow="rgba(255,85,102,0.35)"
                hoverText="#ffaabb"
              />
            </div>
          </section>

          {/* ---------- RIGHT ---------- */}
          <aside className="panel flex min-h-0 flex-col p-3.5">
            <div
              className="mb-2.5 flex items-center justify-between border-b pb-1.5"
              style={{ borderColor: "rgba(40,80,140,0.4)" }}
            >
              <h3
                className="text-[10px] font-bold tracking-[1.8px] cyan-glow"
                style={{ color: "#00d4ff" }}
              >
                ◆ B ▸ SLOTS
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={resetRatios}
                  className="rounded border px-1.5 py-0.5 text-[8px] font-bold transition hover:bg-cyan-900/30"
                  style={{
                    borderColor: "rgba(0,212,255,0.5)",
                    color: "#8acfff",
                    background: "rgba(4,10,24,0.5)",
                  }}
                  title="Reset ratios to equal"
                >
                  ⟲ %
                </button>
                <button
                  onClick={removeEmptySlot}
                  disabled={slots.length <= INITIAL_SLOTS}
                  className="flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold transition disabled:opacity-25"
                  style={{
                    borderColor: "rgba(40,80,140,0.6)",
                    color: "#8acfff",
                    background: "rgba(4,10,24,0.7)",
                  }}
                  title="Remove empty slot"
                >
                  −
                </button>
                <span
                  className="min-w-[30px] text-center font-mono text-[9px]"
                  style={{ color: "#8acfff" }}
                >
                  {filledSlots}/{slots.length}
                </span>
                <button
                  onClick={addSlot}
                  disabled={slots.length >= MAX_SLOTS}
                  className="flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold transition disabled:opacity-25"
                  style={{
                    borderColor: "rgba(0,212,255,0.7)",
                    color: "#00d4ff",
                    background: "rgba(0,80,160,0.35)",
                    boxShadow: "0 0 6px rgba(0,212,255,0.3)",
                  }}
                  title="Add slot"
                >
                  +
                </button>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2.5">
              {slots.map((slotId, i) => {
                // Compute percentage over filled slots (empty slots don't count)
                const filledTotal = slots.reduce(
                  (acc, s, idx) => (s ? acc + (ratios[idx] ?? 1) : acc),
                  0
                );
                const rawRatio = ratios[i] ?? 1;
                const pct =
                  slotId && filledTotal > 0
                    ? Math.round((rawRatio / filledTotal) * 100)
                    : 0;
                return (
                  <Slot
                    key={i}
                    idx={i}
                    item={slotId ? itemById[slotId] : null}
                    detail={slotId ? detailsCache[slotId] : null}
                    ratio={rawRatio}
                    ratioPercent={pct}
                    onClear={() => clearSlot(i)}
                    onDrop={(e) => onDropSlot(e, i)}
                    onRatioChange={(v) => {
                      setRatios((prev) => {
                        const next = [...prev];
                        next[i] = v;
                        return next;
                      });
                    }}
                  />
                );
              })}
            </div>

            {/* Status card */}
            <div
              className="mb-2 rounded-md border px-3 py-2.5 text-[9px]"
              style={{
                background: "rgba(4,10,24,0.7)",
                borderColor: "rgba(30,60,110,0.5)",
              }}
            >
              <StatusRow label="slot fill" value={`${filledSlots} / ${slots.length}`} />
              <StatusRow label="resonance" value={resonance} />
              <StatusRow
                label="state"
                value={state}
                highlight={
                  state === "READY" ? "ok" : state === "PARTIAL" ? "warn" : "none"
                }
              />
              {mixResult && (
                <StatusRow
                  label="last result"
                  value={mixResult.concept_name}
                  highlight="ok"
                />
              )}
              {decomposeResult && (
                <StatusRow
                  label="decomp conf"
                  value={decomposeResult.confidence}
                  highlight={
                    decomposeResult.confidence === "high"
                      ? "ok"
                      : decomposeResult.confidence === "medium"
                      ? "warn"
                      : "none"
                  }
                />
              )}
            </div>

            {/* Log */}
            <div
              className="min-h-[120px] flex-1 overflow-y-auto rounded-md border px-2.5 py-2"
              style={{
                background: "rgba(2,5,12,0.85)",
                borderColor: "rgba(20,40,80,0.5)",
              }}
            >
              {logs.map((l, i) => (
                <div
                  key={i}
                  className="border-b py-0.5 text-[9px]"
                  style={{ borderColor: "rgba(15,25,45,0.4)" }}
                >
                  <span className="mr-1.5" style={{ color: "#2a3a55" }}>
                    [{l.ts}]
                  </span>
                  <span style={{ color: logColor(l.kind) }}>{l.msg}</span>
                </div>
              ))}
            </div>
          </aside>
        </main>

        {/* ========== FOOTER ========== */}
        <footer
          className="panel flex h-9 items-center gap-4 px-4 text-[9px] tracking-[1px]"
          style={{ color: "#4a6a90" }}
        >
          <span>▸ CLICK / DRAG 재료 → SLOT</span>
          <span className="opacity-30">│</span>
          <span>▸ SYN: 슬롯 → 새 컨셉</span>
          <span className="opacity-30">│</span>
          <span>▸ DEC: 현재 컨셉 → 구성 재료</span>
          <span
            className="ml-auto tracking-[2px] cyan-glow"
            style={{ color: "#00d4ff" }}
          >
            IF MAKER ⟡ 2026
          </span>
        </footer>
      </div>

      {/* Flash overlay */}
      {flash && (
        <div
          className="pointer-events-none fixed inset-0 z-[999] flex items-center justify-center"
          style={{ opacity: 1, transition: "opacity 0.5s" }}
        >
          <div
            className="burst-anim"
            style={{
              fontSize: 180,
              filter: "drop-shadow(0 0 40px rgba(0,255,200,0.8))",
            }}
          >
            {flash}
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="pointer-events-none fixed right-4 top-16 z-[1000] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
    </>
  );
}

/* ========================= Sub-components ========================= */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[9px]" style={{ color: "#556" }}>
      <b
        className="mr-1 text-[11px] cyan-glow"
        style={{
          color: "#00d4ff",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </b>
      {label}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mb-2.5 border-b pb-1.5 text-[10px] font-bold tracking-[1.8px] cyan-glow"
      style={{
        color: "#00d4ff",
        borderColor: "rgba(40,80,140,0.4)",
      }}
    >
      {children}
    </h3>
  );
}

function MaterialCard({
  item,
  active,
  inSlots,
  onClick,
  onAdd,
  onDragStart,
}: {
  item: SearchItem;
  active: boolean;
  inSlots: boolean;
  onClick: () => void;
  onAdd: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="mb-1.5 flex cursor-grab items-center gap-2.5 rounded-md border px-2.5 py-2 transition active:cursor-grabbing"
      style={{
        background: active
          ? "rgba(0,80,160,0.35)"
          : "rgba(8,14,28,0.7)",
        borderColor: active
          ? "#00d4ff"
          : inSlots
          ? "rgba(0,212,255,0.6)"
          : "rgba(30,60,110,0.5)",
        boxShadow: active
          ? "0 0 14px rgba(0,212,255,0.35)"
          : "none",
      }}
    >
      <div
        className="min-w-[30px] text-center"
        style={{
          fontSize: 24,
          filter: "drop-shadow(0 0 6px rgba(0,212,255,0.4))",
        }}
      >
        {item.emoji || "◆"}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[11px] font-semibold"
          style={{ color: "#cfe0ff" }}
        >
          {item.name}
        </div>
        <div
          className="truncate text-[8.5px]"
          style={{ color: "#5a7090" }}
        >
          {item.group} · {item.summary}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        className="rounded border px-1.5 py-0.5 text-[9px] transition"
        style={{
          borderColor: inSlots
            ? "rgba(0,212,255,0.6)"
            : "rgba(40,80,140,0.5)",
          color: inSlots ? "#8acfff" : "#5a7090",
          background: inSlots ? "rgba(0,80,160,0.3)" : "transparent",
        }}
        title="Add to next empty slot"
      >
        {inSlots ? "✓" : "+"}
      </button>
    </div>
  );
}

function Slot({
  idx,
  item,
  detail,
  ratio,
  ratioPercent,
  onClear,
  onDrop,
  onRatioChange,
}: {
  idx: number;
  item: SearchItem | null;
  detail?: ItemDetail | null;
  ratio: number;
  ratioPercent: number;
  onClear: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRatioChange: (v: number) => void;
}) {
  const filled = Boolean(item);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative flex flex-col rounded-md border-[1.5px] p-1 transition"
      style={{
        background: filled
          ? "radial-gradient(circle, rgba(0,80,160,0.4) 0%, rgba(2,6,14,0.8) 80%)"
          : "rgba(4,10,24,0.7)",
        borderStyle: filled ? "solid" : "dashed",
        borderColor: filled ? "rgba(0,212,255,0.7)" : "rgba(0,140,210,0.45)",
        boxShadow: filled ? "0 0 14px rgba(0,212,255,0.3) inset" : "none",
        minHeight: 100,
      }}
    >
      {filled && (
        <div
          className="scan-anim pointer-events-none absolute rounded-md border"
          style={{ inset: 3, borderColor: "rgba(0,212,255,0.3)" }}
        />
      )}

      {/* Header: slot id + ratio badge */}
      <div className="flex items-center justify-between text-[8px]">
        <span style={{ color: "#3a5a80" }}>S-{idx + 1}</span>
        {filled && (
          <span
            className="rounded px-1 font-mono"
            style={{
              color: "#00d4ff",
              background: "rgba(0,80,160,0.5)",
              textShadow: "0 0 4px rgba(0,212,255,0.5)",
            }}
          >
            {ratioPercent}%
          </span>
        )}
      </div>

      {item ? (
        <>
          {/* Emoji */}
          <div className="flex flex-1 items-center justify-center">
            <span
              className="sfloat-anim"
              style={{
                fontSize: 32,
                filter: "drop-shadow(0 0 8px rgba(0,212,255,0.5))",
              }}
            >
              {item.emoji || "◆"}
            </span>
          </div>

          {/* Name */}
          <div
            className="truncate text-center text-[9px] font-semibold"
            style={{ color: "#8acfff" }}
          >
            {item.name}
          </div>

          {/* Quick analysis: top 2 stats */}
          {detail && Object.keys(detail.properties).length > 0 && (
            <div className="mt-1 space-y-0.5">
              {Object.entries(detail.properties)
                .slice(0, 2)
                .map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center gap-1 text-[7px]"
                    style={{ color: "#5a7090" }}
                  >
                    <span className="truncate">{k.slice(0, 5)}</span>
                    <div
                      className="flex-1 overflow-hidden rounded-full"
                      style={{ height: 2, background: "rgba(4,10,24,0.8)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(Number(v) * 10, 100)}%`,
                          background: "#00d4ff",
                        }}
                      />
                    </div>
                    <span className="font-mono">{v}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Ratio slider */}
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={ratio}
            onChange={(e) => onRatioChange(Number(e.target.value))}
            className="mt-1 w-full accent-cyan-400"
            style={{ height: 4 }}
            title={`Mix ratio: ${ratio.toFixed(1)}x (${ratioPercent}%)`}
          />

          <button
            onClick={onClear}
            className="absolute right-1 top-0.5 text-[13px] font-bold opacity-30 transition hover:opacity-100"
            style={{ color: "#ff5566" }}
          >
            ✕
          </button>
        </>
      ) : (
        <div
          className="flex flex-1 items-center justify-center text-[9px]"
          style={{ color: "#3a5a80" }}
        >
          empty
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  highlight = "none",
}: {
  label: string;
  value: string;
  highlight?: "ok" | "warn" | "err" | "none";
}) {
  const color =
    highlight === "ok"
      ? "#33ff88"
      : highlight === "warn"
      ? "#ffaa33"
      : highlight === "err"
      ? "#ff5566"
      : "#8acfff";
  const glow =
    highlight !== "none"
      ? `0 0 6px rgba(${
          highlight === "ok"
            ? "51,255,136"
            : highlight === "warn"
            ? "255,170,51"
            : "255,85,102"
        },0.4)`
      : "none";
  return (
    <div
      className="flex items-center justify-between border-b py-0.5"
      style={{ borderColor: "rgba(20,40,80,0.4)", color: "#5a7090" }}
    >
      <span>{label}</span>
      <b style={{ color, textShadow: glow, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </b>
    </div>
  );
}

function ActButton({
  label,
  onClick,
  hoverBorder,
  hoverShadow,
  hoverText,
}: {
  label: string;
  onClick: () => void;
  hoverBorder: string;
  hoverShadow: string;
  hoverText: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-md border px-3 py-3 text-[11px] font-bold tracking-[1.5px] transition"
      style={{
        background: "rgba(8,16,32,0.8)",
        borderColor: "rgba(40,80,140,0.6)",
        color: "#8acfff",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = hoverBorder;
        e.currentTarget.style.boxShadow = `0 0 18px ${hoverShadow}`;
        e.currentTarget.style.color = hoverText;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgba(40,80,140,0.6)";
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.color = "#8acfff";
      }}
    >
      {label}
    </button>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const palette: Record<
    LogKind,
    { bg: string; border: string; color: string; icon: string }
  > = {
    ok: {
      bg: "rgba(6,40,18,0.9)",
      border: "rgba(51,255,136,0.6)",
      color: "#80ffb0",
      icon: "✓",
    },
    info: {
      bg: "rgba(6,18,38,0.9)",
      border: "rgba(0,212,255,0.6)",
      color: "#8acfff",
      icon: "ℹ",
    },
    warn: {
      bg: "rgba(40,30,6,0.9)",
      border: "rgba(255,170,51,0.7)",
      color: "#ffcc88",
      icon: "⚠",
    },
    err: {
      bg: "rgba(40,8,14,0.92)",
      border: "rgba(255,85,102,0.75)",
      color: "#ffaabb",
      icon: "✕",
    },
  };
  const p = palette[toast.kind];
  return (
    <div
      className="pointer-events-auto flex min-w-[260px] max-w-[360px] items-start gap-2.5 rounded-md border px-3 py-2.5 text-[11px] shadow-lg backdrop-blur-sm"
      style={{
        background: p.bg,
        borderColor: p.border,
        color: p.color,
        boxShadow: `0 0 16px ${p.border}`,
        animation: "burst-in 0.3s ease-out",
      }}
    >
      <span className="text-[14px] leading-none">{p.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold tracking-[0.5px]">{toast.title}</div>
        {toast.detail && (
          <div className="mt-0.5 text-[10px] opacity-70">{toast.detail}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="-m-1 p-1 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

function buildBlueprintSections({
  focus,
  slots,
  ratios,
  itemById,
  detailsCache,
}: {
  focus: FocusTarget;
  slots: Array<string | null>;
  ratios: number[];
  itemById: Record<string, SearchItem>;
  detailsCache: Record<string, ItemDetail>;
}): Array<{
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  ratio?: number;
  nodes: { id: string; label: string; source?: string }[];
  edges: { from: string; to: string; type: string }[];
  accent?: boolean;
  tint?: string;
}> {
  // Priority 1: focused concept → its merged diagram as a single section
  if (focus?.kind === "concept" && focus.data?.diagram) {
    return [
      {
        id: "merged",
        title: focus.data.concept_name,
        nodes: focus.data.diagram.nodes as any,
        edges: focus.data.diagram.edges,
        accent: true,
      },
    ];
  }

  // Priority 2: filled slots → one section per filled slot
  const filledIdx: number[] = [];
  slots.forEach((s, i) => {
    if (s) filledIdx.push(i);
  });
  if (filledIdx.length > 0) {
    const totalW = filledIdx.reduce((acc, i) => acc + (ratios[i] ?? 1), 0);
    return filledIdx.map((i) => {
      const id = slots[i] as string;
      const d = detailsCache[id];
      const item = itemById[id];
      const raw = ratios[i] ?? 1;
      const ratio = totalW > 0 ? raw / totalW : 1 / filledIdx.length;
      if (!d) {
        return {
          id: `slot-${i}`,
          title: item?.name || id,
          icon: item?.emoji,
          ratio,
          nodes: [],
          edges: [],
        };
      }
      return {
        id: `slot-${i}`,
        title: d.name,
        subtitle: d.group,
        icon: item?.emoji || d.emoji,
        ratio,
        nodes: (d.diagram?.nodes || []).map((n) => ({
          id: `s${i}_${n.id}`,
          label: n.label,
          source: d.name,
        })),
        edges: (d.diagram?.edges || []).map((e) => ({
          from: `s${i}_${e.from}`,
          to: `s${i}_${e.to}`,
          type: e.type,
        })),
      };
    });
  }

  // Priority 3: material preview
  if (focus?.kind === "material" && focus.data.diagram) {
    return [
      {
        id: "preview",
        title: focus.data.name,
        nodes: (focus.data.diagram.nodes || []).map((n) => ({
          id: n.id,
          label: n.label,
          source: focus.data.name,
        })),
        edges: focus.data.diagram.edges || [],
      },
    ];
  }

  return [];
}

function AnalysisStrip({
  focus,
  slots,
  ratios,
  itemById,
  detailsCache,
}: {
  focus: FocusTarget;
  slots: Array<string | null>;
  ratios: number[];
  itemById: Record<string, SearchItem>;
  detailsCache: Record<string, ItemDetail>;
}) {
  // Pick what to analyze: focused item first, else latest filled slot
  let detail: ItemDetail | null = null;
  let tintColor = "#00d4ff";
  let label = "ANALYSIS";
  let badge: string | null = null;

  if (focus?.kind === "material") {
    detail = focus.data;
    label = "ANALYSIS";
  } else if (focus?.kind === "concept" && focus.data) {
    // Concept has its own aggregated card already — summarize quickly
    const c = focus.data;
    const effect = c.visual?.element_effect;
    tintColor = effect
      ? effect === "burn"
        ? "#ff6a33"
        : effect === "freeze"
        ? "#88d0ff"
        : effect === "heat"
        ? "#ffaa22"
        : effect === "wet"
        ? "#33a6ff"
        : effect === "electrify"
        ? "#ffee55"
        : effect === "compress"
        ? "#aabbcc"
        : effect === "irradiate"
        ? "#aaff44"
        : effect === "vibrate"
        ? "#cc66ff"
        : "#33ff88"
      : "#33ff88";
    return (
      <div
        className="flex shrink-0 items-center gap-3 rounded-md border px-3 py-2"
        style={{
          borderColor: `${tintColor}55`,
          background: "rgba(2,6,14,0.7)",
        }}
      >
        <span className="text-[10px] font-bold" style={{ color: tintColor }}>
          ⚗ CONCEPT
        </span>
        <span className="truncate text-[11px]" style={{ color: "#cfe0ff" }}>
          {c.concept_name}
        </span>
        <div className="ml-auto flex gap-1.5">
          {Object.entries(c.combined_properties)
            .slice(0, 4)
            .map(([k, v]) => (
              <div
                key={k}
                className="rounded border px-1.5 py-0.5 text-[8px]"
                style={{
                  borderColor: `${tintColor}44`,
                  color: "#8aa8c8",
                  background: "rgba(4,10,24,0.6)",
                }}
                title={`${k}: ${v}`}
              >
                <span className="uppercase tracking-[0.5px]">
                  {k.slice(0, 5)}
                </span>
                <span
                  className="ml-1 font-mono"
                  style={{ color: tintColor }}
                >
                  {v}
                </span>
              </div>
            ))}
        </div>
      </div>
    );
  } else {
    // Latest filled slot
    const lastFilledIdx = [...slots].reverse().findIndex((s) => !!s);
    if (lastFilledIdx !== -1) {
      const idx = slots.length - 1 - lastFilledIdx;
      const id = slots[idx];
      if (id) {
        detail = detailsCache[id] ?? null;
        const pct =
          ratios[idx] != null
            ? Math.round(
                (ratios[idx] /
                  slots.reduce(
                    (a, s, i) => (s ? a + (ratios[i] ?? 1) : a),
                    0
                  )) *
                  100
              )
            : null;
        badge = pct != null ? `${pct}%` : null;
        label = `SLOT S-${idx + 1}`;
      }
    }
  }

  if (!detail) {
    return (
      <div
        className="flex shrink-0 items-center rounded-md border px-3 py-2 text-[10px]"
        style={{
          borderColor: "rgba(40,80,140,0.4)",
          background: "rgba(2,6,14,0.5)",
          color: "#3a5a80",
        }}
      >
        ANALYSIS — pick an item or fill a slot
      </div>
    );
  }

  const props = Object.entries(detail.properties).slice(0, 5);

  return (
    <div
      className="flex shrink-0 items-center gap-3 rounded-md border px-3 py-2"
      style={{
        borderColor: `${tintColor}55`,
        background: "rgba(2,6,14,0.75)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-mono"
          style={{ color: tintColor }}
        >
          {label}
        </span>
        {badge && (
          <span
            className="rounded-full border px-1.5 py-0 text-[9px] font-mono"
            style={{
              borderColor: `${tintColor}80`,
              color: tintColor,
              background: `${tintColor}15`,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <span className="text-[18px] leading-none">{detail.emoji || "◆"}</span>
      <div className="min-w-0 flex-shrink-[2]">
        <div
          className="truncate text-[11px] font-semibold"
          style={{ color: "#cfe0ff" }}
        >
          {detail.name}
        </div>
        <div
          className="truncate text-[9px]"
          style={{ color: "#5a7090" }}
        >
          {detail.category} · {detail.group} · {detail.summary}
        </div>
      </div>

      {/* Property micro-bars */}
      <div className="ml-auto flex items-center gap-1.5">
        {props.map(([k, v]) => (
          <div
            key={k}
            className="flex flex-col items-center"
            title={`${k}: ${v}`}
          >
            <div
              className="h-6 w-2 overflow-hidden rounded-full"
              style={{ background: "rgba(4,10,24,0.8)" }}
            >
              <div
                className="w-full"
                style={{
                  height: `${Math.min(Number(v) * 10, 100)}%`,
                  background: tintColor,
                  marginTop: `${100 - Math.min(Number(v) * 10, 100)}%`,
                }}
              />
            </div>
            <span
              className="mt-0.5 text-[7px] uppercase"
              style={{ color: "#5a7090" }}
            >
              {k.slice(0, 3)}
            </span>
          </div>
        ))}
      </div>

      {/* Tags */}
      {detail.tags.length > 0 && (
        <div className="hidden flex-wrap gap-1 xl:flex">
          {detail.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-full border px-1.5 py-0 text-[8px]"
              style={{
                borderColor: "rgba(40,80,140,0.5)",
                color: "#5a7090",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const FORM_MODES: { id: string; label: string; icon: string; hint: string }[] = [
  { id: "solid", label: "Solid", icon: "🧊", hint: "default" },
  { id: "diffuse", label: "Diffuse", icon: "💨", hint: "weight↓ impact↑" },
  { id: "condensed", label: "Condensed", icon: "💎", hint: "strength↑↑" },
  { id: "fibrous", label: "Fibrous", icon: "🧶", hint: "flex↑ strength↑" },
  { id: "plate", label: "Plate", icon: "🪙", hint: "flat shell" },
  { id: "porous", label: "Porous", icon: "🫧", hint: "impact↑ weight↓↓" },
];

function FormModeSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const current = FORM_MODES.find((m) => m.id === value) ?? FORM_MODES[0];
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border px-2.5 py-2 pr-7 text-[11px] outline-none"
        style={{
          background: "rgba(2,6,14,0.85)",
          borderColor: "rgba(0,212,255,0.5)",
          color: "#b8e0ff",
        }}
        title={`Form mode: ${current.label} — ${current.hint}`}
      >
        {FORM_MODES.map((m) => (
          <option key={m.id} value={m.id} style={{ background: "#060c1a" }}>
            {m.icon} {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ExportItem({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: string;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition hover:bg-purple-950/50"
    >
      <span
        className="text-[18px]"
        style={{ filter: "drop-shadow(0 0 4px rgba(168,85,247,0.4))" }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-[11px] font-semibold"
          style={{ color: "#d4c1ff" }}
        >
          {label}
        </div>
        <div className="text-[9px]" style={{ color: "#8a7dbb" }}>
          {sub}
        </div>
      </div>
    </button>
  );
}

function logColor(kind: LogKind): string {
  switch (kind) {
    case "ok":
      return "#33ff88";
    case "info":
      return "#6aa6dd";
    case "warn":
      return "#ffaa33";
    case "err":
      return "#ff5566";
  }
}

/* ================= Left panel: LibraryView & CreatedView ================= */

function LibraryView({
  query,
  setQuery,
  groups,
  activeGroup,
  setActiveGroup,
  items,
  slots,
  focus,
  onSelect,
  onAdd,
  onDragStart,
  onCreate,
}: {
  query: string;
  setQuery: (v: string) => void;
  groups: GroupInfo[];
  activeGroup: string | null;
  setActiveGroup: (v: string | null) => void;
  items: SearchItem[];
  slots: Array<string | null>;
  focus: FocusTarget;
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onCreate: (name: string) => void;
}) {
  const trimmed = query.trim();
  const exactMatch = trimmed
    ? items.some(
        (it) => it.name.toLowerCase() === trimmed.toLowerCase()
      )
    : false;
  const canCreate = trimmed.length >= 2 && !exactMatch;
  const materialGroups = groups.filter((g) => g.category === "material");
  const objectGroups = groups.filter((g) => g.category === "object");
  const elementGroups = groups.filter((g) => g.category === "element");

  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canCreate) {
            onCreate(trimmed);
          }
        }}
        placeholder="search or type a new material..."
        className="mb-2 w-full rounded-md border px-2.5 py-1.5 text-[11px] outline-none"
        style={{
          background: "rgba(2,6,14,0.8)",
          borderColor: "rgba(40,80,140,0.6)",
          color: "#b8e0ff",
        }}
      />

      {canCreate && (
        <button
          onClick={() => onCreate(trimmed)}
          className="mb-2 flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left transition hover:border-amber-500"
          style={{
            borderColor: "rgba(255,170,50,0.5)",
            background: "rgba(40,28,10,0.6)",
            color: "#ffcc88",
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[1.2px] text-amber-400">
              + create new
            </div>
            <div className="truncate text-[11px] font-semibold">
              {trimmed}
            </div>
          </div>
          <div className="ml-2 text-[16px]">◇</div>
        </button>
      )}

      {groups.length > 0 && (
        <div className="mb-2 space-y-1">
          {[
            { key: "materials", arr: materialGroups },
            { key: "objects", arr: objectGroups },
            { key: "elements", arr: elementGroups },
          ].map((grp) =>
            grp.arr.length > 0 ? (
              <div key={grp.key}>
                <div
                  className="mb-1 text-[8px] uppercase tracking-[1.5px]"
                  style={{ color: "#3a5a80" }}
                >
                  {grp.key}
                </div>
                <div className="flex flex-wrap gap-1">
                  {grp.arr.map((g) => (
                    <button
                      key={g.group}
                      onClick={() =>
                        setActiveGroup(activeGroup === g.group ? null : g.group)
                      }
                      className="rounded-full border px-2 py-0.5 text-[9px] transition"
                      style={{
                        borderColor:
                          activeGroup === g.group ? "#00d4ff" : "rgba(40,80,140,0.6)",
                        color: activeGroup === g.group ? "#8ae0ff" : "#5a7090",
                        background:
                          activeGroup === g.group
                            ? "rgba(0,80,160,0.3)"
                            : "rgba(4,10,22,0.6)",
                      }}
                    >
                      {g.group}
                      <span className="ml-1 opacity-50">{g.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {items.length === 0 && (
          <div
            className="rounded-md border border-dashed px-3 py-4 text-center text-[10px]"
            style={{ borderColor: "rgba(40,80,140,0.4)", color: "#3a5a80" }}
          >
            no items
          </div>
        )}
        {items.map((it) => (
          <MaterialCard
            key={it.id}
            item={it}
            active={focus?.kind === "material" && focus.id === it.id}
            inSlots={slots.includes(it.id)}
            onClick={() => onSelect(it.id)}
            onAdd={() => onAdd(it.id)}
            onDragStart={(e) => onDragStart(e, it.id)}
          />
        ))}
      </div>
    </>
  );
}

function CreatedView({
  concepts,
  focus,
  onSelect,
  onAddToSlot,
  onClear,
}: {
  concepts: MixResult[];
  focus: FocusTarget;
  onSelect: (c: MixResult) => void;
  onAddToSlot: (c: MixResult) => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px]" style={{ color: "#5a7090" }}>
          synthesized concepts
        </div>
        {concepts.length > 0 && (
          <button
            onClick={onClear}
            className="text-[9px] hover:text-red-400"
            style={{ color: "#5a7090" }}
          >
            clear all
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {concepts.length === 0 && (
          <div
            className="rounded-md border border-dashed px-3 py-6 text-center text-[10px]"
            style={{ borderColor: "rgba(40,80,140,0.4)", color: "#3a5a80" }}
          >
            No concepts yet.
            <br />
            Synthesize to create one.
          </div>
        )}
        {concepts.map((c) => {
          const isActive =
            focus?.kind === "concept" &&
            focus.data?.experiment_id === c.experiment_id;
          const elemEffect = c.visual?.element_effect;
          const accent = elemEffect
            ? elementColor(elemEffect)
            : "#33ff88";
          return (
            <div
              key={c.experiment_id}
              className="mb-1.5 rounded-md border px-2.5 py-2 transition"
              style={{
                borderColor: isActive ? accent : "rgba(30,60,110,0.5)",
                background: isActive
                  ? "rgba(4,30,14,0.7)"
                  : "rgba(8,14,28,0.7)",
                boxShadow: isActive
                  ? `0 0 10px ${accent}44`
                  : "none",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => onSelect(c)}
                >
                  <div
                    className="truncate text-[11px] font-semibold"
                    style={{ color: isActive ? accent : "#cfe0ff" }}
                  >
                    {c.concept_name}
                  </div>
                  <div
                    className="truncate text-[8.5px]"
                    style={{ color: "#5a7090" }}
                  >
                    {c.source_items
                      .map((s) => {
                        if (s.category === "element") return s.name;
                        const r = (s as any).ratio;
                        if (typeof r === "number") {
                          return `${s.name} ${Math.round(r * 100)}%`;
                        }
                        return s.name;
                      })
                      .join(" + ")}
                  </div>
                </div>
                <div
                  className="text-[14px]"
                  style={{
                    filter: `drop-shadow(0 0 4px ${accent}aa)`,
                  }}
                >
                  {elemEffect ? elementEmoji(elemEffect) : "⚗️"}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToSlot(c);
                  }}
                  className="shrink-0 rounded border px-1.5 py-0.5 text-[9px] transition"
                  style={{
                    borderColor: "rgba(51,255,136,0.5)",
                    color: "#80ffb0",
                    background: "rgba(4,30,14,0.5)",
                  }}
                  title="Add to slot (remix)"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ================= Slot grid (split 3D viewport) ================= */

/* ================= Explore variants grid ================= */

function ExploreGrid({
  result,
  onCommit,
  onCancel,
}: {
  result: ExploreResult;
  onCommit: (v: ExploreVariant) => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col p-2">
      <div
        className="mb-2 flex items-center justify-between rounded border px-3 py-1.5"
        style={{
          borderColor: "rgba(168,85,247,0.5)",
          background: "rgba(20,10,30,0.6)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold tracking-[1.5px]"
            style={{ color: "#e0c8ff" }}
          >
            🎲 EXPLORE — PICK A STRATEGY
          </span>
          <span className="text-[9px]" style={{ color: "#8a7dbb" }}>
            {result.variants.length} variants · ratios applied
          </span>
          <span
            className="rounded-full border px-2 py-0.5 text-[8px] font-bold tracking-[0.5px]"
            style={{
              borderColor:
                result.strategy_source === "llm"
                  ? "rgba(51,255,136,0.6)"
                  : "rgba(168,85,247,0.5)",
              color:
                result.strategy_source === "llm" ? "#80ffb0" : "#c9a6ff",
              background:
                result.strategy_source === "llm"
                  ? "rgba(6,40,18,0.6)"
                  : "rgba(20,10,30,0.5)",
            }}
            title={
              result.strategy_source === "llm"
                ? "Strategies generated dynamically by LLM"
                : "Static fallback strategies (LLM off or failed)"
            }
          >
            {result.strategy_source === "llm" ? "⚡ LLM" : "◯ STATIC"}
          </span>
        </div>
        <button
          onClick={onCancel}
          className="rounded border px-2 py-0.5 text-[9px] transition hover:bg-red-950/50"
          style={{
            borderColor: "rgba(255,85,102,0.5)",
            color: "#ffaabb",
          }}
        >
          ✕ CANCEL
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid h-full grid-cols-2 gap-2 xl:grid-cols-3">
          {result.variants.map((v) => (
            <VariantCard key={v.strategy_id} variant={v} onCommit={() => onCommit(v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  onCommit,
}: {
  variant: ExploreVariant;
  onCommit: () => void;
}) {
  const effect = variant.visual?.element_effect;
  const accent = effect
    ? effect === "burn"
      ? "#ff6a33"
      : effect === "freeze"
      ? "#88d0ff"
      : "#33ff88"
    : "#a855f7";

  const topProps = Object.entries(variant.combined_properties).slice(0, 5);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-md border transition hover:scale-[1.01]"
      style={{
        borderColor: `${accent}55`,
        background: `linear-gradient(135deg, rgba(10,14,26,0.9), rgba(20,8,30,0.85))`,
        boxShadow: `0 0 14px ${accent}22 inset`,
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: `${accent}33` }}
      >
        <span className="text-[18px]">{variant.strategy_icon}</span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[11px] font-bold tracking-[0.5px]"
            style={{ color: accent }}
          >
            {variant.strategy_label}
          </div>
          <div
            className="truncate text-[9px]"
            style={{ color: "#8a7dbb" }}
            title={variant.strategy_description}
          >
            {variant.strategy_description}
          </div>
        </div>
      </div>

      <div className="flex-1 px-3 py-2">
        <div
          className="mb-1 text-[12px] font-semibold"
          style={{ color: "#cfe0ff" }}
        >
          {variant.concept_name}
        </div>
        <div
          className="mb-2 rounded bg-black/40 px-2 py-0.5 text-[9px]"
          style={{ color: accent }}
        >
          ℹ {variant.strategy_hint}
        </div>

        <div className="space-y-0.5">
          {topProps.map(([k, v]) => (
            <div key={k}>
              <div
                className="flex justify-between text-[8px]"
                style={{ color: "#5a7090" }}
              >
                <span className="uppercase tracking-[0.5px]">
                  {k.replace(/_/g, " ").slice(0, 12)}
                </span>
                <span className="font-mono">{v}</span>
              </div>
              <div
                className="h-[2px] overflow-hidden rounded-full"
                style={{ background: "rgba(4,10,24,0.8)" }}
              >
                <div
                  className="h-[2px] rounded-full"
                  style={{
                    width: `${Math.min(Number(v) * 10, 100)}%`,
                    background: accent,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onCommit}
        className="border-t px-3 py-2 text-[11px] font-bold transition"
        style={{
          borderColor: `${accent}33`,
          color: accent,
          background: `${accent}15`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = `${accent}30`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = `${accent}15`;
        }}
      >
        SELECT ▸
      </button>
    </div>
  );
}

/* ================= Concept view (synthesis result) ================= */

// Shared property interpretation dictionaries (mirror of backend
// _PROPERTY_HIGH_NOTE / _PROPERTY_LOW_NOTE). Used by ItemAnalysisPanel so
// that individual materials get the same narrative treatment as mix results.
const PROPERTY_HIGH_NOTE: Record<string, string> = {
  strength: "load-bearing and impact-resistant",
  flexibility: "bends and deforms without fracture",
  weight: "noticeably heavy — plan mounting accordingly",
  cost: "premium — justify with performance",
  heat_resistance: "stable at elevated temperatures",
  impact_absorption: "cushions shock and vibration",
  conductivity: "readily carries current and heat",
  transparency: "light passes through cleanly",
  density: "tightly packed mass",
  hardness: "scratch and abrasion resistant",
  durability: "long service life under wear",
  stability: "holds shape and alignment reliably",
};
const PROPERTY_LOW_NOTE: Record<string, string> = {
  strength: "fragile under load — not for structural duty",
  flexibility: "brittle — cracks before it bends",
  weight: "exceptionally light — easy to move and mount",
  cost: "affordable for mass production",
  heat_resistance: "degrades with heat — keep cool",
  impact_absorption: "transmits shock directly — reinforce joints",
  conductivity: "good insulator",
  transparency: "opaque",
  density: "airy and porous",
  hardness: "soft — scratches easily",
  durability: "wears out fast — plan replacement",
  stability: "wobbles or drifts under load",
};

function summarizeItemProperties(props: Record<string, number>) {
  const entries = Object.entries(props).filter(
    ([, v]) => typeof v === "number"
  );
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const dominant = sorted
    .slice(0, 3)
    .filter(([, v]) => v >= 6.5)
    .map(([k, v]) => ({
      property: k,
      value: v,
      note: PROPERTY_HIGH_NOTE[k] || "strong expression of this trait",
    }));
  const weak = sorted
    .slice(-3)
    .reverse()
    .filter(([, v]) => v <= 3.5)
    .map(([k, v]) => ({
      property: k,
      value: v,
      note: PROPERTY_LOW_NOTE[k] || "low expression of this trait",
    }));
  return { dominant, weak };
}

function buildItemNarrative(detail: ItemDetail): string[] {
  const { dominant, weak } = summarizeItemProperties(detail.properties);
  const paragraphs: string[] = [];

  const catLabel =
    detail.category === "material"
      ? "material"
      : detail.category === "object"
      ? "object"
      : detail.category === "element"
      ? "element"
      : detail.category === "synthesized"
      ? "synthesized composite"
      : detail.category;

  paragraphs.push(
    `${detail.name} is a ${
      detail.group ? detail.group + " " : ""
    }${catLabel}${detail.summary ? ". " + detail.summary : "."}`
  );

  if (dominant.length > 0) {
    const text = dominant
      .map((t) => `${t.property.replace(/_/g, " ")}=${t.value} (${t.note})`)
      .join("; ");
    paragraphs.push(`Dominant traits: ${text}.`);
  } else {
    paragraphs.push(
      "No single property dominates — this item sits in a balanced, generalist zone."
    );
  }

  if (weak.length > 0) {
    const text = weak
      .map((t) => `${t.property.replace(/_/g, " ")}=${t.value} (${t.note})`)
      .join("; ");
    paragraphs.push(`Weak points: ${text}. Plan the surrounding system around these.`);
  }

  const form = detail.structure?.form;
  if (form && form !== "solid") {
    paragraphs.push(`Form factor: ${form} — morphology affects how it combines in a mix.`);
  }

  return paragraphs;
}

function ItemAnalysisPanel({
  detail,
  label,
  accent = "#00d4ff",
}: {
  detail: ItemDetail;
  label?: string;
  accent?: string;
}) {
  const narrative = buildItemNarrative(detail);
  const { dominant, weak } = summarizeItemProperties(detail.properties);

  return (
    <div
      className="absolute left-3 top-10 z-20 flex max-h-[80%] w-[320px] flex-col gap-2 overflow-auto rounded border px-2.5 py-2 text-[10px]"
      style={{
        borderColor: `${accent}44`,
        background: "rgba(2,6,14,0.92)",
        color: "#bcd4f0",
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="font-mono text-[9px] uppercase tracking-[1px]"
          style={{ color: accent }}
        >
          ▸ {label || "ITEM ANALYSIS"}
        </div>
        <div className="font-mono text-[8px]" style={{ color: "#4a6a90" }}>
          {detail.category.toUpperCase()}
        </div>
      </div>

      <div>
        <div
          className="text-[12px] font-semibold leading-tight"
          style={{ color: accent }}
        >
          {detail.emoji || "◆"} {detail.name}
        </div>
        {detail.group && (
          <div className="mt-0.5 text-[9px]" style={{ color: "#6a8ab0" }}>
            {detail.group}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 leading-[1.5]">
        {narrative.map((p, i) => (
          <p key={i} className="text-[10px]" style={{ color: "#cfe0ff" }}>
            {p}
          </p>
        ))}
      </div>

      {dominant.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: "rgba(136,255,170,0.3)", color: "#88ffaa" }}
          >
            ✓ dominant traits
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {dominant.map((t) => (
              <div key={t.property} className="text-[9px]">
                <span className="font-mono" style={{ color: "#88ffaa" }}>
                  {t.property.replace(/_/g, " ")}={t.value}
                </span>
                <span className="ml-1" style={{ color: "#aaccdd" }}>
                  — {t.note}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {weak.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: "rgba(255,136,136,0.3)", color: "#ff9090" }}
          >
            ✗ weak points
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {weak.map((w) => (
              <div key={w.property} className="text-[9px]">
                <span className="font-mono" style={{ color: "#ff9090" }}>
                  {w.property.replace(/_/g, " ")}={w.value}
                </span>
                <span className="ml-1" style={{ color: "#aaccdd" }}>
                  — {w.note}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail.uses && detail.uses.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: `${accent}33`, color: "#6a8ab0" }}
          >
            typical uses
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {detail.uses.slice(0, 5).map((u, i) => (
              <div key={i} className="text-[9px]" style={{ color: "#aaccdd" }}>
                • {u}
              </div>
            ))}
          </div>
        </div>
      )}

      {detail.risks && detail.risks.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: "rgba(255,204,68,0.3)", color: "#ffcc44" }}
          >
            ⚠ risks
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {detail.risks.slice(0, 5).map((r, i) => (
              <div key={i} className="text-[9px]" style={{ color: "#ffdd99" }}>
                • {r}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DecomposeReportPanel({
  result,
  itemById,
  accent = "#cc66ff",
}: {
  result: DecomposeResult;
  itemById: Record<string, SearchItem>;
  accent?: string;
}) {
  const confColor =
    result.confidence === "high"
      ? "#88ffaa"
      : result.confidence === "medium"
      ? "#ffcc44"
      : "#ff9090";

  return (
    <div
      className="absolute right-3 top-10 z-20 flex max-h-[80%] w-[300px] flex-col gap-2 overflow-auto rounded border px-2.5 py-2 text-[10px]"
      style={{
        borderColor: `${accent}44`,
        background: "rgba(2,6,14,0.92)",
        color: "#bcd4f0",
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="font-mono text-[9px] uppercase tracking-[1px]"
          style={{ color: accent }}
        >
          ▸ DECOMPOSITION
        </div>
        <div
          className="rounded px-1 text-[8px] uppercase"
          style={{
            background: `${confColor}22`,
            color: confColor,
            border: `1px solid ${confColor}55`,
          }}
        >
          {result.confidence}
        </div>
      </div>

      <div>
        <div className="text-[9px]" style={{ color: "#6a8ab0" }}>
          source concept
        </div>
        <div
          className="text-[12px] font-semibold leading-tight"
          style={{ color: accent }}
        >
          ⚗ {result.concept_name}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 leading-[1.5]">
        <p className="text-[10px]" style={{ color: "#cfe0ff" }}>
          Reverse-engineered into {result.components.length} component
          {result.components.length === 1 ? "" : "s"}. Each part has been
          placed back into its own slot so you can edit ratios and
          re-synthesize a variant.
        </p>
        {result.confidence === "high" ? (
          <p className="text-[9px]" style={{ color: "#88ffaa" }}>
            Exact round-trip — this concept was originally synthesized in this
            session, so decomposition is lossless.
          </p>
        ) : (
          <p className="text-[9px]" style={{ color: "#ffcc44" }}>
            Heuristic decomposition — inferred from the concept name, so the
            component list is a best guess, not an exact inverse.
          </p>
        )}
      </div>

      <div>
        <div
          className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
          style={{ borderColor: `${accent}33`, color: "#6a8ab0" }}
        >
          components
        </div>
        <div className="mt-1 flex flex-col gap-0.5">
          {result.components.map((c, i) => {
            const lib = itemById[c.id];
            return (
              <div key={c.id + i} className="flex items-center gap-1.5">
                <span
                  className="shrink-0 rounded px-1 font-mono text-[8px]"
                  style={{
                    background: `${accent}22`,
                    color: accent,
                    minWidth: 22,
                    textAlign: "center",
                  }}
                >
                  S-{i + 1}
                </span>
                <span className="text-[12px]">{lib?.emoji || "◆"}</span>
                <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: "#cfe0ff" }}>
                  {c.name}
                </span>
                <span className="text-[8px] uppercase" style={{ color: "#6a8ab0" }}>
                  {c.category}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AnalysisReportPanel({
  analysis,
  accent,
}: {
  analysis: AnalysisReport;
  accent: string;
}) {
  return (
    <div
      className="absolute left-3 top-10 flex max-h-[75%] w-[320px] flex-col gap-2 overflow-auto rounded border px-2.5 py-2 text-[10px]"
      style={{
        borderColor: `${accent}44`,
        background: "rgba(2,6,14,0.92)",
        color: "#bcd4f0",
      }}
    >
      <div
        className="font-mono text-[9px] uppercase tracking-[1px]"
        style={{ color: accent }}
      >
        ▸ MIX ANALYSIS
      </div>

      {/* Narrative paragraphs */}
      <div className="flex flex-col gap-1.5 leading-[1.5]">
        {analysis.narrative.map((p, i) => (
          <p key={i} className="text-[10px]" style={{ color: "#cfe0ff" }}>
            {p}
          </p>
        ))}
      </div>

      {/* Composition contributions */}
      {analysis.composition_notes.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: `${accent}33`, color: "#6a8ab0" }}
          >
            composition
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {analysis.composition_notes.map((c, i) => (
              <div key={i} className="flex gap-1.5 text-[9px]">
                <span
                  className="shrink-0 rounded px-1"
                  style={{
                    background: `${accent}22`,
                    color: accent,
                    minWidth: 32,
                    textAlign: "center",
                  }}
                >
                  {c.ratio != null
                    ? `${Math.round(c.ratio * 100)}%`
                    : c.category === "element"
                    ? "EL"
                    : "—"}
                </span>
                <span className="min-w-0 flex-1" style={{ color: "#aaccdd" }}>
                  <b style={{ color: "#cfe0ff" }}>{c.source}</b>{" "}
                  {c.contribution}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dominant traits */}
      {analysis.dominant_traits.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: "rgba(136,255,170,0.3)", color: "#88ffaa" }}
          >
            ✓ dominant traits
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {analysis.dominant_traits.map((t) => (
              <div key={t.property} className="text-[9px]">
                <span className="font-mono" style={{ color: "#88ffaa" }}>
                  {t.property.replace(/_/g, " ")}={t.value}
                </span>
                <span className="ml-1" style={{ color: "#aaccdd" }}>
                  — {t.note}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weak points */}
      {analysis.weak_points.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: "rgba(255,136,136,0.3)", color: "#ff9090" }}
          >
            ✗ weak points
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {analysis.weak_points.map((w) => (
              <div key={w.property} className="text-[9px]">
                <span className="font-mono" style={{ color: "#ff9090" }}>
                  {w.property.replace(/_/g, " ")}={w.value}
                </span>
                <span className="ml-1" style={{ color: "#aaccdd" }}>
                  — {w.note}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tradeoffs */}
      {analysis.tradeoffs.length > 0 && (
        <div>
          <div
            className="border-b pb-0.5 text-[8px] uppercase tracking-[1px]"
            style={{ borderColor: "rgba(255,204,68,0.3)", color: "#ffcc44" }}
          >
            ⇄ tradeoffs
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {analysis.tradeoffs.map((t, i) => (
              <div key={i} className="text-[9px]" style={{ color: "#ffdd99" }}>
                • {t}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InventionPanel({ invention }: { invention: InventionBlock }) {
  if (invention.error) {
    return (
      <div
        className="absolute right-3 top-10 w-[260px] rounded border px-2.5 py-2 text-[10px]"
        style={{
          borderColor: "rgba(255,120,120,0.4)",
          background: "rgba(20,4,8,0.9)",
          color: "#ff9090",
        }}
      >
        ⚠ invention layer error: {invention.error}
      </div>
    );
  }

  const goalFit = Math.round((invention.goal_fit?.score ?? 0) * 100);
  const novelty = Math.round((invention.novelty?.score ?? 0) * 100);
  const isDuplicate = invention.novelty?.duplicate_of != null;

  const goalColor = goalFit >= 70 ? "#33ff88" : goalFit >= 40 ? "#ffcc44" : "#ff6666";
  const novColor = novelty >= 70 ? "#33ff88" : novelty >= 30 ? "#ffcc44" : "#ff6666";

  return (
    <div
      className="absolute right-3 top-10 flex max-h-[70%] w-[280px] flex-col gap-2 overflow-auto rounded border px-2.5 py-2 text-[10px]"
      style={{
        borderColor: "rgba(102,170,255,0.4)",
        background: "rgba(2,6,14,0.92)",
        color: "#bcd4f0",
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="font-mono text-[9px] uppercase tracking-[1px]"
          style={{ color: "#66aaff" }}
        >
          ▸ INVENTION REPORT
        </div>
        <div className="font-mono text-[8px]" style={{ color: "#4a6a90" }}>
          {invention.signature}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div
          className="rounded border px-1.5 py-1"
          style={{ borderColor: `${goalColor}55`, background: `${goalColor}12` }}
        >
          <div className="text-[8px] uppercase" style={{ color: `${goalColor}cc` }}>
            goal fit
          </div>
          <div className="font-mono text-[14px] font-bold" style={{ color: goalColor }}>
            {goalFit}%
          </div>
        </div>
        <div
          className="rounded border px-1.5 py-1"
          style={{ borderColor: `${novColor}55`, background: `${novColor}12` }}
        >
          <div className="text-[8px] uppercase" style={{ color: `${novColor}cc` }}>
            novelty
          </div>
          <div className="font-mono text-[14px] font-bold" style={{ color: novColor }}>
            {novelty}%
          </div>
        </div>
      </div>

      {isDuplicate && (
        <div
          className="rounded border px-1.5 py-1 text-[9px]"
          style={{
            borderColor: "rgba(255,170,68,0.4)",
            background: "rgba(40,20,4,0.6)",
            color: "#ffaa44",
          }}
        >
          ⚠ duplicate of {invention.novelty.duplicate_of}
        </div>
      )}

      {invention.goal_fit?.matched_keywords?.length > 0 && (
        <div>
          <div className="text-[8px] uppercase" style={{ color: "#6a8ab0" }}>
            matched terms
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {invention.goal_fit.matched_keywords.map((k) => (
              <span
                key={k}
                className="rounded border px-1 py-[1px] text-[9px]"
                style={{
                  borderColor: "rgba(102,170,255,0.4)",
                  color: "#aaccff",
                }}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {invention.goal_fit?.matched_properties?.length > 0 && (
        <div>
          <div className="text-[8px] uppercase" style={{ color: "#6a8ab0" }}>
            property goals
          </div>
          <div className="mt-0.5 flex flex-col gap-0.5">
            {invention.goal_fit.matched_properties.map((p) => (
              <div
                key={p.goal_term + p.property}
                className="flex items-center justify-between gap-1"
              >
                <span style={{ color: p.satisfied ? "#88ffaa" : "#ff8888" }}>
                  {p.satisfied ? "✓" : "✗"}
                </span>
                <span className="flex-1 truncate" style={{ color: "#aaccdd" }}>
                  {p.goal_term} → {p.property} ({p.direction})
                </span>
                <span className="font-mono" style={{ color: "#88aadd" }}>
                  {p.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {invention.claim && (
        <div>
          <div
            className="flex items-center justify-between text-[8px] uppercase"
            style={{ color: "#6a8ab0" }}
          >
            <span>claim 1</span>
            <span
              className="rounded px-1"
              style={{
                background:
                  invention.claim.source === "llm" ? "#1a4a2a" : "#1a2a4a",
                color:
                  invention.claim.source === "llm" ? "#88ffbb" : "#88bbff",
              }}
            >
              {invention.claim.source}
            </span>
          </div>
          <div
            className="mt-0.5 rounded border px-1.5 py-1 text-[9px] leading-[1.4]"
            style={{
              borderColor: "rgba(102,170,255,0.3)",
              background: "rgba(6,12,26,0.7)",
              color: "#cfe0ff",
            }}
          >
            {invention.claim.claim_1}
          </div>
          {invention.claim.abstract && (
            <div
              className="mt-1 text-[9px] italic"
              style={{ color: "#8aa5c5" }}
            >
              {invention.claim.abstract}
            </div>
          )}
        </div>
      )}

      <div>
        <div
          className="flex items-center justify-between text-[8px] uppercase"
          style={{ color: "#6a8ab0" }}
        >
          <span>prior art</span>
          <span
            style={{
              color:
                invention.prior_art.status === "checked"
                  ? invention.prior_art.hit_count > 0
                    ? "#ffaa44"
                    : "#88ffaa"
                  : "#ff8888",
            }}
          >
            {invention.prior_art.status === "checked"
              ? `${invention.prior_art.hit_count} hits`
              : invention.prior_art.status}
          </span>
        </div>
        {invention.prior_art.results.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {invention.prior_art.results.slice(0, 3).map((r, i) => (
              <div
                key={i}
                className="truncate text-[9px]"
                style={{ color: "#aaccdd" }}
                title={r.title}
              >
                • {r.title}
              </div>
            ))}
          </div>
        )}
        {invention.prior_art.query_url && (
          <a
            href={invention.prior_art.query_url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-block text-[8px] underline"
            style={{ color: "#66aaff" }}
          >
            open google patents ↗
          </a>
        )}
      </div>

      {invention.logged_at && (
        <div
          className="text-[8px]"
          style={{ color: "#4a6a90" }}
        >
          logged {new Date(invention.logged_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function ConceptView({
  concept,
  visual,
}: {
  concept: MixResult;
  visual?: MixResult["visual"];
}) {
  const effect = visual?.element_effect;
  const accentColor = effect
    ? effect === "burn"
      ? "#ff6a33"
      : effect === "heat"
      ? "#ffaa22"
      : effect === "freeze"
      ? "#88d0ff"
      : effect === "wet"
      ? "#33a6ff"
      : effect === "electrify"
      ? "#ffee55"
      : effect === "compress"
      ? "#aabbcc"
      : effect === "irradiate"
      ? "#aaff44"
      : effect === "vibrate"
      ? "#cc66ff"
      : "#33ff88"
    : "#33ff88";

  return (
    <div className="absolute inset-0">
      <Viewport3D
        itemId={visual?.base_id}
        group={visual?.base_group ?? "composite"}
        category={visual?.base_category}
        accent={!effect}
        elementEffect={effect}
      />

      {/* Top-left label */}
      <div
        className="absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 text-[9px] font-mono tracking-[1px]"
        style={{ color: accentColor }}
      >
        ⚗ SYNTHESIZED
      </div>

      {concept.analysis && (
        <AnalysisReportPanel analysis={concept.analysis} accent={accentColor} />
      )}

      {concept.invention && <InventionPanel invention={concept.invention} />}

      {/* Concept name + source items overlay */}
      <div
        className="absolute bottom-0 left-0 right-0 border-t px-4 py-2.5 backdrop-blur-sm"
        style={{
          borderColor: `${accentColor}44`,
          background: "rgba(2,6,14,0.85)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[14px] font-semibold tracking-tight"
              style={{ color: accentColor }}
            >
              {concept.concept_name}
            </div>
            <div
              className="mt-0.5 truncate text-[10px]"
              style={{ color: "#6a8ab0" }}
            >
              {concept.source_items
                .map((s) => {
                  if (s.category === "element") return s.name;
                  const r = (s as any).ratio;
                  if (typeof r === "number") {
                    return `${s.name} ${Math.round(r * 100)}%`;
                  }
                  return s.name;
                })
                .join(" + ")}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1">
            {concept.source_items.map((s) => {
              const r = (s as any).ratio;
              const isElem = s.category === "element";
              const isObject = s.category === "object";
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-1 rounded border px-1.5 py-0.5"
                  style={{
                    borderColor: isElem
                      ? "rgba(255,153,68,0.5)"
                      : isObject
                      ? "rgba(170,200,255,0.5)"
                      : `${accentColor}66`,
                    background: isElem
                      ? "rgba(40,20,6,0.6)"
                      : "rgba(2,6,14,0.6)",
                  }}
                  title={s.name}
                >
                  <span
                    className="text-[14px]"
                    style={{
                      filter: `drop-shadow(0 0 4px ${accentColor}66)`,
                    }}
                  >
                    {s.emoji || "◆"}
                  </span>
                  {!isElem && typeof r === "number" && (
                    <span
                      className="font-mono text-[9px]"
                      style={{ color: accentColor }}
                    >
                      {Math.round(r * 100)}%
                    </span>
                  )}
                  {isObject && (
                    <span
                      className="rounded bg-blue-950/60 px-1 text-[7px] uppercase tracking-[0.5px]"
                      style={{ color: "#aaccff" }}
                    >
                      FORM
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}

function SlotGrid({
  slots,
  itemById,
  detailsCache,
  previewFocus,
}: {
  slots: Array<string | null>;
  itemById: Record<string, SearchItem>;
  detailsCache: Record<string, ItemDetail>;
  previewFocus: ItemDetail | null;
}) {
  // Filled slot ids in order
  const filledIds = slots.filter((s): s is string => !!s);

  // If zero slots filled but user is previewing a library item, show it.
  if (filledIds.length === 0) {
    if (previewFocus) {
      return (
        <SlotTile
          id={previewFocus.id}
          item={{
            id: previewFocus.id,
            name: previewFocus.name,
            category: previewFocus.category,
            group: previewFocus.group,
            emoji: previewFocus.emoji,
            summary: previewFocus.summary,
            tags: previewFocus.tags,
          }}
          detail={previewFocus}
          label="PREVIEW"
        />
      );
    }
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-[11px] tracking-[1.5px]" style={{ color: "#4a6a90" }}>
            ◆ EMPTY WORKSPACE
          </div>
          <div className="mt-2 text-[10px]" style={{ color: "#3a5a80" }}>
            Drag or + materials into slots
          </div>
        </div>
      </div>
    );
  }

  const n = filledIds.length;
  const gridClass =
    n === 1
      ? "grid-cols-1"
      : n === 2
      ? "grid-cols-2"
      : n === 3
      ? "grid-cols-3"
      : n === 4
      ? "grid-cols-2 grid-rows-2"
      : n <= 6
      ? "grid-cols-3 grid-rows-2"
      : "grid-cols-4 grid-rows-2";

  return (
    <div className={`absolute inset-0 grid gap-1 p-1 ${gridClass}`}>
      {filledIds.map((id, i) => {
        const item = itemById[id];
        if (!item) return <div key={`empty-${i}`} />;
        return (
          <SlotTile
            key={`${id}-${i}`}
            id={id}
            item={item}
            detail={detailsCache[id] ?? null}
            label={`S-${i + 1}`}
          />
        );
      })}
    </div>
  );
}

function SlotTile({
  id,
  item,
  label,
}: {
  id: string;
  item: SearchItem;
  detail?: ItemDetail | null;
  label: string;
}) {
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-md border"
      style={{
        borderColor: "rgba(40,80,140,0.4)",
        background:
          "radial-gradient(ellipse at center, rgba(0,40,80,0.2) 0%, rgba(2,6,14,0.8) 70%)",
      }}
    >
      {/* 3D viewport — fills the whole tile now; blueprint moved to bottom panel */}
      <div className="relative flex-1 min-h-0">
        <Viewport3D itemId={id} group={item.group} category={item.category} />

        {/* Corner label */}
        <div
          className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[8px] font-mono tracking-[1px]"
          style={{ color: "#00d4ff" }}
        >
          {label}
        </div>

        {/* Name bar */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center gap-2 border-t px-2 py-1.5 backdrop-blur-sm"
          style={{
            borderColor: "rgba(40,80,140,0.4)",
            background: "rgba(2,6,14,0.75)",
          }}
        >
          <span className="text-[16px]">{item.emoji || "◆"}</span>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[10px] font-semibold"
              style={{ color: "#cfe0ff" }}
            >
              {item.name}
            </div>
            <div className="truncate text-[8px]" style={{ color: "#5a7090" }}>
              {item.category} · {item.group}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function elementColor(effect: string): string {
  switch (effect) {
    case "burn":
      return "#ff6633";
    case "wet":
      return "#33a6ff";
    case "heat":
      return "#ffaa22";
    case "freeze":
      return "#88d0ff";
    case "electrify":
      return "#ffee55";
    case "compress":
      return "#aabbcc";
    case "irradiate":
      return "#99ff55";
    case "vibrate":
      return "#cc88ff";
  }
  return "#33ff88";
}

function elementEmoji(effect: string): string {
  switch (effect) {
    case "burn":
      return "🔥";
    case "wet":
      return "💧";
    case "heat":
      return "🌡️";
    case "freeze":
      return "❄️";
    case "electrify":
      return "⚡";
    case "compress":
      return "💨";
    case "irradiate":
      return "☢️";
    case "vibrate":
      return "🎵";
  }
  return "⚗️";
}
