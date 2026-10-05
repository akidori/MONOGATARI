import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from source_manifest import build_manifest, record, snapshot


class SourceManifestTests(unittest.TestCase):
    def setUp(self):
        self.spec = {'repository': 'fixture/knowledge', 'revision': 'a' * 40, 'path': 'approved/latest.md'}

    def document(self, metadata):
        return ('---\n' + metadata + '\n---\nSynthetic rule only.\n').encode()

    def entry(self, metadata, **extra):
        raw = self.document(metadata)
        return record({**self.spec, 'expected_sha256': hashlib.sha256(raw).hexdigest(), **extra}, raw)

    def test_no_filename_or_date_approval(self):
        r = self.entry('updated: 2099-01-01\nscope: public')
        self.assertFalse(r['metadata']['status']['present'])
        self.assertIn('MISSING_STATUS', r['issues'])
        self.assertFalse(r['runtime_eligible'])

    def test_preserve_original_statuses_without_promotion(self):
        for status in ['draft', 'validated', 'published', 'internal', 'approved', 'archived', 'unknown']:
            with self.subTest(status=status):
                r = self.entry(f'status: {status}\nscope: internal\nqa_scope: company')
                self.assertEqual(r['metadata']['status']['value'], status)
                self.assertFalse(r['runtime_eligible'])
                self.assertIn('APPROVAL_EVIDENCE_NOT_PROVIDED', r['issues'])
        self.assertIn('NONFINAL_STATUS', self.entry('status: draft')['issues'])
        self.assertIn('UNMAPPED_STATUS', self.entry('status: unknown')['issues'])

    def test_conflicting_approval(self):
        r = self.entry('status: draft\napproved: true\napproved_by: synthetic-reviewer')
        self.assertIn('STATUS_APPROVAL_CONFLICT', r['issues'])
        self.assertIs(r['metadata']['approved']['value'], True)
        self.assertEqual(r['metadata']['status']['value'], 'draft')

    def test_missing_different_from_explicit_null(self):
        r = self.entry('status: draft\nclient: null')
        self.assertEqual(r['metadata']['client'], {'present': True, 'value': None})
        self.assertEqual(r['metadata']['project'], {'present': False, 'value': None})
        self.assertIn('INVALID_CLIENT', r['issues'])

    def test_scopes_never_inferred_or_merged(self):
        r = self.entry('status: validated\nscope: public\nqa_scope: company\nclient: synthetic-a')
        self.assertIn('SCOPE_TARGET_CONFLICT', r['issues'])
        self.assertEqual(r['metadata']['client']['value'], 'synthetic-a')
        self.assertIn('CLIENT_SCOPE_WITHOUT_CLIENT', self.entry('qa_scope: client')['issues'])
        self.assertIn('PROJECT_SCOPE_WITHOUT_PROJECT', self.entry('qa_scope: project')['issues'])
        self.assertIn('PROJECT_IDENTIFIERS_REQUIRE_MAPPING', self.entry('qa_scope: project\nproject: x\nstudio_os_case_id: y')['issues'])
        tagged = self.entry('tags: [client/synthetic-a]')
        self.assertIsNone(tagged['metadata']['client']['value'])
        self.assertIn('CLIENT_TAG_REQUIRES_MAPPING', tagged['issues'])

    def test_duplicate_and_unsafe_yaml_fail_closed(self):
        cases = [('status: draft\nstatus: approved', 'DUPLICATE_METADATA_KEY'),
                 ('status: &x approved\nclient: *x', 'YAML_ALIAS_UNSUPPORTED'),
                 ('<<: {status: approved}', 'YAML_MERGE_UNSUPPORTED'),
                 ('status: [', 'METADATA_PARSE_ERROR'),
                 ('status: !!python/object/apply:os.system [echo nope]', 'METADATA_PARSE_ERROR')]
        for value, issue in cases:
            with self.subTest(issue=issue):
                r = self.entry(value)
                self.assertIn(issue, r['issues'])
                self.assertFalse(r['metadata']['status']['present'])
                self.assertFalse(r['runtime_eligible'])

    def test_hash_exact_bytes(self):
        r = self.entry('status: approved', expected_sha256='0' * 64)
        self.assertIn('HASH_MISMATCH', r['issues'])
        self.assertNotEqual(r['sha256'], r['expected_sha256'])
        self.assertIn('INVALID_EXPECTED_HASH', self.entry('status: approved', expected_sha256='bad')['issues'])
        self.assertIn('EXPECTED_HASH_NOT_PROVIDED', record(self.spec, b'no frontmatter')['issues'])

    def test_invalid_field_types_not_coerced(self):
        r = self.entry('status: [approved]\nscope: {public: yes}\nqa_scope: false\nclient: [a, b]')
        for key in ['STATUS', 'SCOPE', 'QA_SCOPE', 'CLIENT']:
            self.assertIn('INVALID_' + key, r['issues'])
        self.assertEqual(r['metadata']['client']['value'], ['a', 'b'])

    def test_replacement_never_applied(self):
        r = self.entry('status: draft\nsupersedes: stable-rule')
        self.assertIn('REPLACEMENT_REQUIRES_REVIEW', r['issues'])
        self.assertEqual(r['metadata']['supersedes']['value'], 'stable-rule')

    def test_git_replace_cannot_change_pinned_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                return subprocess.check_output(['git', '-C', tmp, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            revisions = []
            for status in ('draft', 'approved'):
                Path(tmp, 'rule.md').write_bytes(self.document(f'id: synthetic-rule\nstatus: {status}'))
                git('add', 'rule.md')
                git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', status)
                revisions.append(git('rev-parse', 'HEAD'))
            original, replacement = revisions
            raw = self.document('id: synthetic-rule\nstatus: draft')
            spec = {**self.spec, 'checkout': tmp, 'revision': original, 'path': 'rule.md',
                    'expected_sha256': hashlib.sha256(raw).hexdigest()}
            baseline = build_manifest([spec])
            # Exercise replacements independently at every object read layer.
            pairs = [(kind, git('rev-parse', original + suffix), git('rev-parse', replacement + suffix))
                     for kind, suffix in [('commit', ''), ('tree', '^{tree}'), ('blob', ':rule.md')]]
            for kind, old, new in pairs:
                with self.subTest(kind=kind):
                    git('replace', old, new)
                    try:
                        # Control: ordinary Git reads really see the replaced bytes.
                        self.assertIn('status: approved', git('show', original + ':rule.md'))
                        self.assertEqual(snapshot(spec), raw)
                        self.assertEqual(build_manifest([spec]), baseline)
                    finally:
                        git('replace', '-d', old)

    def test_actual_local_git_pinning_and_determinism(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                return subprocess.check_output(['git', '-C', tmp, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            for name, client in [('one.md', 'synthetic-a'), ('two.md', 'synthetic-b')]:
                Path(tmp, name).write_bytes(self.document(f'id: shared-rule\nstatus: validated\nscope: internal\nqa_scope: client\nclient: {client}'))
            Path(tmp, 'link.md').symlink_to('one.md')
            git('add', '.')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')
            rev = git('rev-parse', 'HEAD')
            specs = [{**self.spec, 'checkout': tmp, 'revision': rev, 'path': name} for name in ['one.md', 'two.md']]
            manifest = build_manifest(specs)
            self.assertEqual(manifest, build_manifest(list(reversed(specs))))
            self.assertFalse(manifest['runtime_retrieval'])
            self.assertEqual([r['metadata']['client']['value'] for r in manifest['records']], ['synthetic-a', 'synthetic-b'])
            for r in manifest['records']:
                self.assertIn('DUPLICATE_ID_REQUIRES_REVIEW', r['issues'])
                self.assertNotIn(tmp, json.dumps(r))
                self.assertNotIn('Synthetic rule only.', json.dumps(r))
            Path(tmp, 'one.md').write_text('dirty working copy must not be read')
            self.assertEqual(manifest, build_manifest(specs))
            for change in [{'revision': 'HEAD'}, {'path': '../one.md'}, {'path': 'link.md'}, {'path': 'missing.md'}]:
                with self.subTest(change=change), self.assertRaises(ValueError):
                    snapshot({**specs[0], **change})
            # Prove missing objects fail locally: no fallback to working-copy bytes.
            blob = git('rev-parse', rev + ':one.md')
            Path(tmp, '.git/objects', blob[:2], blob[2:]).unlink()
            with self.assertRaises(ValueError):
                snapshot(specs[0])


if __name__ == '__main__':
    unittest.main()
