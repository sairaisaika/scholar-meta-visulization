#!/usr/bin/env python3
"""Source-backed wiki navigation and measurable structural/routing acceptance.

Python 3.10+, standard library only. Never executes recorded commands or project code.
Only the explicit build command writes generated route-index files.
"""
from __future__ import annotations

import argparse
import ast
from datetime import date
import hashlib
import json
import math
from pathlib import Path, PureWindowsPath
import re
import sys


class Invalid(ValueError):
    """An actionable manifest, path or source error."""


ROLES = {'declaration', 'implementation', 'caller', 'consumer', 'contract'}
KINDS = {'interface', 'behavior', 'architecture', 'plan'}
STATES = {'planned', 'implemented', 'mixed', 'unknown'}
LEVELS = {'source', 'offline-tested', 'installed', 'live-verified'}
DIAGRAM_KINDS = {'architecture', 'flow', 'sequence', 'data-model', 'deployment', 'state-machine'}
STOP = {'a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'is', 'it', 'in', 'on',
        'i', 'we', 'how', 'what', 'does', 'do', 'can', 'this', 'that', 'with', 'my'}


def text(value):
    return isinstance(value, str) and bool(value.strip())


def strings(value):
    return isinstance(value, list) and all(text(item) for item in value)


def local(root, name):
    if not text(name) or Path(name).is_absolute() or PureWindowsPath(name).anchor:
        raise Invalid(f'Expected a repository-relative path: {name!r}')
    if '\\' in name:
        raise Invalid(f'Use forward slashes in manifest paths: {name!r}')
    result = (root / name).resolve()
    if not result.is_relative_to(root):
        raise Invalid(f'Path escapes project root: {name}')
    return result


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def load(root):
    manifest = read_json(local(root, 'docs/wiki/routes.json'))
    if not isinstance(manifest, dict) or type(manifest.get('schema_version')) is not int or manifest.get('schema_version') not in (1, 2):
        raise Invalid('Expected schema_version 1 (legacy) or 2')
    if not text(manifest.get('project')) or not isinstance(manifest.get('routes'), list):
        raise Invalid('Manifest needs project and routes')
    seen = set()
    for row in manifest['routes']:
        if not isinstance(row, dict) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', str(row.get('id', ''))):
            raise Invalid('Each route needs a stable lowercase-hyphen id')
        if row['id'] in seen:
            raise Invalid(f'Duplicate route id: {row["id"]}')
        seen.add(row['id'])
        if not text(row.get('title')):
            raise Invalid(f'{row["id"]}: missing title')
        if not strings(row.get('aliases', [])):
            raise Invalid(f'{row["id"]}: aliases must be strings')
    quality = manifest.get('quality', {})
    if not isinstance(quality, dict):
        raise Invalid('quality must be an object')
    for key, default, low, high in [('min_structural_score', 85, 0, 100), ('max_query_words', 450, 1, 10000)]:
        value = quality.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise Invalid(f'Invalid quality.{key}')
    policy = manifest.get('diagram_policy')
    if policy is not None:
        if not isinstance(policy, dict) or not text(policy.get('scope')):
            raise Invalid('diagram_policy requires a scope')
        required = policy.get('required_kinds')
        if not strings(required) or not required or len(set(required)) != len(required) or not set(required) <= DIAGRAM_KINDS:
            raise Invalid('diagram_policy required_kinds must be unique supported diagram kinds')
        exceptions, seen = policy.get('not_applicable', []), set()
        if not isinstance(exceptions, list):
            raise Invalid('diagram_policy not_applicable must be an array')
        for exception in exceptions:
            if not isinstance(exception, dict) or exception.get('kind') not in required or exception['kind'] in seen or not text(exception.get('reason')):
                raise Invalid('Diagram exceptions require a unique required kind and explicit reason')
            seen.add(exception['kind'])
    task_maps(manifest)
    return manifest


def task_maps(manifest):
    """Validate declared compound scope, never infer a complete impact graph."""
    maps = manifest.get('task_maps', [])
    if not isinstance(maps, list):
        raise Invalid('task_maps must be an array')
    route_ids = {row['id'] for row in manifest['routes']}
    seen = set()
    for item in maps:
        if not isinstance(item, dict) or not text(item.get('id')) or item['id'] in seen:
            raise Invalid('Task maps require unique nonempty IDs')
        seen.add(item['id'])
        if not all(text(item.get(key)) for key in ('title', 'scope')) or not strings(item.get('docs')) or not item['docs']:
            raise Invalid('Task maps require title, scope and local docs')
        surfaces = item.get('surfaces')
        if not isinstance(surfaces, list) or not surfaces:
            raise Invalid('Task maps require nonempty surfaces')
        surface_ids = set()
        for surface in surfaces:
            if not isinstance(surface, dict) or not text(surface.get('id')) or surface['id'] in surface_ids:
                raise Invalid('Task surface IDs must be unique within a map')
            surface_ids.add(surface['id'])
            refs = surface.get('route_ids')
            if not all(text(surface.get(key)) for key in ('question', 'why')) or not strings(refs) or not refs or len(set(refs)) != len(refs) or not set(refs) <= route_ids:
                raise Invalid('Task surfaces require question, why and unique existing route_ids')
    return maps


