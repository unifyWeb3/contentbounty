import json
from pathlib import Path

import pytest

from scripts.prepare_evidence import normalize_evidence, prepare_evidence


FIXTURE = json.loads(
    Path("tests/fixtures/evidence_preparation.json").read_text(encoding="utf-8")
)
LIVE_ADVERSARIAL_MANIFEST = json.loads(
    Path("tests/fixtures/live/adversarial_rejection_v1.json").read_text(encoding="utf-8")
)


def test_prepared_fixture_is_exact_and_reproducible():
    prepared = prepare_evidence(FIXTURE["uri"], FIXTURE["rendered_text"])
    assert prepared == {
        "format": "content-bounty-text-v1",
        "uri": FIXTURE["uri"],
        "sha256": FIXTURE["sha256"],
        "char_count": FIXTURE["char_count"],
        "utf8_byte_count": FIXTURE["utf8_byte_count"],
        "canonical_text": FIXTURE["canonical_text"],
    }
    assert normalize_evidence(FIXTURE["canonical_text"]) == FIXTURE["canonical_text"]


def test_preparer_rejects_noncanonical_inputs():
    with pytest.raises(ValueError, match="HTTPS"):
        prepare_evidence("http://example.com/evidence.txt", "evidence")
    with pytest.raises(ValueError, match="empty"):
        prepare_evidence(FIXTURE["uri"], " \r\n ")
    with pytest.raises(ValueError, match="exceeds"):
        prepare_evidence(FIXTURE["uri"], "x" * 16_001)


def test_live_adversarial_fixture_matches_contract_normalization_manifest():
    content = Path(LIVE_ADVERSARIAL_MANIFEST["text_path"]).read_text(encoding="utf-8")
    prepared = prepare_evidence("https://fixtures.invalid/adversarial.txt", content)
    assert prepared["sha256"] == LIVE_ADVERSARIAL_MANIFEST["expected_normalized_sha256"]
    assert prepared["char_count"] == LIVE_ADVERSARIAL_MANIFEST["character_count"]
    assert prepared["utf8_byte_count"] == LIVE_ADVERSARIAL_MANIFEST["utf8_byte_count"]
    assert prepared["canonical_text"] == normalize_evidence(content)
