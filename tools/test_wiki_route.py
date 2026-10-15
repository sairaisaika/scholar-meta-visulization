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
import wiki as precise
import copy
from unittest.mock import patch
import hashlib
import re


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

    def test_schema_two_quality_navigation_and_saved_render_sources(self):
        root = Path(__file__).resolve().parents[1]
        manifest = precise.load(root)
        self.assertEqual(manifest['schema_version'], 2)
        self.assertTrue(precise.audit(root, manifest)['ready'])
        self.assertFalse(precise.is_stale(root, precise.snapshot(root, manifest)))
        report = precise.evaluate(root, manifest, precise.read_json(root / 'docs/wiki/navigation-tasks.json'))
        self.assertTrue(report['passed'])
        plan = next(row for row in manifest['routes'] if row['id'] == 'interface-plan')
        self.assertEqual(plan['evidence']['implementation'], 'planned')
        code = (root / 'docs/wiki/System-views.md').read_text(encoding='utf-8')
        hashes = [hashlib.sha256(block.encode('utf-8')).hexdigest()
                  for block in re.findall(r'```mermaid\n([\s\S]*?)```', code)]
        receipt = precise.read_json(root / 'docs/wiki/quality-rendering.json')
        self.assertEqual(len(hashes), 6)
        self.assertEqual(hashes, [row['source_sha256'] for row in receipt['diagrams']])
        self.assertTrue(all(row.get('parsed') and row.get('rendered') for row in receipt['diagrams']))

    def test_compound_map_does_not_read_source_and_preserves_visibility(self):
        root = Path(__file__).resolve().parents[1]
        manifest = precise.load(root)
        with patch.object(precise, 'resolve_source', side_effect=AssertionError('Unexpected source resolution')):
            result = precise.task_outline(root, manifest, 'interface-change')
        self.assertEqual({row['id'] for row in result['surfaces']}, {'external', 'dependency', 'tagging', 'rules'})
        self.assertEqual(len(result['route_ids']), 10)
        targets = [source for row in manifest['routes'] for source in row['sources'] if source.get('edit_for')]
        self.assertEqual(len(targets), 10)
        self.assertEqual({s['id'] for s in targets if s['visibility'] == 'public'}, {'decide-write', 'exports'})

    def test_omitted_compound_surface_fails_despite_correct_rankings(self):
        root = Path(__file__).resolve().parents[1]
        manifest = precise.load(root)
        manifest['task_maps'][0]['surfaces'].pop()
        result = precise.evaluate(root, manifest, precise.read_json(root / 'docs/wiki/navigation-tasks.json'))
        self.assertEqual(result['top1']['rate'], 1)
        self.assertFalse(result['passed'])
        self.assertEqual(result['task_map_cases'][0]['missing_surfaces'], ['rules'])

    def test_saved_quality_reports_and_numeric_summary_are_current(self):
        root = Path(__file__).resolve().parents[1]
        manifest = precise.load(root)
        routing = precise.evaluate(root, manifest, precise.read_json(root / 'docs/wiki/navigation-tasks.json'))
        structure = precise.audit(root, manifest)
        self.assertEqual(routing, precise.read_json(root / 'docs/wiki/quality-routing.json'))
        self.assertEqual(structure, precise.read_json(root / 'docs/wiki/quality-structure.json'))
        summary = (root / 'docs/wiki/Wiki-quality-review.md').read_text(encoding='utf-8')
        block = summary.split('<!-- report-summary:start -->', 1)[1].split('<!-- report-summary:end -->', 1)[0]
        expected = [
            f"| 首选命中 | {routing['top1']['numerator']}/{routing['top1']['denominator']} |",
            f"| 未知拒绝 | {routing['unknown_rejection']['numerator']}/{routing['unknown_rejection']['denominator']} |",
            f"| 最大空白分隔词数 | {routing['max_response_words']} |",
            f"| 复合范围用例 | {sum(case['passed'] for case in routing['task_map_cases'])}/{len(routing['task_map_cases'])} |",
            f"| 已定位改动用途 | {sum(row['edit_targets']['located'] for row in structure['routes'])} |",
        ]
        self.assertEqual([line for line in block.splitlines() if line.startswith('| ') and not line.startswith('| 指标')], expected)

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
