import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest


sys.dont_write_bytecode = True
ROOT = Path.home() / "Library/Application Support/Rhythm/creative-tools/openmontage"
os.environ.setdefault("OPENMONTAGE_ROOT", str(ROOT))
SPEC = importlib.util.spec_from_file_location(
    "openmontage_mcp_server", Path(__file__).with_name("openmontage_mcp_server.py")
)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def candidate(source, source_id="1"):
    return SimpleNamespace(
        clip_id=f"{source}_{source_id}", source=source, license=f"{source} license",
        creator="Creator", source_url=f"https://example.test/{source_id}",
        download_url=f"https://cdn.example.test/{source_id}.mp4",
        thumbnail_url=f"https://cdn.example.test/{source_id}.jpg", kind="video",
        width=1920, height=1080, duration=10.0, extra={"origin": source},
    )


class Source:
    def __init__(self, name, results=(), available=True, error=False):
        self.name, self.results, self.available, self.error = name, list(results), available, error
        self.calls = []

    def is_available(self):
        return self.available

    def search(self, query, filters):
        self.calls.append((query, filters.per_page))
        if self.error:
            raise RuntimeError("source failed")
        return self.results


class PrepareAssetsTests(unittest.TestCase):
    def prepare(self, sources, **arguments):
        return bridge.prepare_assets(
            {"queries": ["modern congregation"], "script_approved": True, **arguments}, sources
        )

    def test_script_approval_is_required_before_search(self):
        pexels = Source("pexels", [candidate("pexels")])
        result = bridge.prepare_assets({"queries": ["anything"], "script_approved": False}, [pexels])
        self.assertTrue(result["isError"])
        self.assertEqual(pexels.calls, [])

    def test_search_is_bounded_to_three_queries(self):
        result = bridge.prepare_assets(
            {"queries": ["one", "two", "three", "four"], "script_approved": True},
            [],
        )
        self.assertTrue(result["isError"])

    def test_pexels_is_preferred_and_stops_at_requested_count(self):
        pexels = Source("pexels", [candidate("pexels", "1"), candidate("pexels", "2")])
        archive = Source("archive_org", [candidate("archive_org")])
        result = self.prepare([pexels, archive], clips_per_query=1)
        self.assertEqual([row["provider"] for row in result["candidates"]], ["pexels"])
        self.assertEqual(pexels.calls, [("modern congregation", 1)])
        self.assertEqual(archive.calls, [])

    def test_no_key_uses_public_source_fallback(self):
        pexels = Source("pexels", available=False)
        archive = Source("archive_org", [candidate("archive_org")])
        result = self.prepare([pexels, archive])
        self.assertEqual(result["candidates"][0]["provider"], "archive_org")
        self.assertEqual(pexels.calls, [])

    def test_empty_or_failed_pexels_falls_back(self):
        for pexels in (Source("pexels"), Source("pexels", error=True)):
            with self.subTest(error=pexels.error):
                nasa = Source("nasa", [candidate("nasa")])
                result = self.prepare([pexels, nasa])
                self.assertEqual(result["candidates"][0]["provider"], "nasa")

    def test_preserves_review_metadata_without_downloading(self):
        result = self.prepare([Source("pexels", [candidate("pexels")])])
        row = result["candidates"][0]
        self.assertEqual(row["license"], "pexels license")
        self.assertEqual(row["creator"], "Creator")
        self.assertEqual(row["original_source_url"], "https://example.test/1")
        self.assertEqual(row["preview_url"], "https://cdn.example.test/1.jpg")
        self.assertIsNone(row["local_path"])
        self.assertFalse(result["rendered"])
        self.assertFalse(result["published"])


if __name__ == "__main__":
    unittest.main()
