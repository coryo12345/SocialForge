import os
import json
import requests

# windows loopback (get ip with: `ip route show | grep -i default | awk '{print $3}'`)
OLLAMA_BASE_URL  = os.getenv("OLLAMA_URL",        "http://172.30.160.1:11434")# "http://localhost:11434")

# normal ollama url
# OLLAMA_BASE_URL  = os.getenv("OLLAMA_URL",        "http://localhost:11434")
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL",      "qwen2.5:3b")#"gemma4:e2b")
APP_API_URL      = os.getenv("APP_API_URL",       "http://localhost:3001/api")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY",  "dev-internal-key")

INTERNAL_HEADERS = {
    "X-Internal-Key": INTERNAL_API_KEY,
    "Content-Type": "application/json",
}


def load_settings() -> dict:
    """Fetch all settings from the API as a flat {key: value} dict. Falls back to {} on error."""
    try:
        resp = requests.get(
            f"{APP_API_URL}/settings",
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        if resp.ok:
            return resp.json()
    except Exception as e:
        print(f"  Warning: could not load settings: {e}")
    return {}


def ollama_generate(prompt: str, max_retries: int = 3, model: str | None = None,
                    temperature: float | None = None, num_predict: int | None = None) -> str | None:
    """Call Ollama generate endpoint. Returns the response text or None on failure."""
    _model = model or OLLAMA_MODEL
    _opts: dict = {}
    if temperature is not None:
        _opts["temperature"] = temperature
    if num_predict is not None:
        _opts["num_predict"] = num_predict
    for attempt in range(max_retries):
        try:
            payload: dict = {"model": _model, "prompt": prompt, "stream": False}
            if _opts:
                payload["options"] = _opts
            resp = requests.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["response"].strip()
        except Exception as e:
            print(f"  Ollama error (attempt {attempt + 1}): {e}")
    return None


def extract_json(text: str | None) -> dict | None:
    """Extract the first JSON object from a string. Handles markdown code fences."""
    if not text:
        return None
    text = text.strip()
    # Strip markdown code fences
    if text.startswith("```"):
        parts = text.split("```")
        # Take the content inside the first fence block
        inner = parts[1] if len(parts) > 1 else text
        if inner.startswith("json"):
            inner = inner[4:]
        text = inner.strip()
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        return json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        return None
