#!/usr/bin/env python3
"""Small stdio bridge for the locally installed OpenMontage runtime."""
import json
import os
import sys


ROOT = os.environ.get("OPENMONTAGE_ROOT")
if ROOT and ROOT not in sys.path:
    sys.path.insert(0, ROOT)

TOOLS = [
    {"name": "openmontage_status", "description": "Report the local OpenMontage root.", "inputSchema": {"type": "object", "properties": {}}},
    {
        "name": "openmontage_prepare_zero_key_assets",
        "description": "Prepare review candidates only; requires script approval and never downloads, renders, or publishes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "queries": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
                "clips_per_query": {"type": "integer", "minimum": 1, "maximum": 3},
                "script_approved": {"type": "boolean"},
            },
            "required": ["queries", "script_approved"],
        },
    },
]


def _sources():
    from tools.video.stock_sources import get_source
    return [
        get_source(name)
        for name in (
            "pexels",
            "wikimedia",
            "nasa",
            "nara",
            "loc",
            "archive_org",
            "pond5_pd",
        )
    ]


def _candidate(candidate):
    return {
        "id": candidate.clip_id, "provider": candidate.source, "source": candidate.source,
        "license": candidate.license, "creator": candidate.creator,
        "original_source_url": candidate.source_url, "download_url": candidate.download_url,
        "preview_url": candidate.thumbnail_url, "local_path": None, "kind": candidate.kind,
        "width": candidate.width, "height": candidate.height, "duration": candidate.duration,
        "metadata": candidate.extra,
    }


def _usable(candidate):
    return bool(candidate.source_url and candidate.download_url)


def prepare_assets(arguments, sources=None):
    if not isinstance(arguments, dict):
        return {"isError": True, "error": "arguments must be an object"}
    if arguments.get("script_approved") is not True:
        return {"isError": True, "error": "script_approved must be true before footage search"}
    queries = arguments.get("queries")
    if not isinstance(queries, list) or not 1 <= len(queries) <= 3 or not all(isinstance(query, str) and query.strip() for query in queries):
        return {"isError": True, "error": "queries must contain one through three search phrases"}
    per_query = arguments.get("clips_per_query", 1)
    if not isinstance(per_query, int) or isinstance(per_query, bool) or not 1 <= per_query <= 3:
        return {"isError": True, "error": "clips_per_query must be an integer from 1 through 3"}

    from tools.video.stock_sources import SearchFilters
    providers = sources if sources is not None else _sources()
    pexels = next((source for source in providers if source.name == "pexels" and source.is_available()), None)
    fallback = [source for source in providers if source.name != "pexels"]
    candidates = []
    for query in queries[:3]:
        remaining = per_query
        for source in ([pexels] if pexels else []) + fallback:
            if remaining == 0:
                break
            try:
                found = source.search(query.strip(), SearchFilters(kind="video", per_page=remaining))
            except Exception:
                continue
            for item in found:
                if _usable(item):
                    candidates.append(_candidate(item))
                    remaining -= 1
                    if remaining == 0:
                        break
    return {"candidates": candidates, "script_approved": True, "rendered": False, "published": False}


def call_tool(name, arguments):
    if name == "openmontage_status":
        return {"content": [{"type": "text", "text": "OpenMontage is installed locally."}]}
    if name == "openmontage_prepare_zero_key_assets":
        result = prepare_assets(arguments)
        return {"isError": result.get("isError", False), "content": [{"type": "text", "text": json.dumps(result)}]}
    return {"isError": True, "content": [{"type": "text", "text": "Unknown tool."}]}


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            method = request.get("method")
            if method == "initialize": result = {"protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"), "capabilities": {"tools": {}}, "serverInfo": {"name": "rhythm-openmontage", "version": "1"}}
            elif method == "tools/list": result = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params", {})
                result = call_tool(params.get("name"), params.get("arguments", {}))
            else: continue
            print(json.dumps({"jsonrpc": "2.0", "id": request.get("id"), "result": result}), flush=True)
        except (ValueError, TypeError):
            continue


if __name__ == "__main__":
    main()