def task_outline(root, manifest, task_id):
    matches = [item for item in task_maps(manifest) if item['id'] == task_id]
    if not matches:
        raise Invalid(f'Unknown task map: {task_id}; use task without an ID to list maps')
    item = matches[0]
    for reference in item['docs']:
        verify_ref(root, reference)
    ids = list(dict.fromkeys(ref for surface in item['surfaces'] for ref in surface['route_ids']))
    routes = [row for row in manifest['routes'] if row['id'] in ids]
    for row in routes:
        for reference in row.get('docs', []):
            verify_ref(root, reference)
    return dict(item, route_ids=ids, routes=[{'id': row['id'], 'title': row['title'],
                'docs': row.get('docs', [])} for row in routes],
                evidence_boundary='Declared task scope, not inferred full-project completeness; source locations/semantics require query and review')


def py_symbols(node, prefix=''):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            qualified = prefix + child.name
            yield qualified, child.lineno
            yield from py_symbols(child, qualified + '.')
        else:
            yield from py_symbols(child, prefix)


def resolve_source(root, entry):
    if not isinstance(entry, dict):
        raise Invalid('Source record must be an object')
    path = local(root, entry.get('path'))
    if not path.is_file():
        raise Invalid(f'Missing source: {entry.get("path")}')
    content = path.read_text(encoding='utf-8-sig')  # universal newlines
    if text(entry.get('symbol')) == text(entry.get('needle')):
        raise Invalid(f'Choose exactly one symbol or needle: {entry.get("path")}')
    if text(entry.get('symbol')):
        if path.suffix != '.py':
            raise Invalid(f'AST symbols support Python; use a unique needle for {entry["path"]}')
        matches = [line for name, line in py_symbols(ast.parse(content)) if name == entry['symbol']]
    else:
        matches = [n for n, line in enumerate(content.splitlines(), 1) if entry['needle'] in line]
    if len(matches) != 1:
        raise Invalid(f'Expected one source match, got {len(matches)}: {entry["path"]}::{entry.get("symbol") or entry.get("needle")}')
    return dict(entry, line=matches[0], sha256=hashlib.sha256(content.encode('utf-8')).hexdigest())


def anchors(content):
    result = set(re.findall(r'<a\s+[^>]*id=["\']([^"\']+)["\']', content, re.I))
    used = {}
    fence = None
    for line in content.splitlines():
        opening = re.match(r'^\s{0,3}(`{3,}|~{3,})', line)
        if opening:
            token = opening.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if fence is not None:
            continue
        heading = re.match(r'^#{1,6}\s+(.+?)(?:\s+#+)?\s*$', line)
        if heading:
            value = re.sub(r'<[^>]*>', '', heading.group(1)).lower()
            slug = re.sub(r'[^\w\- ]', '', value).replace(' ', '-')
            count = used.get(slug, 0)
            used[slug] = count + 1
            result.add(slug if count == 0 else f'{slug}-{count}')
    return result


def verify_ref(root, reference):
    if not text(reference):
        raise Invalid('Reference must be a nonempty local path')
    name, _, fragment = reference.partition('#')
    path = local(root, name)
    if not path.is_file():
        raise Invalid(f'Missing reference: {reference}')
    if fragment and fragment not in anchors(path.read_text(encoding='utf-8-sig')):
        raise Invalid(f'Missing Markdown anchor: {reference}')


