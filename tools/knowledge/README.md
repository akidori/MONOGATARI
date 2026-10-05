# Offline source-manifest prototype

This tool inventories pinned local Git blobs for editorial review. It does not
retrieve runtime knowledge, approve sources, rank rules, or change any application
behavior. Every record has `runtime_eligible: false`.

Requires Python 3, PyYAML (tested with the existing 6.0.3 installation; also used by
the knowledge repository's linter), and Git supporting `--no-lazy-fetch` (tested
with 2.52.0). No npm dependencies or runtime imports are added.

```sh
python3 -m unittest discover -s tools/knowledge -p 'test_*.py' -v
python3 tools/knowledge/source_manifest.py < /tmp/sources.json > /tmp/manifest.json
```

Input is a nonempty JSON array. Supply an existing local checkout, full commit SHA,
relative regular-file path, repository label, and optionally an independently
recorded SHA-256 of the original bytes:

```json
[
  {
    "repository": "akidori/MONOGATARI",
    "checkout": "/path/to/MONOGATARI",
    "revision": "a8cd10d9c59013c7b38c3156c0f2317830681230",
    "path": "knowledge/SCRIPT_PRODUCTION_MANUAL_V1.md",
    "expected_sha256": "c852c432b2291f89ee2a2c7fac53935f162614886ce8545c92288b1cfe9d639c"
  }
]
```

Missing objects fail locally; the tool never fetches. All Git reads disable object
replacement (`GIT_NO_REPLACE_OBJECTS=1`), so local `refs/replace` cannot substitute
commit, tree, or blob contents under a pinned identity. Dirty working files, symlinks,
branch names, and traversal paths are not accepted as source bytes. The repository
label is supplied by the operator; it is not authenticated against a remote.
Output contains pinned identity, exact-byte SHA-256, selected original metadata,
and sorted review issues, but no document bodies or local checkout paths.
Do not feed customer metadata into a manifest destined for another repository.

Exit codes: `1` means invalid input/unavailable source with no manifest emitted;
`2` means a manifest was emitted with unresolved review issues; `0` means no issues.
This prototype always records missing approval evidence or an approval-review hold,
so successful inventories currently exit `2`. This is not a deployment gate.

## Interpretation and limits

- Absent and explicit null metadata remain distinguishable. Status strings are
  preserved: `approved`, `validated`, `internal`, and `published` are not equated.
  File names, dates, tags, or a recent commit never imply approval.
- `scope` is visibility; `qa_scope` is applicability. Client/project identifiers
  remain explicit and are never inferred from folders or combined across sources.
- Duplicate YAML keys, aliases, merge keys, and invalid YAML discard parsed
  metadata with an issue. The pinned original and its hash remain available for
  inspection; no source is rewritten.
- Duplicate IDs across sources and explicit approval/scope contradictions are
  flagged. Supersession is recorded for review, never applied automatically.
  This is metadata validation, not semantic detection of conflicting prose.
- This is not a complete schema validator or an access-control implementation.
  Approval evidence format, accepted status mappings, identifier mappings, and
  conflict resolution need editorial decisions before any runtime integration.

## Read-only evidence

`observed-sources.json` records seven generic documents at MONOGATARI
`a8cd10d9c59013c7b38c3156c0f2317830681230` and birdflip-knowledge
`042c6ba9dd9435e147a61b2430bc36ab166c0708`. It contains selected observations, not
full CLI output. The hashes were measured from those same blobs, so matching them
demonstrates reproducibility, not independent approval. No customer documents or
source bodies were copied.

At the pinned MONOGATARI revision, agent QA uses four bundled documents plus case
context and case/channel-scoped KV additions. The separate `/api/knowledge` path
serves learning content and is not that QA retrieval path. This prototype tests
neither live KV data nor that service. The knowledge repository's Frontmatter v2
document itself says `draft`; its vocabulary is observed, not promoted to policy.

Tests use synthetic documents and temporary local repositories. They cover pinned
bytes, missing blobs, dirty-worktree isolation, hash mismatches, malformed YAML,
approval conflicts, missing/type-invalid metadata, scope separation, supersession,
and deterministic output. No LLM/API, browser, production, or end-to-end runtime
checks are needed or claimed for this offline-only change.
