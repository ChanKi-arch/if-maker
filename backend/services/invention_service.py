"""
InventionService — turns a deterministic mix result into an "invention record".

Adds five orthogonal layers on top of MixService output:

  1. goal_fit     — how well the result matches the stated goal (0..1)
  2. novelty      — distance from already-logged inventions (0..1)
  3. claim        — patent-style Claim 1 via LLM, with deterministic fallback
  4. prior_art    — Google Patents quick lookup for the concept name
  5. invention_log — JSONL persistence with sha256 signature + timestamp

Each layer is independent and degrades gracefully when the LLM or network
is unavailable.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    import httpx  # bundled via openai / fastapi
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False

logger = logging.getLogger("ifmaker.invention")


# ---- goal parsing --------------------------------------------------------

_STOPWORDS = {
    "a", "an", "the", "and", "or", "for", "with", "of", "to", "in", "on",
    "that", "is", "be", "can", "should", "would", "make", "build", "create",
    "design", "something", "thing", "want", "need", "like",
}

# goal adjective -> (property_key, desired_direction)
#   direction: +1 means "high is better", -1 means "low is better"
_GOAL_PROPERTY_HINTS: Dict[str, tuple] = {
    "light":            ("weight",            -1),
    "lightweight":      ("weight",            -1),
    "heavy":            ("weight",            +1),
    "strong":           ("strength",          +1),
    "durable":          ("strength",          +1),
    "tough":            ("strength",          +1),
    "hard":             ("strength",          +1),
    "flexible":         ("flexibility",       +1),
    "soft":             ("flexibility",       +1),
    "stiff":            ("flexibility",       -1),
    "rigid":            ("flexibility",       -1),
    "cheap":            ("cost",              -1),
    "affordable":       ("cost",              -1),
    "premium":          ("cost",              +1),
    "absorbent":        ("impact_absorption", +1),
    "shockproof":       ("impact_absorption", +1),
    "protective":       ("impact_absorption", +1),
    "cushioned":        ("impact_absorption", +1),
    "fireproof":        ("heat_resistance",   +1),
    "heatproof":        ("heat_resistance",   +1),
    "thermal":          ("heat_resistance",   +1),
    "conductive":       ("conductivity",      +1),
    "insulating":       ("conductivity",      -1),
}


def _tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-zA-Z]+", (text or "").lower()) if t not in _STOPWORDS]


def score_goal_fit(result: Dict[str, Any], goal: str) -> Dict[str, Any]:
    """
    Returns {score: 0..1, matched_keywords: [...], matched_properties: [...]}.
    Empty goal → score 1.0 with no detail (no goal = no mismatch).
    """
    if not goal or not goal.strip():
        return {"score": 1.0, "matched_keywords": [], "matched_properties": [], "note": "no goal set"}

    goal_tokens = set(_tokenize(goal))
    if not goal_tokens:
        return {"score": 1.0, "matched_keywords": [], "matched_properties": [], "note": "goal has no useful terms"}

    # --- keyword side ---------------------------------------------------
    concept_text = " ".join([
        str(result.get("concept_name", "")),
        str(result.get("summary", "")),
        " ".join(str(t) for t in result.get("tags", [])),
        " ".join(str(s.get("name", "")) for s in result.get("source_items", [])),
    ])
    concept_tokens = set(_tokenize(concept_text))
    matched_keywords = sorted(goal_tokens & concept_tokens)
    keyword_score = len(matched_keywords) / len(goal_tokens) if goal_tokens else 0.0

    # --- property side --------------------------------------------------
    props = result.get("combined_properties", {}) or {}
    property_checks = []
    property_hits = 0
    property_total = 0
    for token in goal_tokens:
        hint = _GOAL_PROPERTY_HINTS.get(token)
        if not hint:
            continue
        key, direction = hint
        property_total += 1
        value = float(props.get(key, 5.0))
        # 0..10 scale. 7+ counts as "high", 3- counts as "low".
        hit = (direction > 0 and value >= 6.5) or (direction < 0 and value <= 3.5)
        property_checks.append({
            "goal_term": token,
            "property": key,
            "direction": "high" if direction > 0 else "low",
            "value": round(value, 2),
            "satisfied": hit,
        })
        if hit:
            property_hits += 1

    property_score = (property_hits / property_total) if property_total else None

    # --- blend ----------------------------------------------------------
    if property_score is None:
        score = keyword_score
    else:
        score = 0.5 * keyword_score + 0.5 * property_score

    return {
        "score": round(max(0.0, min(1.0, score)), 3),
        "matched_keywords": matched_keywords,
        "matched_properties": property_checks,
    }


# ---- novelty -------------------------------------------------------------


def make_signature(result: Dict[str, Any]) -> str:
    """Stable sha256 of sorted source ids + form_mode + ratio bucket."""
    source_ids = sorted(s.get("id", "") for s in result.get("source_items", []))
    form_mode = (result.get("visual") or {}).get("form_mode") or "solid"
    ratio_buckets = [round(float(s.get("ratio", 0.0)) * 10) for s in result.get("source_items", [])]
    ratio_buckets.sort()
    payload = json.dumps(
        {"ids": source_ids, "form": form_mode, "ratios": ratio_buckets},
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def score_novelty(signature: str, result: Dict[str, Any], log_entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Novelty compared to previously-logged inventions in this lab.

      exact signature match   → 0.0 (already invented)
      no source_id overlap    → 1.0 (fully new territory)
      partial overlap         → 1 - (avg_jaccard)

    Cold start (empty log) returns 1.0.
    """
    if not log_entries:
        return {"score": 1.0, "duplicate_of": None, "nearest": []}

    for entry in log_entries:
        if entry.get("signature") == signature:
            return {
                "score": 0.0,
                "duplicate_of": entry.get("experiment_id"),
                "nearest": [entry.get("experiment_id")],
            }

    my_ids = set(s.get("id", "") for s in result.get("source_items", []))
    if not my_ids:
        return {"score": 1.0, "duplicate_of": None, "nearest": []}

    scored: List[tuple] = []
    for entry in log_entries:
        other_ids = set(entry.get("source_ids", []))
        if not other_ids:
            continue
        inter = len(my_ids & other_ids)
        union = len(my_ids | other_ids)
        jaccard = inter / union if union else 0.0
        scored.append((jaccard, entry.get("experiment_id")))

    if not scored:
        return {"score": 1.0, "duplicate_of": None, "nearest": []}

    scored.sort(reverse=True)
    top = scored[: min(3, len(scored))]
    avg_sim = sum(s for s, _ in top) / len(top)
    novelty = 1.0 - avg_sim

    return {
        "score": round(max(0.0, min(1.0, novelty)), 3),
        "duplicate_of": None,
        "nearest": [eid for _, eid in top],
    }


