#!/usr/bin/env python3
"""Parse ~/.accordo/mcp-debug.jsonl and print a human-readable summary."""
import sys, json, os

log_path = os.path.expanduser("~/.accordo/mcp-debug.jsonl")
time_filter = sys.argv[1] if len(sys.argv) > 1 else None

with open(log_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        if time_filter and time_filter not in line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue

        k = d.get("kind", "")
        ts = d.get("ts", "")[-12:]
        m = d.get("rpcMethod", "")
        s = (d.get("sessionId") or "")[:8]

        if k == "http_request":
            continue

        if k == "rpc_received":
            p = d.get("rpcParams", {}) or {}
            n = p.get("name", "") if isinstance(p, dict) else ""
            print(f"{ts} RECV  {m:25s} {n:30s} s={s}")
        elif k == "rpc_responded":
            e = d.get("rpcError")
            dur = d.get("durationMs", "")
            r = d.get("rpcResult", {}) or {}
            ie = r.get("isError", False) if isinstance(r, dict) else False
            cp = ""
            if isinstance(r, dict) and "content" in r:
                c = r["content"]
                if isinstance(c, list) and c:
                    cp = str(c[0].get("text", ""))[:80]
            ei = f" ERR={e}" if e else ""
            ii = " isError" if ie else ""
            print(f"{ts} RESP  {m:25s} {dur}ms{ei}{ii} {cp}")
        elif k == "tools_list_sent":
            print(f"{ts} TOOLS toolCount={d.get('toolCount', '')}")
        elif k == "sse_connect":
            print(f"{ts} SSE+  {d.get('connId', '')[:8]} agent={d.get('agent', '')}")
        elif k == "sse_disconnect":
            print(f"{ts} SSE-  {d.get('connId', '')[:8]}")
        elif k == "sse_notification":
            print(f"{ts} SSE!  {d.get('message', '')}")
        elif k == "initialize_sent":
            print(f"{ts} INIT  proto={d.get('protocolVersion', '')}")
        elif k == "error":
            print(f"{ts} ERROR {d.get('message', '')}")
        else:
            print(f"{ts} {k}")
