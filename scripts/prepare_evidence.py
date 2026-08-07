#!/usr/bin/env python3
"""Prepare canonical raw-text evidence using ContentBounty v2 normalization."""

import argparse
import hashlib
import json
from pathlib import Path


MAX_EVIDENCE_CHARS = 16_000


def normalize_evidence(content: str) -> str:
    return content.replace("\r\n", "\n").replace("\r", "\n").strip()


def prepare_evidence(uri: str, content: str) -> dict:
    normalized_uri = uri.strip()
    if not normalized_uri.startswith("https://"):
        raise ValueError("Evidence URI must use HTTPS")
    if any(character in normalized_uri for character in (" ", "\n", "\r")):
        raise ValueError("Evidence URI contains whitespace")

    canonical_text = normalize_evidence(content)
    if not canonical_text:
        raise ValueError("Canonical evidence is empty")
    if len(canonical_text) > MAX_EVIDENCE_CHARS:
        raise ValueError(f"Canonical evidence exceeds {MAX_EVIDENCE_CHARS} characters")

    canonical_bytes = canonical_text.encode("utf-8")
    return {
        "format": "content-bounty-text-v1",
        "uri": normalized_uri,
        "sha256": hashlib.sha256(canonical_bytes).hexdigest(),
        "char_count": len(canonical_text),
        "utf8_byte_count": len(canonical_bytes),
        "canonical_text": canonical_text,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Normalize a UTF-8 raw-text evidence file exactly like ContentBounty v2. "
            "Publish the canonical bytes at the supplied stable, content-addressed HTTPS URI."
        ),
    )
    parser.add_argument("--uri", required=True, help="Final content-addressed HTTPS evidence URI")
    parser.add_argument("--file", required=True, type=Path, help="UTF-8 source text file")
    parser.add_argument(
        "--write-canonical",
        type=Path,
        help="Optional path for the exact normalized UTF-8 bytes to publish",
    )
    args = parser.parse_args()

    source = args.file.read_text(encoding="utf-8")
    prepared = prepare_evidence(args.uri, source)
    if args.write_canonical is not None:
        args.write_canonical.write_bytes(prepared["canonical_text"].encode("utf-8"))
    print(json.dumps(prepared, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
