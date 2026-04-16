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


def ollama_generate(prompt: str, max_retries: int = 3) -> str | None:
    """Call Ollama generate endpoint. Returns the response text or None on failure."""
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
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