# ---- patent claim generation --------------------------------------------


def generate_claim_fallback(result: Dict[str, Any]) -> Dict[str, str]:
    """Deterministic fallback claim + abstract when LLM is unavailable."""
    name = result.get("concept_name", "composite article")
    source_items = result.get("source_items", [])
    props = result.get("combined_properties", {}) or {}

    base = next(
        (s for s in source_items if s.get("category") == "object"),
        source_items[0] if source_items else {"name": "article"},
    )
    materials = [s for s in source_items if s.get("category") == "material"]
    elements = [s for s in source_items if s.get("category") == "element"]

    comp_parts: List[str] = []
    if materials:
        mat_desc = ", ".join(
            f"a {m.get('name','material').lower()} layer at {int(round(float(m.get('ratio', 0)) * 100))}%"
            for m in materials[:3]
        )
        comp_parts.append(mat_desc)
    if elements:
        comp_parts.append(
            "an element-treatment stage selected from "
            + ", ".join(e.get("name", "element").lower() for e in elements[:3])
        )

    form_mode = (result.get("visual") or {}).get("form_mode")
    if form_mode and form_mode != "solid":
        comp_parts.append(f"a {form_mode} morphology")

    property_clause = ""
    notable = [(k, v) for k, v in props.items() if isinstance(v, (int, float)) and v >= 7]
    if notable:
        notable.sort(key=lambda kv: -kv[1])
        property_clause = (
            ", wherein the combined properties exhibit "
            + ", ".join(f"{k.replace('_', ' ')} ≥ {v}" for k, v in notable[:3])
        )

    claim_1 = f"A {base.get('name','article').lower()}-form composite article, comprising " + (
        "; ".join(comp_parts) if comp_parts else "a structured hybrid core"
    ) + property_clause + "."

    abstract = (
        f"The disclosed {name} integrates "
        + ", ".join(m.get("name", "") for m in source_items[:4])
        + f". It is characterized by a {form_mode or 'solid'} form and "
        + (
            "notable " + ", ".join(k for k, _ in notable[:2])
            if notable
            else "balanced physical properties"
        )
        + "."
    )

    return {
        "claim_1": claim_1,
        "abstract": abstract[:400],
        "source": "fallback",
    }


