"""Query source-backed wiki routes without product execution or external packages."""
import argparse
import ast
import hashlib
import json
import re
from pathlib import Path


def local(root,name):
    path=(root/name).resolve()
    if not path.is_relative_to(root):raise ValueError(f'Path escapes project: {name}')
    return path


def symbols(tree,prefix=''):
    for node in ast.iter_child_nodes(tree):
        if isinstance(node,(ast.ClassDef,ast.FunctionDef,ast.AsyncFunctionDef)):
            name=prefix+node.name
            yield name,node.lineno
            yield from symbols(node,name+'.')


def source(root,entry):
    path=local(root,entry['path']);text=path.read_text(encoding='utf-8-sig')
    if entry.get('symbol'):
        matches=[line for name,line in symbols(ast.parse(text)) if name==entry['symbol']]
    else:
        matches=[n for n,line in enumerate(text.splitlines(),1) if entry['needle'] in line]
    if len(matches)!=1:raise ValueError(f'Expected one source location: {entry}')
    # Text mode normalizes CRLF/LF so Windows and Linux share one snapshot.
    return dict(entry,line=matches[0],sha256=hashlib.sha256(text.encode('utf-8')).hexdigest())


def anchor_exists(text,anchor):
    if re.search(r'id=[\"\']'+re.escape(anchor)+r'[\"\']',text):return True
    for title in re.findall(r'^#{1,6}\s+(.+)$',text,re.M):
        slug=re.sub(r'[^\w\- ]','',title.lower()).replace(' ','-')
        if slug==anchor:return True
    return False


def resolve(root,manifest):
    if manifest.get('schema_version') not in (1, 2):raise ValueError('Unsupported route schema')
    rows=[];seen=set()
    for route in manifest['routes']:
        if route['id'] in seen:raise ValueError('Duplicate route id')
        seen.add(route['id'])
        if not route.get('boundary'):raise ValueError('Route needs an evidence boundary')
        locations=[source(root,e) for e in route.get('sources',[])]
        for ref in route.get('docs',[])+route.get('tests',[]):
            name,_,anchor=ref.partition('#');path=local(root,name)
            if not path.is_file():raise ValueError(f'Missing route file: {ref}')
            if anchor and not anchor_exists(path.read_text(encoding='utf-8'),anchor):
                raise ValueError(f'Missing route anchor: {ref}')
        rows.append(dict(route,locations=locations))
    return rows


def rank(query,rows):
    query=query.casefold().strip();tokens=set(re.findall(r'[\w]+',query));ranked=[]
    for route in rows:
        aliases=[route['id'],route['title'],*route.get('aliases',[])]
        score=sum(8+min(len(alias),30)/10 for alias in aliases if alias.casefold() in query)
        words=set(re.findall(r'[\w]+',' '.join(aliases).casefold()));score+=len(tokens&words)
        if score:ranked.append((score,route))
    return [dict(row,match_score=round(score,2)) for score,row in sorted(ranked,key=lambda x:(-x[0],x[1]['id']))]


def render(rows,project):
    lines=[f'# {project}: agent quick routes','',
        '从问题找功能，再打开当前符号和对应局部图。无需通读全站；源码/当前实证优先于过期叙述。',
        'Query → current symbol → local explanation/diagram → narrow check → evidence boundary.',
        'Queries recompute source positions. Navigation aid, not completion proof or workflow lock.','',
        '`python tools/wiki_route.py "外部源端口"` · `--list` · `--check` · `--build`','',
        '| Route / question | Current source | Explanation / plan |','| --- | --- | --- |']
    for row in rows:
        locations='<br>'.join(f"`{e['path']}:{e['line']}` `{e.get('symbol') or e.get('needle')}`" for e in row['locations']) or 'Planned; see specification'
        links=[]
        for ref in row['docs']:
            if ref.startswith('docs/wiki/'):
                relative=ref.removeprefix('docs/wiki/')
                links.append(f'[{ref.split("#")[-1]}]({relative})')
        lines.append(f"| **{row['id']}** — {row['title']} | {locations} | {'<br>'.join(links)} |")
    lines+=['','## Evidence and checks','',
        'Query responses include only the selected routes: aliases, current locations, tests, checks and scope boundary.',
        'Acceptance/PROJECT carry volatile progress. Planned features have no invented source location.',
        'Regenerate with `--build` after structural changes. `--check` reports stale snapshots without locking work.','']
    return '\n'.join(lines)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('query',nargs='?');p.add_argument('--root',type=Path,default=Path.cwd())
    p.add_argument('--manifest',default='docs/wiki/routes.json');p.add_argument('--json',action='store_true')
    p.add_argument('--list',action='store_true');p.add_argument('--build',action='store_true');p.add_argument('--check',action='store_true')
    p.add_argument('--limit',type=int,default=2)
    args=p.parse_args(argv);root=args.root.resolve()
    manifest=json.loads(local(root,args.manifest).read_text(encoding='utf-8'))
    if args.list or (not args.query and not args.build and not args.check):
        print('\n'.join(f"{r['id']}: {r['title']}" for r in manifest['routes']));return 0
    if args.query and not args.build and not args.check:
        # A broken unrelated route must not block useful navigation. Resolve only
        # selected routes; stale source symbols retain the explanatory pointers.
        hits=[]
        for row in rank(args.query,manifest['routes'])[:max(1,min(args.limit,5))]:
            try:row=resolve(root,dict(manifest,routes=[row]))[0]
            except (ValueError,OSError,SyntaxError) as error:
                row=dict(row,locations=[],warning='Stale route; verify this location: '+str(error))
            hits.append(row)
    else:
        hits=[]
    rows=resolve(root,manifest) if args.build or args.check else []
    snapshot=root/'docs/wiki/agent-index.json'
    current=dict(schema_version=1,project=manifest['project'],routes=rows)
    if args.build:
        snapshot.parent.mkdir(parents=True,exist_ok=True)
        snapshot.write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        snapshot.with_suffix('.md').write_text(render(rows,manifest['project']),encoding='utf-8')
        print(f'Built {len(rows)} routes; symbols and links resolved');return 0
    if args.check:
        stale=not snapshot.is_file() or json.loads(snapshot.read_text(encoding='utf-8'))!=current
        print(json.dumps(dict(valid=True,routes=len(rows),snapshot_stale=stale,query_resolves_current_symbols=True,
            validation_scope='navigation structure only; behavior claims require source/evidence review')));return 1 if stale else 0
    if args.json:print(json.dumps(dict(query=args.query,matches=hits),ensure_ascii=False,indent=2))
    elif not hits:print('No curated route. Try --list, then one targeted source search; add the useful route. Avoid guessed paths.')
    else:
        for row in hits:
            print(f"{row['id']}: {row['title']}")
            if row.get('warning'):print('  warning: '+row['warning'])
            for e in row['locations']:print(f"  {e['path']}:{e['line']} :: {e.get('symbol') or e.get('needle')}")
            print('  docs: '+' | '.join(row['docs']));print('  tests: '+' '.join(row.get('tests',[])))
            for command in row.get('checks',[]):print('  check: '+(command['command'] if isinstance(command,dict) else command))
            print('  boundary: '+row['boundary'])
    return 0


if __name__=='__main__':raise SystemExit(main())
