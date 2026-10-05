#!/usr/bin/env python3
"""Offline evidence inventory only. No retrieval, approval promotion, or runtime eligibility."""
import hashlib
import json
import os
import re
import subprocess
import sys

import yaml  # Existing upstream knowledge lint dependency; missing dependency must fail closed.

FIELDS = ('id', 'knowledge_id', 'status', 'approval', 'approved', 'approved_by',
          'scope', 'qa_scope', 'client', 'project', 'project_id', 'studio_os_case_id',
          'channel', 'tags', 'supersedes', 'superseded_by')

class StrictLoader(yaml.SafeLoader):
    def compose_node(self, parent, index):
        if self.check_event(yaml.AliasEvent):
            raise ValueError('YAML_ALIAS_UNSUPPORTED')
        return super().compose_node(parent, index)

    def construct_mapping(self, node, deep=False):
        keys = set()
        for key, _ in node.value:
            if key.value == '<<':
                raise ValueError('YAML_MERGE_UNSUPPORTED')
            if key.value in keys:
                raise ValueError('DUPLICATE_METADATA_KEY')
            keys.add(key.value)
        return super().construct_mapping(node, deep)

# Preserve original date strings; never use an updated date as evidence of approval.
StrictLoader.yaml_implicit_resolvers = {
    key: [(tag, regex) for tag, regex in value if tag != 'tag:yaml.org,2002:timestamp']
    for key, value in yaml.SafeLoader.yaml_implicit_resolvers.items()
}

def git(checkout, *args):
    # Git >=2.48: missing promisor objects must fail, not trigger network retrieval.
    result = subprocess.run(['git', '--no-lazy-fetch', '-C', checkout, *args],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
                            env={**os.environ, 'GIT_NO_LAZY_FETCH': '1', 'GIT_TERMINAL_PROMPT': '0'})
    if result.returncode:
        raise ValueError('LOCAL_GIT_OBJECT_UNAVAILABLE')
    return result.stdout


def snapshot(spec):
    repo, rev, path = (spec.get(k) for k in ('repository', 'revision', 'path'))
    if not isinstance(repo, str) or not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError('INVALID_REPOSITORY')
    if not isinstance(rev, str) or not re.fullmatch(r'[0-9a-f]{40}', rev):
        raise ValueError('UNPINNED_REVISION')
    if (not isinstance(path, str) or not path or path.startswith(('/', '-')) or
        any(c in path for c in ('\\', ':', '\n', '\r', '\0')) or
        any(p in ('', '.', '..') for p in path.split('/'))):
        raise ValueError('INVALID_SOURCE_PATH')
    checkout = spec.get('checkout')
    if not isinstance(checkout, str):
        raise ValueError('MISSING_LOCAL_CHECKOUT')
    if git(checkout, 'cat-file', '-t', rev).strip() != b'commit':
        raise ValueError('REVISION_NOT_COMMIT')
    item = git(checkout, 'ls-tree', '-z', rev, '--', path).split(b'\0')[0]
    if not item:
        raise ValueError('MISSING_SOURCE')
    info, found_path = item.split(b'\t', 1)
    mode, kind, blob = info.split()
    if found_path.decode('utf-8') != path or mode not in (b'100644', b'100755') or kind != b'blob':
        raise ValueError('NOT_REGULAR_SOURCE')
    return git(checkout, 'cat-file', 'blob', blob.decode('ascii'))


