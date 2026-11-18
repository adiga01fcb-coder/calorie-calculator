#!/usr/bin/env python3
"""Сборка data/products.js из спецификаций tools/spec/*.txt.
U:<описание> — значения берутся из USDA FoodData Central SR Legacy (tools/usda-sr-legacy-subset.tsv).
R:ккал/Б/Ж/У — значения из российских таблиц химсостава / типовых опубликованных значений.
Запуск: python3 tools/resolve.py [путь к полной выгрузке usda.tsv]"""
import sys, os, re, json, glob
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
full = sys.argv[1] if len(sys.argv) > 1 else None
subset_path = os.path.join(HERE, 'usda-sr-legacy-subset.tsv')
rows = {}
src_path = full or subset_path
for line in open(src_path, encoding='utf-8'):
    if line.startswith('#'): continue
    p = line.rstrip('\n').split('\t')
    if full: p = p[2:]
    if len(p) < 5: continue
    d = p[0]
    rows.setdefault(d.lower(), (d, *[float(x) if x else 0.0 for x in p[1:7]], ))
CATS = [
 ('krupy','Крупы, бобовые, макароны'),('hleb','Хлеб и выпечка'),('myaso','Мясо, птица, колбасы'),
 ('ryba','Рыба и морепродукты'),('moloko','Молочные продукты и яйца'),('ovoshi','Овощи, зелень, грибы'),
 ('frukty','Фрукты и ягоды'),('orehi','Орехи, семена, сухофрукты'),('masla','Масла, соусы, приправы'),
 ('sladkoe','Сладости и десерты'),('napitki','Напитки'),('fastfood','Фастфуд'),('blyuda','Готовые блюда'),
]
catkeys = {k for k, _ in CATS}
items, errors, used = [], [], {}
def cands(desc):
    words = [w for w in re.split(r'[^a-z]+', desc.lower()) if len(w) > 2]
    sc = []
    for k, v in rows.items():
        s = sum(1 for w in words if w in k)
        if s: sc.append((s, -len(k), v[0]))
    sc.sort(reverse=True)
    return [c[2] for c in sc[:6]]
for f in sorted(glob.glob(os.path.join(HERE, 'spec', '*.txt'))):
    for n, line in enumerate(open(f, encoding='utf-8'), 1):
        line = line.strip()
        if not line or line.startswith('#'): continue
        parts = line.split('|')
        if len(parts) != 6:
            errors.append(f'{f}:{n} bad field count'); continue
        cat, name, al, pg, pl, src = parts
        if cat not in catkeys: errors.append(f'{f}:{n} bad cat {cat}'); continue
        if src.startswith('U:'):
            d = src[2:].strip()
            r = rows.get(d.lower())
            if not r:
                pref = [v for k, v in rows.items() if k.startswith(d.lower())]
                if len(pref) >= 1:
                    pref.sort(key=lambda v: len(v[0])); r = pref[0]
            if not r:
                errors.append(f'{os.path.basename(f)}:{n} {name}: no USDA "{d}"\n    ? ' + '\n    ? '.join(cands(d))); continue
            used[r[0]] = r
            kcal, p, fat, c, fib, alc = r[1:7]
            s = 'U'; ref = r[0]
        elif src.startswith('R:'):
            v = [float(x) for x in src[2:].split('/')]
            kcal, p, fat, c = v[:4]; fib = 0.0; alc = v[4] if len(v) > 4 else 0.0
            s = 'R'; ref = ''
        else:
            errors.append(f'{f}:{n} bad src'); continue
        it = {'n': name, 'c': cat, 'k': round(kcal), 'p': round(p, 1), 'f': round(fat, 1), 'u': round(c, 1),
              'pg': float(pg) if '.' in pg else int(pg), 'pl': pl, 's': s}
        if al.strip(): it['a'] = [a.strip() for a in al.split(',') if a.strip()]
        if fib: it['fib'] = round(fib, 1)
        if alc: it['alc'] = round(alc, 1)
        if ref: it['ref'] = ref
        items.append(it)
if errors:
    print('\n'.join(errors)); print(len(errors), 'errors'); sys.exit(1)
if full:
    with open(subset_path, 'w', encoding='utf-8') as o:
        o.write('# description\tkcal\tprotein_g\tfat_g\tcarb_by_difference_g\tfiber_g\talcohol_g  (USDA FoodData Central, SR Legacy, April 2018, public domain)\n')
        for d in sorted(used):
            r = used[d]; o.write('\t'.join([r[0]] + [('%g' % x) for x in r[1:7]]) + '\n')
out = os.path.join(ROOT, 'data', 'products.js')
os.makedirs(os.path.dirname(out), exist_ok=True)
def row(i):
    r = [i['n'], i['c'], i['k'], i['p'], i['f'], i['u'], i['pg'], i['pl'], i.get('a', []), i['s']]
    if i.get('fib') or i.get('alc'): r += [i.get('fib', 0), i.get('alc', 0)]
    return r
compact = [row(i) for i in items]
with open(out, 'w', encoding='utf-8') as o:
    o.write('/* База продуктов калькулятора калорий. Сгенерировано tools/resolve.py — не редактируйте вручную.\n')
    o.write('   Значения на 100 г съедобной части. Поля: [название, категория, ккал, белки, жиры, углеводы, порция г, подпись порции, синонимы, источник U=USDA SR Legacy / R=российские таблицы и типовые значения, (необяз.) клетчатка г, алкоголь г] */\n')
    o.write('(function (root) {\n"use strict";\nvar CATEGORIES = ' + json.dumps(CATS, ensure_ascii=False) + ';\n')
    o.write('var RAW = [\n' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in compact) + '\n];\n')
    o.write('var DATA = { categories: CATEGORIES, raw: RAW };\n')
    o.write('if (typeof module !== "undefined" && module.exports) { module.exports = DATA; } else { root.CALORIE_DATA = DATA; }\n')
    o.write('})(typeof window !== "undefined" ? window : this);\n')
from collections import Counter
print(len(items), 'items', dict(Counter(i['c'] for i in items)))
