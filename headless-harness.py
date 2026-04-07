#!/usr/bin/env python3
"""BELLA Headless Harness — fires fast-intel, simulates multi-turn conversation, captures BELLA_SAID."""

import json, subprocess, sys, time, urllib.request, urllib.error

FAST_INTEL_URL = "https://fast-intel-v9-rescript.trentbelasco.workers.dev"
BRIDGE_URL = "https://deepgram-bridge-v2-rescript.trentbelasco.workers.dev"
KV_NS = "0fec6982d8644118aba1830afd4a58cb"

WEBSITE = sys.argv[1] if len(sys.argv) > 1 else "https://www.pitcherpartners.com.au"
FIRST_NAME = sys.argv[2] if len(sys.argv) > 2 else "Trent"
LID = f"anon_harness_{int(time.time())}"

TURNS = [
    "Hello?",
    "Yeah hi, who's this?",
    "Oh okay, what's this about?",
    "Yeah we've been looking at a few things actually",
    "We get about fifty leads a month, maybe sixty",
    "Probably about two hundred thousand a year per client",
    "We have someone on the phones but they're not great honestly",
    "Yeah that sounds interesting, what would that look like?",
]


def post_json(url, body, timeout=60):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode()
    except urllib.error.HTTPError as e:
        return f"HTTP_ERROR_{e.code}: {e.read().decode()[:200]}"
    except Exception as e:
        return f"ERROR: {e}"


def parse_sse(raw):
    """Extract content from SSE stream response."""
    text = ""
    for line in raw.split("\n"):
        line = line.strip()
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        try:
            chunk = json.loads(line[6:])
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            content = delta.get("content", "")
            if content:
                text += content
        except (json.JSONDecodeError, IndexError, KeyError):
            pass
    return text.strip()


def kv_get(key):
    try:
        result = subprocess.run(
            ["npx", "wrangler", "kv", "key", "get", key,
             "--namespace-id", KV_NS, "--remote"],
            capture_output=True, text=True, timeout=30,
            cwd="/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM"
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


print("=" * 50)
print("BELLA HEADLESS HARNESS")
print("=" * 50)
print(f"LID:      {LID}")
print(f"Website:  {WEBSITE}")
print(f"Name:     {FIRST_NAME}")
print("=" * 50)
print()

# ── STEP 1: Fire fast-intel ──
print("[STEP 1] Firing fast-intel...")
fi_result = post_json(f"{FAST_INTEL_URL}/fast-intel", {
    "lid": LID, "websiteUrl": WEBSITE, "firstName": FIRST_NAME
}, timeout=120)

try:
    fi_data = json.loads(fi_result)
    biz_name = fi_data.get("business_name", "UNKNOWN")
    print(f"[STEP 1] Done. Business: {biz_name}")
except:
    biz_name = "UNKNOWN"
    print(f"[STEP 1] WARNING: {fi_result[:200]}")
print()

# ── STEP 2: Verify KV ──
print("[STEP 2] Checking KV...")
time.sleep(2)

stage_plan = kv_get(f"lead:{LID}:stage_plan")
if stage_plan:
    print(f"[STEP 2] stage_plan: {stage_plan}")
else:
    print("[STEP 2] WARNING: stage_plan NOT FOUND")
print()

# ── STEP 3: Simulate conversation ──
print("[STEP 3] Starting conversation...")
print("=" * 50)

system_msg = f"You are Bella, an AI sales development representative. lead_id: {LID}. prospect_first_name: {FIRST_NAME}. prospect_business: {biz_name}."

messages = []
transcript = []

for i, utterance in enumerate(TURNS, 1):
    print(f"\n--- Turn {i} ---")
    print(f"PROSPECT: {utterance}")

    messages.append({"role": "user", "content": utterance})

    body = {
        "messages": [{"role": "system", "content": system_msg}] + messages,
        "model": "bella",
        "stream": True,
    }

    raw = post_json(f"{BRIDGE_URL}/v9/chat/completions", body, timeout=30)

    if raw.startswith("ERROR") or raw.startswith("HTTP_ERROR"):
        bella_said = f"[{raw[:150]}]"
    else:
        bella_said = parse_sse(raw)
        if not bella_said:
            # Maybe non-SSE response (error JSON?)
            try:
                err = json.loads(raw)
                bella_said = f"[BRIDGE_ERROR: {json.dumps(err)[:150]}]"
            except:
                bella_said = "[EMPTY RESPONSE]"

    print(f"BELLA: {bella_said}")

    messages.append({"role": "assistant", "content": bella_said})
    transcript.append({"turn": i, "prospect": utterance, "bella": bella_said})

# ── STEP 4: Full transcript ──
print()
print("=" * 50)
print("FULL BELLA_SAID TRANSCRIPT")
print("=" * 50)
for t in transcript:
    print(f"\n--- Turn {t['turn']} ---")
    print(f"PROSPECT: {t['prospect']}")
    print(f"BELLA: {t['bella']}")

# ── STEP 5: Post-call state ──
print()
print("=" * 50)
print("POST-CALL KV STATE")
print("=" * 50)

for key_suffix in ["script_state", "captured_inputs", "conv_memory"]:
    val = kv_get(f"lead:{LID}:{key_suffix}")
    if val:
        print(f"\n{key_suffix}:")
        try:
            print(json.dumps(json.loads(val), indent=2))
        except:
            print(val[:500])
    else:
        print(f"\n{key_suffix}: NOT_FOUND")

print(f"\nBrain debug: curl https://bella-brain-v8.trentbelasco.workers.dev/debug?callId={LID}")
print(f"\nLID: {LID}")
print("Done.")