def record(spec, raw):
    issues = []
    digest = hashlib.sha256(raw).hexdigest()
    expected = spec.get('expected_sha256')
    if expected is None:
        issues.append('EXPECTED_HASH_NOT_PROVIDED')
    elif not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
        issues.append('INVALID_EXPECTED_HASH')
    elif expected != digest:
        issues.append('HASH_MISMATCH')
    metadata = {}
    try:
        text = raw.decode('utf-8')
        match = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)', text, re.S)
        if not match:
            issues.append('FRONTMATTER_MISSING_OR_UNCLOSED')
        else:
            parsed = yaml.load(match.group(1), Loader=StrictLoader)
            if not isinstance(parsed, dict) or any(not isinstance(k, str) for k in parsed):
                raise ValueError('METADATA_NOT_MAPPING')
            metadata = {k: parsed[k] for k in FIELDS if k in parsed}
            # JSON-compatible scalar/list/map only; do not serialize custom objects or nonfinite numbers.
            json.dumps(metadata, allow_nan=False)
    except (UnicodeError, yaml.YAMLError, ValueError, TypeError) as error:
        code = str(error) if str(error) in {'YAML_ALIAS_UNSUPPORTED', 'YAML_MERGE_UNSUPPORTED',
                                          'DUPLICATE_METADATA_KEY', 'METADATA_NOT_MAPPING'} else 'METADATA_PARSE_ERROR'
        issues.append(code)
        metadata = {}
    for key in ('status', 'scope', 'qa_scope'):
        if key not in metadata or metadata[key] is None or metadata[key] == '':
            issues.append('MISSING_' + key.upper())
        elif not isinstance(metadata[key], str):
            issues.append('INVALID_' + key.upper())
    for key in ('id', 'knowledge_id', 'client', 'project', 'project_id', 'studio_os_case_id', 'channel'):
        if key in metadata and (not isinstance(metadata[key], str) or not metadata[key].strip()):
            issues.append('INVALID_' + key.upper())
    if not any(k in metadata for k in ('approval', 'approved', 'approved_by')):
        issues.append('APPROVAL_EVIDENCE_NOT_PROVIDED')
    else:
        issues.append('APPROVAL_METADATA_REQUIRES_REVIEW')
    status, scope = metadata.get('status'), metadata.get('qa_scope')
    if status is not None and status not in ('approved', 'validated', 'published', 'internal', 'draft', 'deprecated', 'archived'):
        issues.append('UNMAPPED_STATUS')
    if metadata.get('scope') is not None and metadata['scope'] not in ('internal', 'creator-ok', 'public'):
        issues.append('UNRESOLVED_VISIBILITY')
    if status in ('draft', 'deprecated', 'archived'):
        issues.append('NONFINAL_STATUS')
    if status == 'draft' and metadata.get('approved') is True or status == 'approved' and metadata.get('approved') is False:
        issues.append('STATUS_APPROVAL_CONFLICT')
    if scope not in (None, 'company', 'client', 'project'):
        issues.append('UNRESOLVED_QA_SCOPE')
    if scope == 'client' and not metadata.get('client'):
        issues.append('CLIENT_SCOPE_WITHOUT_CLIENT')
    project_ids = [metadata[k] for k in ('project', 'project_id', 'studio_os_case_id') if k in metadata]
    if scope == 'project' and not project_ids:
        issues.append('PROJECT_SCOPE_WITHOUT_PROJECT')
    if len(project_ids) > 1:
        issues.append('PROJECT_IDENTIFIERS_REQUIRE_MAPPING')
    if scope == 'company' and (metadata.get('client') or project_ids):
        issues.append('SCOPE_TARGET_CONFLICT')
    if scope != 'project' and project_ids:
        issues.append('PROJECT_SCOPE_UNRESOLVED')
    tags = metadata.get('tags')
    if isinstance(tags, list) and any(isinstance(t, str) and t.startswith('client/') for t in tags):
        # A tag is retained, never silently converted into the access-control client field.
        issues.append('CLIENT_TAG_REQUIRES_MAPPING')
    if metadata.get('supersedes') or metadata.get('superseded_by'):
        issues.append('REPLACEMENT_REQUIRES_REVIEW')
    return {'source': {k: spec[k] for k in ('repository', 'revision', 'path')},
            'sha256': digest, 'expected_sha256': expected,
            'metadata': {k: {'present': k in metadata, 'value': metadata.get(k)} for k in FIELDS},
            'issues': sorted(set(issues)), 'runtime_eligible': False}


def build_manifest(specs):
    records = []
    for spec in specs:
        raw = snapshot(spec)  # Invalid identity/missing bytes is a fatal error, not an empty source.
        records.append(record(spec, raw))
    groups = {}
    for entry in records:
        for field in ('id', 'knowledge_id'):
            value = entry['metadata'][field]['value']
            if isinstance(value, str) and value:
                groups.setdefault(value, []).append(entry)
    for group in groups.values():
        unique = {json.dumps(e['source'], sort_keys=True) for e in group}
        if len(unique) > 1:
            for entry in group:
                entry['issues'] = sorted(set(entry['issues'] + ['DUPLICATE_ID_REQUIRES_REVIEW']))
    records.sort(key=lambda e: (e['source']['repository'], e['source']['revision'], e['source']['path']))
    return {'schema': 'offline-source-manifest/v1', 'runtime_retrieval': False, 'records': records}


if __name__ == '__main__':
    try:
        specs = json.load(sys.stdin)
        if not isinstance(specs, list) or not specs or any(not isinstance(s, dict) for s in specs):
            raise ValueError('INVALID_INPUT')
        output = build_manifest(specs)
        print(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))
        sys.exit(2 if any(e['issues'] for e in output['records']) else 0)
    except (ValueError, TypeError, KeyError, OSError):
        print('source manifest failed: invalid input or unavailable local source; no manifest emitted', file=sys.stderr)
        sys.exit(1)
