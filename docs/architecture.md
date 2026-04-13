# IF Maker — Architecture (v0)

## Layers

```
┌─────────────────────────────────────────────┐
│  Frontend  (Next.js 14, Tailwind, dark UI)  │
│  3-panel workspace                          │
│    Library  |  Diagram  |  Analysis/Result  │
└──────────────────────┬──────────────────────┘
                       │ HTTP (JSON)
┌──────────────────────▼──────────────────────┐
│  Backend  (FastAPI, Python 3.12)            │
│   routes/                                   │
│     items.py     /items/search, /items/{id} │
│     mix.py       /mix/generate              │
│   services/                                 │
│     search_service     name+tag+summary     │
│     analysis_service   structure → diagram  │
│     mix_service        rules → typed result │
│     llm_service        optional BYOK layer  │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│  Data  (local JSON files)                   │
│    materials.json     12 entries            │
│    objects.json       8 entries             │
│    mix_rules.json     7 rules + fallback    │
└─────────────────────────────────────────────┘
```

## Determinism contract

The mix engine is **fully deterministic** by design.
Same `(item_a, item_b, goal)` always produces the same `experiment_id` and the same result. The optional LLM enhancement layer is the *only* non-deterministic component, and it is opt-in per request.

This matters because:

1. The lab is reproducible — concepts can be cited and shared.
2. Users do not need an API key to use IF Maker at all.
3. The core can be tested without mocking LLM responses.

## Mix rule matching

A mix rule matches when **all** of these hold:

- `match.categories` matches the (a, b) categories (`"any"` is a wildcard).
- For each side, `ids_any_*` (if present) contains the item's id.
- For each side, `tags_any_*` (if present) intersects the item's tags.
- `goal_keywords` (if present) — at least one keyword appears in the (normalized) goal.

Matching is **symmetric**: the rule is tried with `(a, b)` and with `(b, a)`. The first matching rule wins. If no rule matches, `rule_default_speculative_mix` is used.

## Property merging

For each property key present in *both* items, the merged value is the rounded average. If the two items share zero numeric keys, the engine falls back to keeping both sides as `a_*` and `b_*` so nothing is lost.

## Diagram builder

`analysis_service` reads `item.structure.type` and dispatches to a per-type builder. Adding a new structure type is a one-function change. The diagram payload is intentionally simple — `{nodes, edges, notes?}` — so the frontend renders boxes and labeled connections without a graph library.

## Why no LLM in the core

LLMs are non-deterministic, slow, and expensive. By keeping the core deterministic:

- The first-time user gets an instant working demo with **no API key**.
- The deterministic engine is the **product**; the LLM is **decoration**.
- A bad LLM call cannot break the lab — `enhance_mix_result()` either succeeds and overwrites prose fields, or returns the original result unchanged.
