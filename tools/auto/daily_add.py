#!/usr/bin/env python3
"""Ежедневное автопополнение базы калькулятора калорий реальными данными USDA FoodData Central (SR Legacy).

Берёт N (по умолчанию 50) следующих продуктов из очереди tools/auto/pool.tsv, отсекает дубли
(по нормализованному названию, slug, ID USDA и описанию USDA), проверяет правдоподобие значений,
делает бэкап, дописывает их в tools/spec/14-auto-usda.txt и tools/usda-sr-legacy-subset.tsv,
пересобирает data/products.js (tools/resolve.py) и SEO-цифры (tools/gen-seo.py, «Более N продуктов»,
sitemap lastmod), прогоняет проверки, при неудаче откатывается из бэкапа, при успехе — commit + push.

Запуск (на боксе, где есть node, Chrome и авторизованный git/gh):
  python3 tools/auto/daily_add.py [--count 50] [--dry-run] [--no-push] [--live-check]
Только стандартная библиотека Python. Для проверок нужны node и puppeteer-core (NODE_PATH).
Состояние вне репозитория: $CAL_AUTOFILL_HOME (по умолчанию /workspace/calorie-autofill): logs/, backups/.
Коды выхода: 0 — успех (или нечего добавлять), 1 — проверка не прошла, откат; 2 — ошибка git/push; 3 — живой сайт не обновился."""
import argparse, csv, datetime, fcntl, glob, json, os, re, shutil, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
HOME = os.environ.get('CAL_AUTOFILL_HOME', '/workspace/calorie-autofill')
NODE_PATH = os.environ.get('NODE_PATH', os.path.join(HOME, 'npm', 'node_modules'))
LIVE = 'https://adiga01fcb-coder.github.io/calorie-calculator/'
POOL = os.path.join(HERE, 'pool.tsv')
ADDED = os.path.join(HERE, 'added.tsv')
REJECTED = os.path.join(HERE, 'rejected.tsv')
SPEC = os.path.join(ROOT, 'tools', 'spec', '14-auto-usda.txt')
SUBSET = os.path.join(ROOT, 'tools', 'usda-sr-legacy-subset.tsv')
PRODUCTS = os.path.join(ROOT, 'data', 'products.js')
INDEX = os.path.join(ROOT, 'index.html')
SITEMAP = os.path.join(ROOT, 'sitemap.xml')
TRACKED = [PRODUCTS, INDEX, SITEMAP, SPEC, SUBSET, ADDED, REJECTED]
CATS = {'krupy', 'hleb', 'myaso', 'ryba', 'moloko', 'ovoshi', 'frukty', 'orehi', 'masla', 'sladkoe', 'napitki', 'fastfood', 'blyuda'}
NOW = datetime.datetime.now().astimezone()
TODAY = NOW.strftime('%Y-%m-%d')
TS = NOW.strftime('%Y%m%d-%H%M%S')
LOG = os.path.join(HOME, 'logs', 'daily.log')

def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    line = NOW.strftime('%Y-%m-%d %H:%M:%S %z') + ' ' + msg
    print(msg)
    with open(LOG, 'a', encoding='utf-8') as f: f.write(line + '\n')

def run(cmd, check=True, env=None, timeout=600):
    e = dict(os.environ); e.update(env or {})
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=e, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError('команда %s завершилась с кодом %d:\n%s%s' % (' '.join(cmd), r.returncode, r.stdout[-3000:], r.stderr[-3000:]))
    return r

def normalize(s):  # как Core.normalize в js/core.js
    s = str(s).lower().replace('ё', 'е')
    s = re.sub(r'[«»"\'`’().,;:!?/\\+\-–—%№]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

TR = dict(zip('абвгдезийклмнопрстуфхыэ', 'abvgdeziyklmnoprstufhye'))
TR.update({'ж': 'zh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ь': '', 'ю': 'yu', 'я': 'ya'})
def slugify(s):  # как Core.slugify
    t = ''.join(TR.get(ch, ch) for ch in normalize(s))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t))

def load_raw():
    src = open(PRODUCTS, encoding='utf-8').read()
    return json.loads('[' + src.split('var RAW = [', 1)[1].split('\n];', 1)[0] + ']')

def read_tsv(path):
    if not os.path.exists(path): return []
    lines = [l for l in open(path, encoding='utf-8') if not l.startswith('#')]
    return list(csv.DictReader(lines, delimiter='\t'))

def append_tsv(path, header, rows):
    new = not os.path.exists(path)
    with open(path, 'a', encoding='utf-8') as f:
        if new: f.write('\t'.join(header) + '\n')
        for r in rows: f.write('\t'.join(str(r[h]) for h in header) + '\n')

