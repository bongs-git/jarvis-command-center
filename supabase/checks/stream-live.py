#!/usr/bin/env python3
"""Measure receipt of the first real spoken delta and verify the final SSE envelope."""
import json
import os
import time
import urllib.request

key = os.environ["ANON_KEY"]
headers = {"apikey": key, "Authorization": "Bearer " + os.environ.get("USER_JWT", key),
           "Content-Type": "application/json", "Accept": "text/event-stream"}
if os.environ.get("INDAI_PASSCODE"):
    headers["x-indai-pass"] = os.environ["INDAI_PASSCODE"]
request = urllib.request.Request(
    os.environ["BASE"].rstrip("/") + "/functions/v1/indai-brain",
    data=json.dumps({"mode": "talk", "stream": True, "search": False, "question": "Say good morning.",
                     "session": "acceptance"}).encode(), headers=headers)
start = time.monotonic()
chunks, first, final, done = [], None, None, False
with urllib.request.urlopen(request, timeout=30) as response:
    if response.headers.get_content_type() != "text/event-stream":
        raise SystemExit("The deployed function did not return text/event-stream.")
    for line in response:
        if not line.startswith(b"data:"):
            continue
        value = line[5:].strip()
        if value == b"[DONE]":
            done = True
            break
        frame = json.loads(value)
        if "delta" in frame:
            if final is not None:
                raise SystemExit("Speech arrived after the final envelope.")
            chunks.append(frame["delta"])
            if first is None and frame["delta"]:
                first = time.monotonic() - start
        elif "result" in frame and final is None:
            final = frame
        else:
            raise SystemExit("Unexpected SSE frame: " + str(frame.get("error", "invalid_shape")))
if not done or not final or first is None or not isinstance(final.get("remembered"), list):
    raise SystemExit("Incomplete stream.")
if "".join(chunks) != final["result"]["spoken"]:
    raise SystemExit("Deltas differ from the final spoken reply.")
print(f"First spoken delta {first:.3f}s. Received {len(chunks)} deltas, one final envelope and DONE.")
raise SystemExit(0 if first < 1 else 1)
