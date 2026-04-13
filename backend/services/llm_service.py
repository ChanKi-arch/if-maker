from __future__ import annotations

from typing import Any, Dict, Optional
import json
import logging
import os
import time

try:
    from openai import OpenAI  # type: ignore
    _OPENAI_AVAILABLE = True
except ImportError:
    _OPENAI_AVAILABLE = False

logger = logging.getLogger("ifmaker.llm")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(name)s %(levelname)s: %(message)s")

_DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("LLM_TIMEOUT", "15"))
_MAX_RETRIES = int(os.environ.get("LLM_MAX_RETRIES", "1"))


class LLMService:
    """
    Optional LLM enhancement layer for IF Maker.

    BYOK (Bring Your Own Key) — works with any OpenAI SDK-compatible endpoint:
      - OpenAI
      - Anthropic (via OpenAI-compatible proxy)
      - Alibaba Qwen (Bailian)
      - DeepSeek
      - Groq
      - local Ollama (http://localhost:11434/v1)

    Environment variables:
      LLM_API_KEY     — required to enable
      LLM_BASE_URL    — e.g. https://api.openai.com/v1
      LLM_MODEL_NAME  — e.g. gpt-4o-mini, qwen-plus, deepseek-chat

    If LLM_API_KEY is not set, the service is disabled and enhance_mix_result()
    returns the deterministic result unchanged.
    """

    def __init__(self) -> None:
        self.api_key = os.environ.get("LLM_API_KEY", "").strip()
        self.base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").strip()
        self.model = os.environ.get("LLM_MODEL_NAME", "gpt-4o-mini").strip()

        self.enabled = bool(self.api_key) and _OPENAI_AVAILABLE
        self._client: Optional[Any] = None

        if self.enabled:
            self._client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=_DEFAULT_TIMEOUT_SECONDS,
                max_retries=_MAX_RETRIES,
            )
            logger.info(
                "LLM enabled: model=%s base=%s timeout=%.1fs retries=%d",
                self.model,
                self.base_url,
                _DEFAULT_TIMEOUT_SECONDS,
                _MAX_RETRIES,
            )
        else:
            logger.info("LLM disabled: no API key or SDK not available")

    def is_enabled(self) -> bool:
        return self.enabled

    def enhance_mix_result(self, mix_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Augment a deterministic mix result with LLM-generated prose.

        Returns the mix_result dict with enhanced fields (or unchanged if disabled).
        """
        if not self.enabled or self._client is None:
            return mix_result

        prompt = self._build_enhancement_prompt(mix_result)
        concept_id = mix_result.get("experiment_id", "?")
        t0 = time.time()

        try:
            response = self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a concept-design assistant for a virtual lab. "
                            "You respond ONLY with a single valid JSON object, no prose, "
                            "no markdown code fences."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=600,
            )
            elapsed = time.time() - t0
            content = response.choices[0].message.content or ""
            enhanced = self._parse_json_response(content)

            if enhanced:
                result = dict(mix_result)
                if "concept_name" in enhanced and enhanced["concept_name"]:
                    result["concept_name"] = str(enhanced["concept_name"])
                if "summary" in enhanced and enhanced["summary"]:
                    result["summary"] = str(enhanced["summary"])
                if isinstance(enhanced.get("advantages"), list):
                    result["advantages"] = [str(x) for x in enhanced["advantages"][:6]]
                if isinstance(enhanced.get("risks"), list):
                    result["risks"] = [str(x) for x in enhanced["risks"][:6]]
                if isinstance(enhanced.get("use_cases"), list):
                    result["use_cases"] = [str(x) for x in enhanced["use_cases"][:6]]
                result["llm_enhanced"] = True
                result["llm_elapsed_s"] = round(elapsed, 2)
                logger.info(
                    "LLM enhance ok: id=%s elapsed=%.2fs name=%r",
                    concept_id,
                    elapsed,
                    result.get("concept_name"),
                )
                return result
            else:
                logger.warning(
                    "LLM enhance: unparseable JSON (id=%s elapsed=%.2fs). "
                    "Falling back to deterministic result.",
                    concept_id,
                    elapsed,
                )
                return mix_result
        except Exception as e:  # noqa: BLE001
            elapsed = time.time() - t0
            err_name = type(e).__name__
            logger.error(
                "LLM enhance failed: id=%s elapsed=%.2fs err=%s msg=%s",
                concept_id,
                elapsed,
                err_name,
                str(e),
            )
            return {
                **mix_result,
                "llm_enhanced": False,
                "llm_error": f"{err_name}: {e}",
                "llm_elapsed_s": round(elapsed, 2),
            }

    def _build_enhancement_prompt(self, mix_result: Dict[str, Any]) -> str:
        inputs = ", ".join(
            f"{x.get('name','?')} ({x.get('category','?')})"
            for x in mix_result.get("source_items", [])
        )
        return (
            f"You are refining a speculative hybrid concept in a virtual lab.\n\n"
            f"Inputs: {inputs}\n"
            f"Goal: {mix_result.get('goal','')}\n"
            f"Base concept name: {mix_result.get('concept_name','')}\n"
            f"Base summary: {mix_result.get('summary','')}\n\n"
            f"Return ONE JSON object with these keys only:\n"
            f"  concept_name (short, evocative)\n"
            f"  summary (2-3 sentences)\n"
            f"  advantages (array of 3-5 short strings)\n"
            f"  risks (array of 3-5 short strings)\n"
            f"  use_cases (array of 3-5 short strings)\n\n"
            f"No markdown. No code fences. Plain JSON only."
        )

    @staticmethod
    def _parse_json_response(content: str) -> Optional[Dict[str, Any]]:
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.lower().startswith("json"):
                content = content[4:]
            content = content.strip()
        try:
            data = json.loads(content)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                try:
                    data = json.loads(content[start : end + 1])
                    if isinstance(data, dict):
                        return data
                except json.JSONDecodeError:
                    return None
        return None
