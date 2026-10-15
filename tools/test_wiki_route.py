"""Navigation acceptance: real questions and isolated drift/fallback fixtures.

Run from the repository root: python -m unittest discover -s tools -p test_wiki_route.py
No application execution or external requests.
"""
import json
import contextlib
import io
from pathlib import Path
import tempfile
import unittest

import wiki_route as router


class WikiRouteAcceptance(unittest.TestCase):
    def test_real_engineering_questions(self):
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / 'docs/wiki/routes.json').read_text(encoding='utf-8'))
        questions = {
            '换一个文献源，不支持全量计数怎么办': 'external-source',
            '公共接口的客户端错误应该怎样保留': 'public-api',
            '要替换数据库接口和缓存接口': 'host-ports',
            '修改模型贡献的交换包': 'tagger-contribution',
            '修改标签裁决和审核规则': 'ledger-policy',
            '为什么账本应用后标签漏项': 'ledger-integration',
            '修改标签归一后如何迁移': 'tag-normalization',
            '设置接口的热更新': 'settings-contract',
            '破坏性变更和包导出': 'compatibility',
            '外部请求重试和预算': 'external-transport',
        }
        for question, expected in questions.items():
            with self.subTest(question=question):
                hits = router.rank(question, manifest['routes'])
                self.assertTrue(hits)
                self.assertEqual(hits[0]['id'], expected)
                resolved = router.resolve(root, dict(manifest, routes=[hits[0]]))[0]
                self.assertTrue(resolved['locations'])

    def test_moved_typescript_declaration_and_missing_or_duplicate_symbol(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'ports.ts'
            entry = {'path': 'ports.ts', 'needle': 'export interface ExternalEvidenceSource'}
            source.write_text('export interface ExternalEvidenceSource {}\n', encoding='utf-8')
            first = router.source(root, entry)
            source.write_text('// inserted\n\nexport interface ExternalEvidenceSource {}\n', encoding='utf-8')
            moved = router.source(root, entry)
            self.assertEqual((first['line'], moved['line']), (1, 3))
            self.assertNotEqual(first['sha256'], moved['sha256'])
            for text in ['// removed\n', 'export interface ExternalEvidenceSource {}\n' * 2]:
                source.write_text(text, encoding='utf-8')
                with self.assertRaises(ValueError):
                    router.source(root, entry)

    def test_wrong_document_anchor_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'map.md').write_text('<a id="real-port"></a>\n# Map\n', encoding='utf-8')
            manifest = {'schema_version': 1, 'project': 'fixture', 'routes': [
                {'id': 'port', 'boundary': 'navigation only', 'docs': ['map.md#missing-port']}
            ]}
            with self.assertRaises(ValueError):
                router.resolve(root, manifest)

    def test_unknown_question_has_no_guessed_location(self):
        self.assertEqual(router.rank('unmapped_xyz', [
            {'id': 'public-api', 'title': 'HTTP', 'aliases': ['客户端错误']}
        ]), [])

    def test_snapshot_drift_fails_check_and_line_endings_are_portable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs/wiki').mkdir(parents=True)
            source = root / 'ports.ts'
            source.write_bytes(b'export interface Port {}\r\n')
            manifest = {'schema_version': 1, 'project': 'fixture', 'routes': [
                {'id': 'port', 'title': 'Port', 'boundary': 'navigation only',
                 'sources': [{'path': 'ports.ts', 'needle': 'export interface Port'}], 'docs': []}
            ]}
            (root / 'docs/wiki/routes.json').write_text(json.dumps(manifest), encoding='utf-8')
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(router.main(['--root', str(root), '--check']), 1)
                self.assertEqual(router.main(['--root', str(root), '--build']), 0)
                self.assertEqual(router.main(['--root', str(root), '--check']), 0)
                source.write_bytes(b'export interface Port {}\n')
                self.assertEqual(router.main(['--root', str(root), '--check']), 0)
                source.write_bytes(b'// inserted\nexport interface Port {}\n')
                self.assertEqual(router.main(['--root', str(root), '--check']), 1)


if __name__ == '__main__':
    unittest.main()
