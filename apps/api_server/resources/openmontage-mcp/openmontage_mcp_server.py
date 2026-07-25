#!/usr/bin/env python3
"""Tiny stdio bridge for the locally installed OpenMontage runtime."""
import json
import sys

TOOLS = [{"name": "openmontage_status", "description": "Report the local OpenMontage root.", "inputSchema": {"type": "object", "properties": {}}}]

for line in sys.stdin:
    try:
        request = json.loads(line)
        method = request.get("method")
        if method == "initialize": result = {"protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"), "capabilities": {"tools": {}}, "serverInfo": {"name": "rhythm-openmontage", "version": "1"}}
        elif method == "tools/list": result = {"tools": TOOLS}
        elif method == "tools/call": result = {"content": [{"type": "text", "text": "OpenMontage is installed locally."}]}
        else: continue
        print(json.dumps({"jsonrpc": "2.0", "id": request.get("id"), "result": result}), flush=True)
    except (ValueError, TypeError):
        continue