def valid_date(value):
    if not text(value) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def engineering_metrics(root, row, source_ids):
    """Validate optional declared engineering models, never infer code equivalence."""
    model = row.get('engineering')
    if model is None:
        return None
    profiles = {'data_contract', 'lifecycle', 'execution', 'decisions'}
    if not isinstance(model, dict) or set(model) - (profiles | {'scope', 'status'}):
        raise Invalid('Unknown engineering profile or malformed engineering object')
    if not text(model.get('scope')) or model.get('status') not in {'current', 'proposed', 'partial'}:
        raise Invalid('Engineering model requires scope and current/proposed/partial status')
    selected = sorted(profiles & set(model))
    if not selected:
        raise Invalid('Engineering model must select at least one profile')
    proposed = model['status'] == 'proposed'
    if row.get('evidence', {}).get('implementation') == 'planned' and not proposed:
        raise Invalid('A planned route cannot claim current engineering detail')

    def references(item):
        refs = item.get('source_ids', [])
        if not strings(refs) or any(ref not in source_ids for ref in refs) or (not refs and not proposed):
            raise Invalid('Engineering claim requires valid route source_ids')
        tests = item.get('tests', [])
        if not strings(tests):
            raise Invalid('Engineering tests must be local references')
        for reference in tests:
            verify_ref(root, reference)

    def records(value, label):
        if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
            raise Invalid(f'{label} must be an array of objects')
        return value

    def named(value, label):
        if not strings(value) or not value or len(set(value)) != len(value):
            raise Invalid(f'{label} must contain unique nonempty names')
        return set(value)

    def integer(value, label, minimum=0):
        if type(value) is not int or value < minimum:
            raise Invalid(f'{label} must be an integer >= {minimum}')

    report = {'scope': model['scope'], 'status': model['status'], 'profiles': selected,
              'verification': 'declared model consistency only; code equivalence and runtime behavior not verified'}
    if 'data_contract' in model:
        data = model['data_contract']
        if not isinstance(data, dict):
            raise Invalid('data_contract must be an object')
        authority = data.get('authority', {})
        if not isinstance(authority, dict) or authority.get('kind') not in {'typed-source', 'idl', 'schema', 'manual'}:
            raise Invalid('Data contract requires explicit authority kind')
        verify_ref(root, authority.get('path'))
        references(authority)
        fields = records(data.get('fields'), 'Data fields')
        if not fields:
            raise Invalid('Data contract needs fields')
        names, spans = set(), []
        layout = data.get('layout')
        if layout is not None:
            if not isinstance(layout, dict) or layout.get('byte_order') not in {'big', 'little'}:
                raise Invalid('Binary layout needs explicit big/little byte_order')
            integer(layout.get('size_bytes'), 'layout.size_bytes', 1)
        for field in fields:
            if not all(text(field.get(key)) for key in ('name', 'type', 'unit')) or field['name'] in names:
                raise Invalid('Fields need unique name, type and unit')
            names.add(field['name'])
            if type(field.get('nullable')) is not bool or not strings(field.get('constraints')) or not field['constraints']:
                raise Invalid('Fields need explicit nullability and nonempty constraints')
            references(field)
            if layout is not None:
                integer(field.get('offset_bytes'), 'field.offset_bytes')
                integer(field.get('size_bytes'), 'field.size_bytes', 1)
                start, end = field['offset_bytes'], field['offset_bytes'] + field['size_bytes']
                if end > layout['size_bytes'] or any(start < other_end and other_start < end for other_start, other_end in spans):
                    raise Invalid('Binary field overlaps or exceeds declared layout; unions need a specialized verifier')
                spans.append((start, end))
            elif 'offset_bytes' in field or 'size_bytes' in field:
                raise Invalid('Byte offsets/sizes require a declared layout')
        report['data_contract'] = {'fields': len(fields), 'source_linked_fields': sum(bool(item.get('source_ids')) for item in fields),
                                   'authority_kind': authority['kind'], 'layout_declared': layout is not None,
                                   'geometry_only': layout is not None, 'semantic_conformance': 'not verified'}
    if 'lifecycle' in model:
        lifecycle = model['lifecycle']
        if not isinstance(lifecycle, dict):
            raise Invalid('lifecycle must be an object')
        states, events = named(lifecycle.get('states'), 'states'), named(lifecycle.get('events'), 'events')
        if lifecycle.get('initial') not in states or not strings(lifecycle.get('terminal')) or not set(lifecycle['terminal']) <= states:
            raise Invalid('Lifecycle initial/terminal states must be declared')
        if lifecycle.get('coverage_claim') not in {'partial', 'complete'}:
            raise Invalid('Lifecycle coverage_claim must be partial or complete')
        parameters = records(lifecycle.get('parameters', []), 'lifecycle parameters')
        parameter_names = set()
        for parameter in parameters:
            if not all(text(parameter.get(key)) for key in ('name', 'domain', 'validation_scope')) or parameter['name'] in parameter_names:
                raise Invalid('Lifecycle parameters need unique name, domain and validation_scope')
            parameter_names.add(parameter['name'])
            references(parameter)
        transitions = records(lifecycle.get('transitions'), 'transitions')
        rejected = records(lifecycle.get('rejected'), 'rejected')
        unknown = records(lifecycle.get('unknown'), 'unknown')
        specified, gaps, transition_ids, guards = set(), set(), set(), {}
        graph = {state: set() for state in states}

        def pair(item):
            if item.get('from') not in states or item.get('event') not in events:
                raise Invalid('Lifecycle transition/rejection uses an undeclared state or event')
            return item['from'], item['event']

        for item in transitions:
            key = pair(item)
            if not text(item.get('id')) or item['id'] in transition_ids or item.get('to') not in states:
                raise Invalid('Transitions need unique IDs and declared target states')
            if not text(item.get('guard')) or not text(item.get('action')) or item['guard'] in guards.get(key, set()):
                raise Invalid('Transitions require nonempty distinct guards and actions')
            transition_ids.add(item['id'])
            guards.setdefault(key, set()).add(item['guard'])
            specified.add(key)
            graph[item['from']].add(item['to'])
            references(item)
        for items, target in ((rejected, specified), (unknown, gaps)):
            for item in items:
                key = pair(item)
                if key in specified or key in gaps or not text(item.get('reason')):
                    raise Invalid('Lifecycle pairs must not overlap classifications and need reasons')
                target.add(key)
                if items is rejected:
                    references(item)
        total = len(states) * len(events)
        missing = total - len(specified | gaps)
        if lifecycle['coverage_claim'] == 'complete' and (gaps or missing):
            raise Invalid('Complete lifecycle claim has unknown or unclassified state/event pairs')
        reached, pending = set(), [lifecycle['initial']]
        while pending:
            state = pending.pop()
            if state not in reached:
                reached.add(state)
                pending.extend(graph[state] - reached)
        report['lifecycle'] = {'specified_pairs': len(specified), 'total_pairs': total,
                               'unknown_pairs': len(gaps), 'unclassified_pairs': missing,
                               'transitions': len(transitions), 'source_linked_transitions': sum(bool(item.get('source_ids')) for item in transitions),
                               'unreachable_declared_states': sorted(states - reached),
                               'coverage_claim': lifecycle['coverage_claim'], 'guard_exhaustiveness': 'not verified',
                               'context_parameters': len(parameters),
                               'coverage_scope': 'Declared state/event pairs only; parameter combinations, invalid inputs and races are not exhaustively covered'}
    if 'execution' in model:
        execution = model['execution']
        if not isinstance(execution, dict) or set(execution) - {'ownership', 'ordering', 'limits'}:
            raise Invalid('Execution supports ownership, ordering and limits')
        groups = {name: records(execution.get(name, []), name) for name in ('ownership', 'ordering', 'limits')}
        if not any(groups.values()):
            raise Invalid('Execution profile must record an actual constraint or proposed requirement')
        for name, keys in [('ownership', ('resource', 'owner', 'lifetime', 'release')), ('ordering', ('before', 'after', 'reason'))]:
            for item in groups[name]:
                if not all(text(item.get(key)) for key in keys):
                    raise Invalid(f'{name} requires {", ".join(keys)}')
                references(item)
        kinds = {'target': 0, 'configured': 0, 'measured': 0}
        limit_ids = set()
        for item in groups['limits']:
            value = item.get('value')
            if not text(item.get('id')) or item['id'] in limit_ids or item.get('kind') not in kinds:
                raise Invalid('Limits need unique id and configured/target/measured kind')
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not all(text(item.get(key)) for key in ('unit', 'scope')):
                raise Invalid('Limits need finite numeric value, unit and scope')
            references(item)
            limit_ids.add(item['id'])
            kinds[item['kind']] += 1
            if item['kind'] == 'measured':
                refs = item.get('evidence_refs')
                if not text(item.get('method')) or not strings(refs) or not refs:
                    raise Invalid('Measured limits require method and evidence_refs, not just a constant')
                for reference in refs:
                    verify_ref(root, reference)
        report['execution'] = {'ownership_records': len(groups['ownership']), 'ordering_constraints': len(groups['ordering']),
                               'limits_by_kind': kinds, 'performance_or_measurement_truth': 'not verified'}
    if 'decisions' in model:
        decisions = records(model['decisions'], 'decisions')
        if not decisions:
            raise Invalid('Decisions profile requires decision records')
        ids, statuses = set(), {'proposed': 0, 'accepted': 0, 'superseded': 0}
        for item in decisions:
            if not all(text(item.get(key)) for key in ('id', 'context', 'decision', 'revisit_when')) or item['id'] in ids or item.get('status') not in statuses:
                raise Invalid('Decisions need unique ID, context, decision, status and revisit_when')
            if not all(strings(item.get(key)) and item[key] for key in ('alternatives', 'consequences')):
                raise Invalid('Decisions need explicit alternatives and consequences')
            if proposed and item['status'] == 'accepted':
                raise Invalid('A proposed engineering model cannot claim an accepted decision')
            verify_ref(root, item.get('path'))
            references(item)
            ids.add(item['id'])
            statuses[item['status']] += 1
        report['decisions'] = {'records': len(decisions), 'by_status': statuses, 'rationale_accuracy': 'not verified'}
    return report


