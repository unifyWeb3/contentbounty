"""Test-suite configuration shared by Direct and integration tests."""

import os
import sys
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def optional_local_genvm_sdk(monkeypatch):
    """Use an explicitly supplied official GenVM source checkout.

    Normal CI and developer runs use genlayer-test's versioned artifact cache.
    `GENVM_PY_STD_SOURCE` is a local-only escape hatch for constrained
    environments where downloading the complete all-runners archive is much
    slower than a sparse official source checkout.
    """

    source = os.environ.get("GENVM_PY_STD_SOURCE")
    if not source:
        yield
        return

    runner_root = Path(source).resolve()
    sdk_source = runner_root / "src"
    embeddings_source = runner_root / "src-emb"
    if not (sdk_source / "genlayer").is_dir():
        raise RuntimeError(f"Invalid GENVM_PY_STD_SOURCE: {runner_root}")

    from gltest.direct import sdk_loader

    def setup_sdk_paths(contract_path=None, version=None):
        added = []
        for path in (sdk_source, embeddings_source):
            if path.is_dir() and str(path) not in sys.path:
                sys.path.insert(0, str(path))
                added.append(path)
        return added

    monkeypatch.setattr(sdk_loader, "setup_sdk_paths", setup_sdk_paths)
    yield

    roots = (str(sdk_source), str(embeddings_source))
    for module_name, module in list(sys.modules.items()):
        module_file = getattr(module, "__file__", None) or ""
        if module_file.startswith(roots):
            sys.modules.pop(module_name, None)
    sys.path[:] = [path for path in sys.path if path not in roots]
