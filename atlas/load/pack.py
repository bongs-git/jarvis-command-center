#!/usr/bin/env python3
"""Prepares the private knowledge base (atlas_kb.json) for loading into the table public.indai_atlas.

    python3 atlas/load/pack.py /path/to/atlas_kb.json /path/to/an/empty/folder/outside/this/repository

Why this exists: the knowledge base must never be committed, and a session that can only reach the database
through SQL statements has to send it as text. Sent whole it is about 490 KB. This packs it to under half of that
without losing a digit, cuts it into rows that are each checked on arrival, and prints the two fingerprints that
prove the copy in the table is exact. See README.md beside this file for the steps.

What is left out and rebuilt by the database (unpack.sql): in every result cell, win = wins / n and
lift = win - base exactly, and every rule has the same layout of eras, trend/volatility bins and horizons.
The script refuses to drop anything it cannot rebuild exactly: such a cell is sent whole.
"""
import decimal, glob, hashlib, json, os, sys

ROW, PER_STATEMENT = 800, 9   # characters in a row, rows in a statement
BIG = ('pooled', 'matrix', 'cell_grades')
EMPTY = {'n': 0, 'wins': 0, 'win': None, 'base': None, 'net': None, 'lift': None}


def pack(kb):
    rules = kb['rules']
    first = next(iter(rules.values()))
    eras = list(first['matrix']); bins = list(first['matrix'][eras[0]]); horizons = list(first['matrix'][eras[0]][bins[0]])
    grade_keys = list(first['cell_grades'])
    letter = {}
    for r in rules.values():
        for g in r['cell_grades'].values(): letter.setdefault(g, 'RYAGBCDEFH'[len(letter)])
    whole = 0

    def cell(c, pooled):
        nonlocal whole
        keys = sorted(['n', 'wins', 'win', 'base', 'net', 'lift'] + (['ci'] if pooled else []))
        counts = sorted(c) == keys and type(c['n']) is int and type(c['wins']) is int
        if counts and c['n'] == 0 and all(c[k] == EMPTY[k] for k in EMPTY) and (not pooled or c['ci'] is None):
            return 0
        if counts and c['n'] > 0 and all(type(c[k]) is float for k in ('win', 'base', 'net', 'lift')) \
                and c['win'] == c['wins'] / c['n'] and c['lift'] == c['win'] - c['base']:
            return [c['n'], c['wins'], c['base'], c['net']] + ([c['ci']] if pooled and c['ci'] is not None else [])
        whole += 1
        return c

    out = []
    for key, r in rules.items():
        assert all(k in r for k in BIG) and list(r['cell_grades']) == grade_keys, 'rule %s has another layout' % key
        assert list(r['matrix']) == eras and list(r['pooled']) == eras, 'rule %s has other eras' % key
        for e in eras:
            assert list(r['matrix'][e]) == bins and list(r['pooled'][e]) == horizons, 'rule %s has another layout' % key
            assert all(list(r['matrix'][e][b]) == horizons for b in bins), 'rule %s has other horizons' % key
        out.append([key, {k: v for k, v in r.items() if k not in BIG},
                    ''.join(letter[r['cell_grades'][k]] for k in grade_keys),
                    [cell(r['pooled'][e][h], True) for e in eras for h in horizons],
                    [cell(r['matrix'][e][b][h], False) for e in eras for b in bins for h in horizons]])
    packed = {'o': {k: v for k, v in kb.items() if k != 'rules'}, 'e': eras, 'tv': bins, 'h': horizons,
              'gk': grade_keys, 'gv': {v: k for k, v in letter.items()}, 'r': out}
    return json.dumps(packed, separators=(',', ':'), ensure_ascii=False), whole


def as_stored(v):
    """The text Postgres shows for a jsonb value (value::text): the fingerprint of the stored copy is taken from it."""
    if isinstance(v, dict):
        keys = sorted(v, key=lambda k: (len(k.encode()), k.encode()))
        return '{' + ', '.join(json.dumps(k, ensure_ascii=False) + ': ' + as_stored(v[k]) for k in keys) + '}'
    if isinstance(v, list): return '[' + ', '.join(as_stored(x) for x in v) + ']'
    if v is None or isinstance(v, bool) or isinstance(v, str): return json.dumps(v, ensure_ascii=False)
    d = decimal.Decimal(repr(v))
    return format(abs(d) if d == 0 else d, 'f')


def main(src, out):
    raw = open(src, encoding='utf-8').read()
    kb = json.loads(raw)
    assert json.dumps(kb, separators=(',', ':')) == raw, 'expected the plain minified file; numbers would not survive otherwise'
    text, whole = pack(kb)
    assert '$' not in text and '\\' not in text and '\n' not in text, 'the packed text has a character the statements cannot carry'
    cuts, i = [0], 0
    while i + ROW < len(text):
        j = i + ROW
        while text[j - 1] == ' ' or text[j] == ' ': j += 1   # a row never starts or ends with a space
        cuts.append(j); i = j
    rows = [text[a:b] for a, b in zip(cuts, cuts[1:] + [len(text)])]
    assert ''.join(rows) == text
    md5 = lambda s: hashlib.md5(s.encode('utf-8')).hexdigest()
    os.makedirs(out, exist_ok=True)
    for old in glob.glob(os.path.join(out, 's*.sql')): os.remove(old)
    for k in range(0, len(rows), PER_STATEMENT):
        part = rows[k:k + PER_STATEMENT]
        lines = ['insert into indai_stage.atlas_part (part, want, body) values']
        lines += ["(%d,'%s',$kb$%s$kb$)%s" % (n, md5(b), b, ',' if n < k + len(part) else '') for n, b in enumerate(part, k + 1)]
        lines += ['on conflict (part) do update set want = excluded.want, body = excluded.body', 'returning part, md5(body) = want as ok;']
        with open(os.path.join(out, 's%02d.sql' % (k // PER_STATEMENT + 1)), 'w', encoding='utf-8') as f: f.write('\n'.join(lines) + '\n')
    print('original %d characters, packed %d, cells sent whole %d' % (len(raw), len(text), whole))
    print('rows %d in %d statements, written to %s' % (len(rows), -(-len(rows) // PER_STATEMENT), out))
    print('fingerprint of the packed text:  ' + md5(text))
    print('fingerprint of the stored value: ' + md5(as_stored(kb)))


if __name__ == '__main__':
    if len(sys.argv) != 3: sys.exit(__doc__)
    here = os.path.dirname(os.path.abspath(__file__)); repo = os.path.dirname(os.path.dirname(here))
    if os.path.abspath(sys.argv[2]).startswith(repo + os.sep): sys.exit('Choose a folder outside this repository: the statements hold the private data.')
    main(sys.argv[1], sys.argv[2])
