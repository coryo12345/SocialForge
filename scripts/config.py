import os
import re
import json
import time
import random
import threading
import requests
from requests.adapters import HTTPAdapter

# windows loopback (get ip with: `ip route show | grep -i default | awk '{print $3}'`)
LLAMA_URL        = os.getenv("LLAMA_URL",         "http://172.30.160.1:8080")
APP_API_URL      = os.getenv("APP_API_URL",       "http://localhost:3001/api")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY",  "dev-internal-key")

INTERNAL_HEADERS = {
    "X-Internal-Key": INTERNAL_API_KEY,
    "Content-Type": "application/json",
}

# Match this to llama-server's `-np / --parallel` slot count. It sizes the HTTP
# connection pool so N worker threads don't fight over a handful of sockets.
LLM_MAX_PARALLEL = int(os.getenv("LLM_MAX_PARALLEL", "32"))

# With every slot busy, a request that takes 20s alone can wait far longer behind
# others. A short timeout here just fires and re-sends, adding load to the queue.
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "300"))

# Sampler defaults for the Gemma family. llama.cpp's own defaults (top_k 40) are
# NOT these, and llm_generate previously sent only `temperature`, so everything
# else silently fell back to the server's values.
#
# repeat_penalty stays at 1.0 on purpose: penalties punish "I", "just", "like",
# "the" — exactly the words real venting prose repeats constantly.
#
# min_p 0.02 is a small deliberate deviation from Google's published 0.0. It acts
# as a coherence floor now that temperature sits near 1.0. Set LLM_MIN_P=0.0 to
# match the model card exactly.
SAMPLER = {
    "top_k":          int(os.getenv("LLM_TOP_K", "64")),
    "top_p":          float(os.getenv("LLM_TOP_P", "0.95")),
    "min_p":          float(os.getenv("LLM_MIN_P", "0.02")),
    "repeat_penalty": float(os.getenv("LLM_REPEAT_PENALTY", "1.0")),
}


_local = threading.local()


def _session() -> requests.Session:
    """A per-thread Session with a real connection pool.

    Without this, every llm_generate call opens and tears down a fresh TCP
    connection — thousands of handshakes per run at high parallelism.
    """
    s = getattr(_local, "session", None)
    if s is None:
        s = requests.Session()
        adapter = HTTPAdapter(pool_connections=4, pool_maxsize=LLM_MAX_PARALLEL)
        s.mount("http://", adapter)
        s.mount("https://", adapter)
        _local.session = s
    return s


def load_settings() -> dict:
    """Fetch all settings from the API as a flat {key: value} dict. Falls back to {} on error."""
    try:
        resp = _session().get(
            f"{APP_API_URL}/settings",
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        if resp.ok:
            return resp.json()
    except Exception as e:
        print(f"  Warning: could not load settings: {e}")
    return {}


def detect_server() -> tuple[str | None, int | None]:
    """Query llama-server /props for the loaded model name and per-slot context.

    Per-slot context is `-c` divided by `-np`, so a high slot count buys
    concurrency at the cost of room per request. We clamp max_tokens against it
    below rather than letting long generations get silently truncated.
    """
    try:
        resp = _session().get(f"{LLAMA_URL}/props", timeout=5)
        if resp.ok:
            data = resp.json()
            path = data.get("model_path", "")
            name = re.split(r"[/\\]", path)[-1]
            stem = os.path.splitext(name)[0] or None
            n_ctx = (data.get("default_generation_settings") or {}).get("n_ctx")
            return stem, (int(n_ctx) if n_ctx else None)
    except Exception:
        pass
    return None, None


CURRENT_MODEL, SLOT_CTX = detect_server()

_ctx_warned = False


def _clamp_tokens(prompt: str, n_predict: int) -> int:
    """Shrink max_tokens so prompt + output fits in one slot's context."""
    global _ctx_warned
    if not SLOT_CTX:
        return n_predict
    est_prompt = len(prompt) // 3          # deliberately pessimistic
    room = SLOT_CTX - est_prompt - 64      # margin for the chat template
    if room >= n_predict:
        return n_predict
    if not _ctx_warned:
        _ctx_warned = True
        print(f"  Note: slot context is {SLOT_CTX} tokens, capping generation at "
              f"~{max(room, 128)} (wanted {n_predict}). Raise llama-server's -c "
              f"(total context = -c / -np per slot) to allow longer output.")
    return max(room, 128)


def llm_generate(prompt: str, max_retries: int = 3,
                 temperature: float | None = None, 
                 n_predict: int | None = None,
                 think_budget: int | None = None,
                 enable_thinking: bool = False) -> str | None:
    
    payload: dict = {
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "reasoning_budget_message": "Thinking budget exceeded, please provide the final answer now.",
        # Setting this to False prevents the template from adding <think> tags
        "chat_template_kwargs": {"enable_thinking": enable_thinking}
    }

    # Add reasoning budget if specified (0 = disable, >0 = limit)
    if think_budget is not None:
        payload["reasoning_budget"] = think_budget

    if temperature is not None:
        payload["temperature"] = temperature
    
    if n_predict is not None:
        payload["max_tokens"] = _clamp_tokens(prompt, n_predict)

    # setdefault so anything set explicitly above still wins
    for key, value in SAMPLER.items():
        payload.setdefault(key, value)

    for attempt in range(max_retries):
        try:
            resp = _session().post(
                f"{LLAMA_URL}/v1/chat/completions",
                json=payload,
                timeout=LLM_TIMEOUT,
            )
            # print(json.dumps(resp.json())) 
            resp.raise_for_status()
            data = resp.json()
            
            # Note: Some models return reasoning in a separate "reasoning_content" field
            message = data["choices"][0]["message"]
            content = message.get("content", "")
            
            return content.strip()
        except Exception as e:
            print(f"  llama-server error (attempt {attempt + 1}): {e}")
            if attempt < max_retries - 1:
                # Back off — retrying instantly just piles load onto a server
                # that is already the bottleneck.
                time.sleep(min(2 ** attempt + random.uniform(0, 1), 15))
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
