import os
import re
import json
import requests

# windows loopback (get ip with: `ip route show | grep -i default | awk '{print $3}'`)
LLAMA_URL        = os.getenv("LLAMA_URL",         "http://172.30.160.1:8080")
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


def detect_model() -> str | None:
    """Query llama-server /props to get the filename of the currently loaded model."""
    try:
        resp = requests.get(f"{LLAMA_URL}/props", timeout=5)
        if resp.ok:
            path = resp.json().get("model_path", "")
            name = re.split(r"[/\\]", path)[-1]
            stem = os.path.splitext(name)[0]
            return stem or None
    except Exception:
        pass
    return None


CURRENT_MODEL: str | None = detect_model()


def llm_generate(prompt: str, max_retries: int = 3,
                 temperature: float | None = None, n_predict: int | None = None) -> str | None:
    """Call llama-server /v1/chat/completions endpoint. Returns the response text or None on failure."""
    payload: dict = {
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if n_predict is not None:
        payload["max_tokens"] = n_predict
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"{LLAMA_URL}/v1/chat/completions",
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"  llama-server error (attempt {attempt + 1}): {e}")
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