def plausible(c):
    try:
        k, p, fa, u, fib, alc = [float(c[x] or 0) for x in ('kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'alcohol_g')]
    except ValueError:
        return 'нечисловые значения'
    if min(k, p, fa, u, fib, alc) < 0: return 'отрицательные значения'
    if not 0 <= k <= 900: return 'ккал вне 0–900 (%g)' % k
    if p + fa + u > 100.5: return 'Б+Ж+У > 100 г (%.1f)' % (p + fa + u)
    est = 4 * p + 9 * fa + 4 * (u - fib) + 2 * fib + 7 * alc   # Этуотер, как в tests/test-data.js
    if abs(est - k) > max(12, k * 0.12): return 'ккал %g не согласуются с БЖУ (≈%.0f)' % (k, est)
    if c['cat'] not in CATS: return 'неизвестная категория ' + c['cat']
    if not c['name_ru'].strip() or '|' in c['name_ru']: return 'плохое название'
    return ''

def more_than(n):
    return (n // 50) * 50 if n >= 100 else n

def update_marketing(count):
    """«Более N продуктов» в meta description / og:description и lastmod в sitemap.xml."""
    h = open(INDEX, encoding='utf-8').read()
    m = more_than(count)
    h = re.sub(r'([Бб]олее) \d+ (продуктов)', lambda x: '%s %d %s' % (x.group(1), m, x.group(2)), h)
    open(INDEX, 'w', encoding='utf-8').write(h)
    if os.path.exists(SITEMAP):
        s = open(SITEMAP, encoding='utf-8').read()
        s = re.sub(r'<lastmod>[^<]*</lastmod>', '<lastmod>%s</lastmod>' % TODAY, s)
        open(SITEMAP, 'w', encoding='utf-8').write(s)

def page_check(url, expected, names):
    r = run(['node', os.path.join(HERE, 'check-page.js'), url, str(expected)] + names, check=False, env={'NODE_PATH': NODE_PATH}, timeout=900)
    try: res = json.loads(r.stdout)
    except Exception: res = {'ok': False, 'raw': r.stdout[-2000:] + r.stderr[-2000:]}
    return r.returncode == 0, res

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', type=int, default=50)
    ap.add_argument('--dry-run', action='store_true', help='только показать, что будет добавлено')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--live-check', action='store_true', help='после push дождаться GitHub Pages и проверить живой сайт')
    a = ap.parse_args()
    os.makedirs(HOME, exist_ok=True)
    lock = open(os.path.join(HOME, 'daily.lock'), 'w')
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError: log('ПРОПУСК: уже идёт другой запуск'); return 0

    if not a.dry_run:
        dirty = run(['git', 'status', '--porcelain']).stdout.strip()
        if dirty: log('ОШИБКА: в репозитории есть незакоммиченные изменения, запуск остановлен:\n' + dirty); return 2
        try: run(['git', 'pull', '--ff-only', '-q'])
        except Exception as e: log('ОШИБКА git pull: %s' % e); return 2

    raw = load_raw(); before = len(raw)
    names = {normalize(r[0]) for r in raw}; slugs = {slugify(r[0]) for r in raw}
    for r in raw:
        for al in (r[8] or []): names.add(normalize(al))
    subset = {l.split('\t')[0].lower() for l in open(SUBSET, encoding='utf-8') if not l.startswith('#')}
    done = {r['fdc_id'] for r in read_tsv(ADDED)} | {r['fdc_id'] for r in read_tsv(REJECTED)}
    pool = read_tsv(POOL)
    pick, rejected, remaining = [], [], 0
    for c in pool:
        if c['fdc_id'] in done: continue
        if len(pick) >= a.count: remaining += 1; continue
        why = plausible(c)
        if not why:
            if c['usda_description'].lower() in subset: why = 'описание USDA уже есть в базе'
            elif normalize(c['name_ru']) in names: why = 'название уже есть в базе'
            elif slugify(c['name_ru']) in slugs: why = 'slug уже есть в базе'
        if why:
            rejected.append(dict(date=TODAY, fdc_id=c['fdc_id'], name_ru=c['name_ru'], reason=why)); continue
        names.add(normalize(c['name_ru'])); slugs.add(slugify(c['name_ru'])); subset.add(c['usda_description'].lower())
        done.add(c['fdc_id']); pick.append(c)
    days = remaining // a.count if a.count else 0
    if a.dry_run:
        for c in pick: print('%s\t%s\t%s ккал\tUSDA %s' % (c['cat'], c['name_ru'], c['kcal'], c['fdc_id']))
        print('будет добавлено %d, отклонено %d, в очереди останется %d (≈%d дн.)' % (len(pick), len(rejected), remaining, days))
        return 0
    if not pick:
        if rejected: append_tsv(REJECTED, ['date', 'fdc_id', 'name_ru', 'reason'], rejected)
        log('ИТОГ: очередь кандидатов пуста, добавлено 0 (было %d). Нужно расширить tools/auto/pool.tsv.' % before)
        return 0

    bdir = os.path.join(HOME, 'backups', TS); os.makedirs(bdir)
    existed = {}
    for p in TRACKED:
        existed[p] = os.path.exists(p)
        if existed[p]: shutil.copy2(p, os.path.join(bdir, os.path.relpath(p, ROOT).replace('/', '__')))
    def rollback():
        for p in TRACKED:
            b = os.path.join(bdir, os.path.relpath(p, ROOT).replace('/', '__'))
            if existed[p]: shutil.copy2(b, p)
            elif os.path.exists(p): os.remove(p)
    try:
        with open(SPEC, 'a', encoding='utf-8') as f:
            if not existed[SPEC]:
                f.write('# Автопополнение (tools/auto/daily_add.py). Значения — USDA FoodData Central SR Legacy (public domain), по строке U:.\n')
            for c in pick:
                f.write('# fdc_id %s, NDB %s, добавлено %s\n' % (c['fdc_id'], c['ndb'], TODAY))
                f.write('%s|%s||100|1 порция|U:%s\n' % (c['cat'], c['name_ru'].strip(), c['usda_description']))
        with open(SUBSET, 'a', encoding='utf-8') as f:
            for c in pick:
                f.write('\t'.join([c['usda_description']] + ['%g' % float(c[k] or 0) for k in ('kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'alcohol_g')]) + '\n')
        run(['python3', 'tools/resolve.py'])
        run(['python3', 'tools/gen-seo.py'])
        after = len(load_raw())
        update_marketing(after)
        append_tsv(ADDED, ['date', 'fdc_id', 'ndb', 'cat', 'name_ru', 'usda_description', 'kcal'],
                   [dict(date=TODAY, fdc_id=c['fdc_id'], ndb=c['ndb'], cat=c['cat'], name_ru=c['name_ru'], usda_description=c['usda_description'], kcal=c['kcal']) for c in pick])
        if rejected: append_tsv(REJECTED, ['date', 'fdc_id', 'name_ru', 'reason'], rejected)
        # --- проверки ---
        if after != before + len(pick): raise RuntimeError('число продуктов %d ≠ %d + %d' % (after, before, len(pick)))
        run(['node', 'tests/run-all.js'])
        run(['node', 'tests/browser-check.js'], env={'NODE_PATH': NODE_PATH}, timeout=900)
        ok, res = page_check('file://' + INDEX, after, [c['name_ru'] for c in pick])
        if not ok: raise RuntimeError('проверка страницы: ' + json.dumps(res, ensure_ascii=False)[:3000])
    except Exception as e:
        rollback()
        log('ОТКАТ: %s. База осталась %d продуктов. Бэкап: %s' % (str(e)[:4000], before, bdir))
        return 1

    msg = 'Автопополнение базы: +%d продуктов (USDA SR Legacy), %d → %d, %s' % (len(pick), before, after, TODAY)
    sha = ''
    if not a.no_push:
        try:
            run(['git', 'add', '-A', '--', 'data', 'index.html', 'sitemap.xml', 'tools'])
            run(['git', 'commit', '-q', '-m', msg])
            sha = run(['git', 'rev-parse', '--short', 'HEAD']).stdout.strip()
            try: run(['git', 'push', '-q'])
            except Exception:
                run(['git', 'pull', '--rebase', '-q']); run(['git', 'push', '-q'])
        except Exception as e:
            log('ОШИБКА git: %s. Изменения проверены и %s; бэкап %s' % (str(e)[:2000], 'закоммичены локально ' + sha if sha else 'не закоммичены', bdir))
            return 2
    short = 'ИТОГ: добавлено %d (было %d, стало %d), отклонено %d, осталось в очереди %d (≈%d дн.), коммит %s%s' % (
        len(pick), before, after, len(rejected), remaining, days, sha or '-', '' if len(pick) == a.count else '. ВНИМАНИЕ: кандидатов меньше %d' % a.count)
    log(short)
    if a.live_check and not a.no_push:
        sample = [pick[0]['name_ru'], pick[len(pick) // 2]['name_ru'], pick[-1]['name_ru']]
        deadline = time.time() + 900; live_ok = False
        while time.time() < deadline:
            try:
                body = urllib.request.urlopen(LIVE + 'data/products.js?t=%d' % time.time(), timeout=30).read().decode('utf-8')
                if all(json.dumps(n, ensure_ascii=False) in body for n in sample): live_ok = True; break
            except Exception: pass
            time.sleep(20)
        if not live_ok: log('ЖИВОЙ САЙТ: за 15 мин GitHub Pages не отдал новую базу'); return 3
        ok, res = page_check(LIVE, after, sample)
        log('ЖИВОЙ САЙТ: %s, HTTP %s, продуктов %s, поиск %s, ошибок JS %d' % ('OK' if ok else 'ОШИБКА', res.get('status'), res.get('count'),
            json.dumps(res.get('search'), ensure_ascii=False), len(res.get('errors', []))))
        if not ok: return 3
    return 0

if __name__ == '__main__':
    sys.exit(main())