def generate_claim_llm(llm_service: Any, result: Dict[str, Any], goal: str) -> Optional[Dict[str, str]]:
    """Use the existing LLMService's raw OpenAI client to write a claim."""
    if llm_service is None or not getattr(llm_service, "enabled", False):
        return None
    client = getattr(llm_service, "_client", None)
    if client is None:
        return None

    source_desc = ", ".join(
        f"{s.get('name','?')} ({s.get('category','?')}, {int(round(float(s.get('ratio', 0)) * 100))}%)"
        for s in result.get("source_items", [])
    )
    props = result.get("combined_properties", {}) or {}
    prop_desc = ", ".join(f"{k}={v}" for k, v in list(props.items())[:8])
    form_mode = (result.get("visual") or {}).get("form_mode") or "solid"

    prompt = (
        f"You are a patent drafting assistant. Write one independent Claim 1 "
        f"and a short abstract (max 60 words) for this invention.\n\n"
        f"Concept: {result.get('concept_name','')}\n"
        f"Goal: {goal or '(not specified)'}\n"
        f"Components: {source_desc}\n"
        f"Form: {form_mode}\n"
        f"Properties (0-10): {prop_desc}\n\n"
        f"Rules:\n"
        f"- Claim 1 must start with 'A ' or 'An ' and end with a period.\n"
        f"- Use real patent language ('comprising', 'wherein', 'configured to').\n"
        f"- Do NOT invent components not listed above.\n\n"
        f"Return a JSON object with exactly two keys: claim_1, abstract. "
        f"No markdown, no code fences."
    )

    t0 = time.time()
    try:
        response = client.chat.completions.create(
            model=llm_service.model,
            messages=[
                {"role": "system", "content": "You reply with a single valid JSON object. No prose."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=500,
        )
        elapsed = time.time() - t0
        content = (response.choices[0].message.content or "").strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.lower().startswith("json"):
                content = content[4:]
            content = content.strip()
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                data = json.loads(content[start : end + 1])
            else:
                raise

        if not isinstance(data, dict):
            return None
        claim = str(data.get("claim_1") or "").strip()
        abstract = str(data.get("abstract") or "").strip()
        if not claim:
            return None
        logger.info("Claim LLM ok: elapsed=%.2fs", elapsed)
        return {
            "claim_1": claim,
            "abstract": abstract[:600],
            "source": "llm",
            "elapsed_s": round(elapsed, 2),
        }
    except Exception as e:  # noqa: BLE001
        logger.warning("Claim LLM failed: %s", e)
        return None


# ---- prior art -----------------------------------------------------------


_TITLE_RE = re.compile(r'<h3[^>]*>\s*<span[^>]*>([^<]{8,200})</span>', re.IGNORECASE)
_SEARCH_ANCHOR_RE = re.compile(r'data-result="([^"]+)"[^>]*>\s*<[^>]+>([^<]{8,200})', re.IGNORECASE)


def check_prior_art(concept_name: str, timeout: float = 6.0) -> Dict[str, Any]:
    """
    Lightweight Google Patents query. Returns {hit_count, results: [...], query_url}.

    This is intentionally fragile — Google Patents has no stable free API, so we
    just do a best-effort scrape and degrade to 'unavailable' on any failure.
    """
    query_url = "https://patents.google.com/?q=" + concept_name.replace(" ", "+")

    if not _HTTPX_AVAILABLE:
        return {
            "hit_count": 0,
            "results": [],
            "status": "unavailable",
            "reason": "httpx not installed",
            "query_url": query_url,
        }

    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            response = client.get(
                "https://patents.google.com/",
                params={"q": concept_name},
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (compatible; IFMakerBot/0.1; "
                        "+https://github.com/)"
                    ),
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
        if response.status_code != 200:
            return {
                "hit_count": 0,
                "results": [],
                "status": "error",
                "reason": f"http {response.status_code}",
                "query_url": str(response.url),
            }

        html = response.text
        titles: List[str] = []
        for match in _TITLE_RE.finditer(html):
            title = re.sub(r"\s+", " ", match.group(1)).strip()
            if title and title not in titles:
                titles.append(title)
            if len(titles) >= 5:
                break

        status = "checked"
        # Google Patents is JS-rendered, so an empty HTML result is still
        # informative — it means no pre-rendered hits.
        return {
            "hit_count": len(titles),
            "results": [{"title": t} for t in titles],
            "status": status,
            "query_url": str(response.url),
        }
    except Exception as e:  # noqa: BLE001
        logger.warning("Prior art check failed: %s", e)
        return {
            "hit_count": 0,
            "results": [],
            "status": "error",
            "reason": type(e).__name__,
            "query_url": "",
        }


# ---- invention log -------------------------------------------------------


class InventionService:
    def __init__(
        self,
        llm_service: Any = None,
        log_path: Optional[str] = None,
    ) -> None:
        self.llm_service = llm_service
        self.log_path = log_path or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "data",
            "inventions.jsonl",
        )
        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)

    # --- log I/O ---------------------------------------------------------

    def _read_log(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.log_path):
            return []
        entries: List[Dict[str, Any]] = []
        try:
            with open(self.log_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError as e:
            logger.warning("Invention log read failed: %s", e)
        return entries

    def _append_log(self, entry: Dict[str, Any]) -> None:
        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as e:
            logger.warning("Invention log write failed: %s", e)

    def list_inventions(self, limit: int = 50) -> List[Dict[str, Any]]:
        entries = self._read_log()
        entries.reverse()
        return entries[:limit]

    def get_invention(self, experiment_id: str) -> Optional[Dict[str, Any]]:
        for entry in self._read_log():
            if entry.get("experiment_id") == experiment_id:
                return entry
        return None

    # --- pipeline --------------------------------------------------------

    def evaluate(
        self,
        result: Dict[str, Any],
        goal: str,
        do_prior_art: bool = True,
        do_claim: bool = True,
        persist: bool = True,
    ) -> Dict[str, Any]:
        """Run all five layers and return an invention block."""
        signature = make_signature(result)
        goal_fit = score_goal_fit(result, goal)

        log_entries = self._read_log()
        novelty = score_novelty(signature, result, log_entries)

        claim: Optional[Dict[str, str]] = None
        if do_claim:
            claim = generate_claim_llm(self.llm_service, result, goal)
            if not claim:
                claim = generate_claim_fallback(result)

        prior_art: Dict[str, Any]
        if do_prior_art:
            prior_art = check_prior_art(result.get("concept_name", ""))
        else:
            prior_art = {"hit_count": 0, "results": [], "status": "skipped", "query_url": ""}

        logged_at: Optional[str] = None
        if persist and novelty.get("score", 0) > 0:
            logged_at = datetime.now(timezone.utc).isoformat()
            entry = {
                "experiment_id": result.get("experiment_id"),
                "concept_name": result.get("concept_name"),
                "signature": signature,
                "source_ids": [s.get("id", "") for s in result.get("source_items", [])],
                "goal": goal,
                "goal_fit": goal_fit["score"],
                "novelty": novelty["score"],
                "claim_1": claim.get("claim_1") if claim else None,
                "logged_at": logged_at,
            }
            self._append_log(entry)

        return {
            "signature": signature,
            "goal_fit": goal_fit,
            "novelty": novelty,
            "claim": claim,
            "prior_art": prior_art,
            "logged_at": logged_at,
        }