def resolve_route(root, row, version):
    if not text(row.get('boundary')):
        raise Invalid('Route requires an evidence boundary')
    for field in ('sources', 'rules', 'checks'):
        if not isinstance(row.get(field, []), list):
            raise Invalid(f'{field} must be an array')
    for field in ('docs', 'tests', 'impact', 'unknowns'):
        if field in row and not strings(row[field]):
            raise Invalid(f'{field} must be an array of nonempty strings')
    locations = [resolve_source(root, item) for item in row.get('sources', [])]
    for reference in row.get('docs', []) + row.get('tests', []):
        verify_ref(root, reference)
    if version == 1:
        return dict(row, locations=locations)
    if row.get('kind') not in KINDS:
        raise Invalid('kind must be interface, behavior, architecture or plan')
    evidence = row.get('evidence', {})
    if not isinstance(evidence, dict) or evidence.get('implementation') not in STATES:
        raise Invalid('evidence.implementation must explicitly describe implementation state')
    planned = evidence['implementation'] == 'planned'
    if row['kind'] == 'plan' and not planned:
        raise Invalid('Plan routes must remain planned; use a separate implemented route')
    if row['kind'] == 'plan':
        plan = row.get('plan', {})
        if not isinstance(plan, dict) or not all(
            strings(plan.get(field)) for field in
            ('outcomes', 'dependencies', 'interfaces', 'deliverables', 'exit_evidence', 'unknowns')
        ) or not all(plan.get(field) for field in ('outcomes', 'interfaces', 'deliverables', 'exit_evidence')):
            raise Invalid('Plans require outcomes, dependencies, interfaces, deliverables, exit_evidence and unknowns; empty dependencies/unknowns must be explicit')
    if not planned and not locations:
        raise Invalid('A non-planned route must resolve existing source')
    ids = set()
    for source in locations:
        if not text(source.get('id')) or source['id'] in ids or source.get('role') not in ROLES:
            raise Invalid('Source IDs must be unique and roles valid')
        ids.add(source['id'])
        if not text(source.get('reason')):
            raise Invalid('Each source requires its reason in the edit surface')
        if 'visibility' in source and source['visibility'] not in ('public', 'internal'):
            raise Invalid('Source visibility must be public or internal')
        if 'edit_for' in source and (not strings(source['edit_for']) or not source['edit_for']):
            raise Invalid('Source edit_for must be a nonempty string array')
        if planned and source['role'] == 'implementation':
            raise Invalid('Do not label a proposed implementation as existing source')
    rule_ids = set()
    for rule in row.get('rules', []):
        if not isinstance(rule, dict) or not text(rule.get('id')) or rule['id'] in rule_ids or not text(rule.get('statement')):
            raise Invalid('Rules need unique IDs and statements')
        rule_ids.add(rule['id'])
        refs = rule.get('source_ids', [])
        if not strings(refs) or any(ref not in ids for ref in refs):
            raise Invalid(f'Unknown rule source ID: {rule["id"]}')
        if not refs and not (planned and rule.get('proposed') is True):
            raise Invalid(f'Rule has no source provenance: {rule["id"]}')
        if not strings(rule.get('tests', [])):
            raise Invalid('Rule tests must be paths')
        for reference in rule.get('tests', []):
            verify_ref(root, reference)
    interface = row.get('interface', {})
    if not isinstance(interface, dict):
        raise Invalid('interface must be an object')
    for field in ('inputs', 'outputs', 'errors'):
        if field in interface and not strings(interface[field]):
            raise Invalid(f'interface.{field} must be strings')
    if 'compatibility' in interface and not text(interface['compatibility']):
        raise Invalid('interface.compatibility must be nonempty')
    if row['kind'] == 'interface' and not all(interface.get(field) for field in ('inputs', 'outputs', 'errors', 'compatibility')):
        raise Invalid('Interface routes require inputs, outputs, errors and compatibility')
    modes = interface.get('failure_modes', {})
    if not isinstance(modes, dict):
        raise Invalid('interface.failure_modes must be an object')
    if row['kind'] == 'interface' and not all(strings(modes.get(key)) and modes[key] for key in ('returned', 'thrown', 'unsupported')):
        raise Invalid('Interface routes must distinguish returned, thrown and unsupported failure modes')
    for check in row.get('checks', []):
        if not isinstance(check, dict) or not text(check.get('command')) or not text(check.get('scope')):
            raise Invalid('Checks require command and scope; commands are never executed')
    observations = evidence.get('observations', [])
    if not isinstance(observations, list):
        raise Invalid('evidence.observations must be an array')
    for observation in observations:
        if not isinstance(observation, dict) or observation.get('level') not in LEVELS:
            raise Invalid('Observation requires a supported evidence level')
        if not all(text(observation.get(key)) for key in ('claim', 'revision')) or not valid_date(observation.get('observed_at')):
            raise Invalid('Observations require claim, revision, and observed_at date')
        verify_ref(root, observation.get('reference'))
        if planned and observation['level'] != 'source':
            raise Invalid('A plan cannot claim completed testing, installation or live verification')
    if 'reviewed_at' in row and not valid_date(row['reviewed_at']):
        raise Invalid('reviewed_at must be an actual YYYY-MM-DD date')
    if not isinstance(row.get('diagrams', []), list):
        raise Invalid('diagrams must be an array')
    for diagram in row.get('diagrams', []):
        if not isinstance(diagram, dict) or diagram.get('kind') not in DIAGRAM_KINDS:
            raise Invalid('Unsupported diagram kind')
        if not text(diagram.get('question')) or not text(diagram.get('scope')):
            raise Invalid('Diagrams must explain their question and scope')
        verify_ref(root, diagram.get('path'))
        if 'source_ids' in diagram and (not strings(diagram['source_ids']) or not diagram['source_ids'] or any(ref not in ids for ref in diagram['source_ids'])):
            raise Invalid('Diagram source_ids must refer to located route sources')
    depth = engineering_metrics(root, row, ids)
    return dict(row, locations=locations, **({'engineering_metrics': depth} if depth is not None else {}))


def score(row):
    """Observable structural subcriteria only; never infer semantic correctness."""
    locations = row.get('locations', [])
    roles = {source.get('role') for source in locations}
    planned = row.get('evidence', {}).get('implementation') == 'planned'
    contract = row.get('interface', {})
    parts = {
        'location': (20 if planned else 12 * ('implementation' in roles) + 8 *
                     (row.get('kind') != 'interface' or 'declaration' in roles)),
        'contract': sum(3 * bool(contract.get(key)) for key in ('inputs', 'outputs'))
                    + 2 * bool(contract.get('errors')) + 3 * bool(contract.get('compatibility'))
                    + 4 * all(contract.get('failure_modes', {}).get(key) for key in ('returned', 'thrown', 'unsupported')),
        'rules': 15 * bool(row.get('rules')),
        'impact': 8 * bool(row.get('impact')) + 7 * (planned or bool(roles & {'caller', 'consumer'})),
        'validation': 8 * bool(row.get('tests')) + 7 * bool(row.get('checks')),
        'boundary': 3 * bool(row.get('boundary')) + 3 * ('unknowns' in row)
                    + 4 * (planned or bool(row.get('evidence', {}).get('observations'))),
        'findability': 2 * bool(row.get('aliases')) + 3 * bool(row.get('docs')),
        'freshness': 3 * valid_date(row.get('reviewed_at')) + 2 * (planned or bool(locations)),
    }
    return {'total': sum(parts.values()), 'categories': parts}


def audit(root, manifest):
    version = manifest['schema_version']
    reports = []
    diagram_counts = {kind: 0 for kind in sorted(DIAGRAM_KINDS)}
    for row in manifest['routes']:
        try:
            resolved = resolve_route(root, row, version)
            if version == 2:
                for diagram in resolved.get('diagrams', []):
                    diagram_counts[diagram['kind']] += 1
            quality = score(resolved) if version == 2 else None
            reports.append({'id': row['id'], 'valid': True, 'score': quality,
                            'locations': len(resolved['locations']),
                            'edit_targets': {'located': sum(bool(item.get('edit_for')) for item in resolved['locations']),
                                             'semantic_accuracy': 'not verified'},
                            'plan_coverage': {'numerator': 6, 'denominator': 6} if version == 2 and row.get('kind') == 'plan' else None,
                            'engineering': resolved.get('engineering_metrics'),
                            'gaps': [field for field in ('kind', 'interface', 'rules', 'impact', 'unknowns', 'evidence', 'reviewed_at') if field not in row]})
        except (ValueError, OSError, SyntaxError, TypeError) as error:
            reports.append({'id': row['id'], 'valid': False, 'error': str(error), 'score': None})
    totals = [item['score']['total'] for item in reports if item['score'] is not None]
    floor = manifest.get('quality', {}).get('min_structural_score', 85)
    policy = manifest.get('diagram_policy', {})
    required = set(policy.get('required_kinds', []))
    waived = {item['kind'] for item in policy.get('not_applicable', [])}
    documented = {kind for kind, count in diagram_counts.items() if count}
    missing = sorted(required - documented - waived)
    coverage = {'scope': policy.get('scope', 'No project-level diagram requirement configured'),
                'required_kinds': sorted(required), 'documented_kinds': sorted(documented),
                'counts_by_kind': diagram_counts, 'missing_kinds': missing,
                'not_applicable': policy.get('not_applicable', []),
                'reference_validation': 'Only valid route references are counted; semantic and rendering checks are separate',
                'renderer_verification': 'not performed by helper'}
    map_reports = []
    for item in task_maps(manifest):
        try:
            outline = task_outline(root, manifest, item['id'])
            map_reports.append({'id': item['id'], 'valid': True, 'surfaces': len(item['surfaces']),
                                'routes': len(outline['route_ids'])})
        except (ValueError, OSError) as error:
            map_reports.append({'id': item['id'], 'valid': False, 'error': str(error)})
    ready = version == 2 and bool(reports) and not missing and all(item['valid'] and item['score']['total'] >= floor for item in reports) and all(item['valid'] for item in map_reports)
    return {'schema_version': version, 'mode': 'structural' if version == 2 else 'legacy-gap-analysis',
            'ready': ready, 'routes': reports, 'route_count': len(reports),
            'structural_average': round(sum(totals) / len(totals), 2) if totals else None,
            'structural_minimum': min(totals) if totals else None, 'required_per_route': floor,
            'diagram_coverage': coverage,
            'task_maps': map_reports,
            'semantic_accuracy': 'not measured', 'independent_adoption': 'not measured'}


def words(value):
    return set(re.findall(r'\w+', value.casefold())) - STOP


def rank(query, routes):
    value = query.casefold().strip()
    if not value:
        return []
    tokens = words(value)
    hits = []
    for row in routes:
        aliases = [row['id'], row['title'], *row.get('aliases', [])]
        points = 0
        for alias in aliases:
            alias = alias.casefold().strip()
            matched = (re.search(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', value) is not None
                       if alias.isascii() else alias in value)
            if matched:
                points += 10 + min(len(alias), 30) / 10
        points += len(tokens & words(' '.join(aliases)))
        if points:
            hits.append((points, row))
    return [dict(row, match_score=round(points, 2))
            for points, row in sorted(hits, key=lambda item: (-item[0], item[1]['id']))]


def query(root, manifest, question, limit=2):
    results = []
    for row in rank(question, manifest['routes'])[:limit]:
        try:
            results.append(resolve_route(root, row, manifest['schema_version']))
        except (ValueError, OSError, SyntaxError, TypeError) as error:
            results.append(dict(row, locations=[], warning=str(error)))
    return results


def query_text(results, total_candidates=None):
    if not results:
        return 'No curated route. Try list, then a targeted source search; repair the missing route. No location guessed.'
    lines = []
    if total_candidates is not None and total_candidates > len(results):
        lines.append(f'Showing top {len(results)} of {total_candidates} candidates. Split compound requests by interface/feature; this is not a complete impact inventory.')
    for row in results:
        lines.append(f'{row["id"]}: {row["title"]}')
        if row.get('warning'):
            lines.append('  WARNING: ' + row['warning'])
            refs = row.get('docs', [])
            lines.append('  docs: ' + (' | '.join(refs) if strings(refs) else 'invalid document references'))
            continue
        for source in row.get('locations', []):
            role = source.get('role', 'legacy') + ('/' + source['visibility'] if source.get('visibility') else '')
            lines.append(f'  {source["path"]}:{source["line"]} [{role}] '
                         f'{source.get("symbol") or source.get("needle")} — {source.get("reason", "")}')
        lines.append('  docs: ' + ' | '.join(row.get('docs', [])))
        contract = row.get('interface', {})
        if contract:
            lines.append('  contract: ' + json.dumps(contract, ensure_ascii=False))
        for rule in row.get('rules', []):
            lines.append('  rule: ' + rule['statement'])
        if row.get('impact'):
            lines.append('  impact: ' + ' | '.join(row['impact']))
        if row.get('engineering_metrics'):
            depth = row['engineering_metrics']
            lines.append('  engineering: ' + ', '.join(depth['profiles']) + ' :: ' + depth['scope'])
        lines.append('  tests: ' + ' '.join(row.get('tests', [])))
        for check in row.get('checks', []):
            lines.append('  check: ' + (check if isinstance(check, str) else check['command'] + ' :: ' + check['scope']))
        lines.append('  boundary: ' + row.get('boundary', 'not recorded'))
        if row.get('unknowns'):
            lines.append('  unknowns: ' + ' | '.join(row['unknowns']))
    return '\n'.join(lines)


def snapshot(root, manifest):
    if manifest['schema_version'] != 2:
        raise Invalid('Schema 1 is query/audit only; review and migrate before building schema 2')
    return {'schema_version': 2, 'project': manifest['project'],
            'routes': [resolve_route(root, row, 2) for row in manifest['routes']],
            **({'task_maps': [task_outline(root, manifest, item['id']) for item in task_maps(manifest)]}
               if manifest.get('task_maps') else {})}


def markdown_index(current):
    lines = [f'# {current["project"]}: engineering routes', '',
             'Generated positions; source wins over stale prose. Read only the relevant route.', '',
             '| Task / ID | Current source and role | Local explanation |', '| --- | --- | --- |']
    for row in current['routes']:
        sources = '<br>'.join(f'`{item["path"]}:{item["line"]}` ({item["role"]})' for item in row['locations']) or 'Planned; no implementation asserted'
        links = []
        for reference in row.get('docs', []):
            if reference.startswith('docs/wiki/'):
                links.append(f'[{reference.removeprefix("docs/wiki/")}]({reference.removeprefix("docs/wiki/")})')
        lines.append(f'| {row["id"]}: {row["title"]} | {sources} | {"<br>".join(links)} |')
    if current.get('task_maps'):
        lines += ['', '## Compound task maps', '', 'Declared scope; query individual routes before implementation.', '']
        for item in current['task_maps']:
            lines.append(f'- {item["id"]}: {item["title"]}')
            for surface in item['surfaces']:
                lines.append(f'  - {surface["id"]}: {surface["question"]} → ' + ', '.join(surface['route_ids']))
    return '\n'.join(lines) + '\n'


def index_paths(root):
    return local(root, 'docs/wiki/route-index.json'), local(root, 'docs/wiki/route-index.md')


def is_stale(root, current):
    machine, human = index_paths(root)
    if not machine.is_file() or not human.is_file():
        return True
    try:
        return read_json(machine) != current or human.read_text(encoding='utf-8-sig') != markdown_index(current)
    except (ValueError, OSError):
        return True


def ratio(numerator, denominator):
    return {'numerator': numerator, 'denominator': denominator,
            'rate': round(numerator / denominator, 4) if denominator else None}


def evaluate(root, manifest, taskfile):
    if not isinstance(taskfile, dict) or type(taskfile.get('schema_version')) is not int or taskfile.get('schema_version') != 1 or not isinstance(taskfile.get('tasks'), list):
        raise Invalid('Task file requires schema_version 1 and tasks')
    thresholds = {'min_top1': .8, 'min_top2': .9, 'min_tasks': 10, 'min_unknown': 2}
    custom = taskfile.get('thresholds', {})
    if not isinstance(custom, dict) or set(custom) - set(thresholds):
        raise Invalid('Unknown evaluation threshold')
    thresholds.update(custom)
    for key in ('min_top1', 'min_top2'):
        if isinstance(thresholds[key], bool) or not isinstance(thresholds[key], (int, float)) or not 0 <= thresholds[key] <= 1:
            raise Invalid(f'Invalid {key}')
    for key in ('min_tasks', 'min_unknown'):
        if type(thresholds[key]) is not int or thresholds[key] < 1:
            raise Invalid(f'{key} must be a positive integer')
    route_ids = {row['id'] for row in manifest['routes']}
    seen = set()
    outcomes = []
    for task in taskfile['tasks']:
        if not isinstance(task, dict) or not text(task.get('id')) or task['id'] in seen or not text(task.get('query')):
            raise Invalid('Tasks require unique IDs and nonempty queries')
        seen.add(task['id'])
        expected = task.get('expected_routes')
        if not strings(expected) or any(item not in route_ids for item in expected):
            raise Invalid(f'{task["id"]}: expected_routes must reference real IDs or be []')
        hits = query(root, manifest, task['query'])
        ids = [row['id'] for row in hits]
        candidates = len(rank(task['query'], manifest['routes']))
        content = query_text(hits, candidates)
        outcomes.append({'id': task['id'], 'query': task['query'], 'expected': expected, 'actual': ids,
                         'top1': bool(ids and ids[0] in expected) if expected else None,
                         'top2': bool(set(ids) & set(expected)) if expected else None,
                         'unknown_rejected': not hits if not expected else None,
                         'locations_ok': bool(hits) and all(not row.get('warning') for row in hits) if expected else not hits,
                         'response_words': len(content.split()), 'response_bytes': len(content.encode('utf-8')),
                         'candidate_count': candidates, 'truncated': candidates > len(hits)})
    known = [row for row in outcomes if row['expected']]
    unknown = [row for row in outcomes if not row['expected']]
    top1 = ratio(sum(row['top1'] for row in known), len(known))
    top2 = ratio(sum(row['top2'] for row in known), len(known))
    rejected = ratio(sum(row['unknown_rejected'] for row in unknown), len(unknown))
    maximum = manifest.get('quality', {}).get('max_query_words', 450)
    map_cases = taskfile.get('task_map_cases', [])
    if not isinstance(map_cases, list):
        raise Invalid('task_map_cases must be an array')
    map_results, map_seen = [], set()
    for case in map_cases:
        if not isinstance(case, dict) or not text(case.get('id')) or case['id'] in map_seen or not text(case.get('task_map')):
            raise Invalid('Task map cases need unique IDs and a task_map ID')
        map_seen.add(case['id'])
        for key in ('expected_surfaces', 'expected_routes'):
            values = case.get(key)
            if not strings(values) or not values or len(values) != len(set(values)):
                raise Invalid(f'{key} must contain unique nonempty expected IDs')
        try:
            outline = task_outline(root, manifest, case['task_map'])
            actual_surfaces = {item['id'] for item in outline['surfaces']}
            actual_routes = set(outline['route_ids'])
            missing_surfaces = sorted(set(case['expected_surfaces']) - actual_surfaces)
            missing_routes = sorted(set(case['expected_routes']) - actual_routes)
            unexpected_surfaces = sorted(actual_surfaces - set(case['expected_surfaces']))
            unexpected_routes = sorted(actual_routes - set(case['expected_routes']))
            map_results.append({'id': case['id'], 'passed': not any((missing_surfaces, missing_routes, unexpected_surfaces, unexpected_routes)),
                                'missing_surfaces': missing_surfaces, 'missing_routes': missing_routes,
                                'unexpected_surfaces': unexpected_surfaces, 'unexpected_routes': unexpected_routes})
        except (ValueError, OSError) as error:
            map_results.append({'id': case['id'], 'passed': False, 'error': str(error)})
    passed = (bool(known) and len(outcomes) >= thresholds['min_tasks'] and len(unknown) >= thresholds['min_unknown']
              and top1['rate'] >= thresholds['min_top1'] and top2['rate'] >= thresholds['min_top2']
              and all(row['locations_ok'] and row['response_words'] <= maximum for row in outcomes)
              and all(row['passed'] for row in map_results))
    return {'evaluation': 'curated routing self-test; not an independent semantic/adoption trial',
            'passed': passed, 'thresholds': thresholds, 'task_count': len(outcomes),
            'top1': top1, 'top2': top2, 'unknown_rejection': rejected,
            'location_success': ratio(sum(row['locations_ok'] for row in outcomes), len(outcomes)),
            'max_response_words': max((row['response_words'] for row in outcomes), default=0),
            'word_count_method': 'whitespace proxy; not a tokenizer or cross-language segmentation measure',
            'semantic_accuracy': 'not measured', 'independent_adoption': 'not measured',
            'time_savings': 'not measured', 'tasks': outcomes,
            'task_map_cases': map_results,
            'task_map_scope': 'Declared expected IDs only; not semantic impact completeness'}


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('query', 'task', 'list', 'audit', 'build', 'check', 'evaluate'):
        sub = commands.add_parser(command)
        sub.add_argument('--root', type=Path, default=Path.cwd())
        if command == 'query':
            sub.add_argument('question')
            sub.add_argument('--limit', type=int, choices=range(1, 6), default=2)
            sub.add_argument('--json', action='store_true')
        if command == 'evaluate':
            sub.add_argument('--tasks', type=Path, required=True)
        if command == 'task':
            sub.add_argument('task_id', nargs='?')
    args = parser.parse_args(argv)
    root = args.root.resolve()
    try:
        manifest = load(root)
        if args.command == 'task':
            emit(task_outline(root, manifest, args.task_id) if args.task_id else
                 {'task_maps': [{'id': item['id'], 'title': item['title'], 'scope': item['scope']} for item in task_maps(manifest)]})
            return 0
        if args.command == 'list':
            print('\n'.join(row['id'] + ': ' + row['title'] for row in manifest['routes']))
            return 0
        if args.command == 'query':
            hits = query(root, manifest, args.question, args.limit)
            candidate_count = len(rank(args.question, manifest['routes']))
            if args.json:
                emit({'query': args.question, 'candidate_count': candidate_count,
                      'truncated': candidate_count > len(hits), 'matches': hits})
            else:
                print(query_text(hits, candidate_count))
            return 1 if any(row.get('warning') for row in hits) else 0
        if args.command == 'evaluate':
            report = evaluate(root, manifest, read_json(args.tasks))
            emit(report)
            return 0 if report['passed'] else 1
        report = audit(root, manifest)
        if args.command == 'audit':
            emit(report)
            return 0 if report['ready'] else 1
        if not report['ready']:
            emit(report)
            return 1
        current = snapshot(root, manifest)
        if args.command == 'build':
            machine, human = index_paths(root)
            machine.parent.mkdir(parents=True, exist_ok=True)
            machine.write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
            human.write_text(markdown_index(current), encoding='utf-8', newline='\n')
            emit({'built': len(current['routes']), 'outputs': [machine.relative_to(root).as_posix(), human.relative_to(root).as_posix()]})
            return 0
        stale = is_stale(root, current)
        emit({'valid': True, 'snapshot_stale': stale, 'ready': not stale,
              'route_count': len(current['routes']), 'structural_minimum': report['structural_minimum'],
              'diagram_coverage': report['diagram_coverage'],
              'scope': 'structure and drift, not semantic truth or runtime acceptance'})
        return 1 if stale else 0
    except (ValueError, OSError, SyntaxError, TypeError, KeyError) as error:
        emit({'valid': False, 'error': str(error)})
        return 1


if __name__ == '__main__':
    # Redirected Windows stdout may default to cp1252; reports include CJK queries.
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
