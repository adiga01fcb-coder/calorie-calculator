/* Логика калькулятора калорий: поиск, расчёт, дневник. Без зависимостей.
   Работает и в браузере (window.CalorieCore), и в Node (module.exports) — для тестов. */
(function (root) {
  "use strict";

  var POPULAR = [
    "Яйцо куриное", "Банан", "Гречка варёная", "Куриная грудка (сырая)", "Рис белый варёный",
    "Творог 5%", "Бургер Биг Мак / Биг Хит", "Овсяная каша на воде", "Картофель отварной",
    "Яблоко", "Молоко 2,5%", "Хлеб белый (батон)", "Макароны варёные", "Авокадо",
    "Шаурма с курицей", "Борщ с говядиной", "Пицца Пепперони", "Огурец", "Помидор", "Кефир 2,5%",
    "Сыр российский 50%", "Курица запечённая с кожей", "Кофе чёрный (американо)", "Кола"
  ];

  function normalize(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[«»"'`’().,;:!?/\\+\-–—%№]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function slugify(s) {
    var map = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
      н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
      ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
    return normalize(s).split("").map(function (ch) {
      return Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
    }).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function buildProducts(data) {
    var cats = {};
    data.categories.forEach(function (c) { cats[c[0]] = c[1]; });
    var popularRank = {};
    POPULAR.forEach(function (n, i) { popularRank[n] = POPULAR.length - i; });
    return data.raw.map(function (r, idx) {
      var aliases = r[8] || [];
      var p = {
        id: idx,
        name: r[0], cat: r[1], catName: cats[r[1]] || r[1],
        kcal: r[2], protein: r[3], fat: r[4], carbs: r[5],
        portion: r[6], portionLabel: r[7], aliases: aliases, source: r[9],
        fiber: r[10] || 0, alcohol: r[11] || 0,
        slug: slugify(r[0]),
        popular: popularRank[r[0]] || 0
      };
      p._name = normalize(p.name);
      p._aliases = aliases.map(normalize);
      p._words = (p._name + " " + p._aliases.join(" ")).split(" ").filter(Boolean);
      return p;
    });
  }

  /* Расстояние Дамерау–Левенштейна (ограниченное), для опечаток. */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }

  /* Совпадение одного слова запроса со словом продукта с учётом окончаний и опечаток. */
  function wordScore(q, w) {
    if (w === q) return 1;
    if (w.indexOf(q) === 0) return 0.9;
    // падежные окончания: «яйце» → «яйцо», «гречке» → «гречка», «рисе» → «рис»
    if (w.length >= 3 && q.indexOf(w) === 0 && q.length - w.length <= 2) return 0.8;
    var minLen = Math.min(q.length, w.length);
    if (minLen >= 4 && Math.abs(w.length - q.length) <= 2) {
      var need = Math.max(3, minLen >= 6 ? minLen - 2 : minLen - 1), k = 0;
      while (k < minLen && q[k] === w[k]) k++;
      if (k >= need) return 0.8;
    }
    if (w.indexOf(q) > 0 && q.length >= 3) return 0.6;
    if (q.length >= 4) {
      var max = q.length >= 7 ? 2 : 1;
      var d = Math.min(editDistance(q, w.slice(0, q.length), max), editDistance(q, w, max));
      if (d <= max) return 0.55 - d * 0.1;
    }
    return 0;
  }

  var STOP = { "сколько": 1, "калорий": 1, "калории": 1, "калорийность": 1, "ккал": 1, "в": 1, "во": 1, "грамм": 1, "г": 1, "на": 1, "100": 1 };

  function search(products, query, limit) {
    limit = limit || 8;
    var q = normalize(query);
    if (!q) return [];
    var tokens = q.split(" ").filter(function (t) { return !STOP[t]; });
    if (!tokens.length) tokens = q.split(" ");
    var qJoined = tokens.join(" ");
    var results = [];
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var score = 0;
      if (p._name === qJoined) score = 1000;
      else if (p._aliases.indexOf(qJoined) !== -1) score = 900;
      else if (p._name.indexOf(qJoined) === 0) score = 800;
      else {
        var aliasPrefix = false;
        for (var a = 0; a < p._aliases.length; a++) if (p._aliases[a].indexOf(qJoined) === 0) { aliasPrefix = true; break; }
        if (aliasPrefix) score = 650;
        else if (qJoined.length >= 2 && (" " + p._name).indexOf(" " + qJoined) !== -1) score = 600;
        else if (qJoined.length >= 3 && p._name.indexOf(qJoined) !== -1) score = 450;
      }
      if (!score) {
        // каждое слово запроса должно совпасть с каким-то словом продукта
        var total = 0, ok = true, nameHits = 0;
        var nameWords = p._name.split(" ");
        for (var t = 0; t < tokens.length; t++) {
          var best = 0, inName = false;
          for (var w = 0; w < p._words.length; w++) {
            var s = wordScore(tokens[t], p._words[w]);
            if (s > best) { best = s; inName = nameWords.indexOf(p._words[w]) !== -1; }
          }
          if (!best) { ok = false; break; }
          if (inName) nameHits++;
          total += best;
        }
        if (ok) score = 200 + 200 * (total / tokens.length) + 30 * (nameHits / tokens.length);
      }
      if (score) {
        var base = score;
        score += p.popular * 4;               // популярные продукты выше
        score -= Math.min(p.name.length, 60) * 0.5; // короткие названия выше
        results.push({ p: p, score: score, base: base });
      }
    }
    // если есть прямые совпадения, не показываем «опечаточные» (только по расстоянию правки)
    if (results.some(function (r) { return r.base >= 600; })) results = results.filter(function (r) { return r.base > 320; });
    results.sort(function (x, y) { return y.score - x.score || x.p.name.localeCompare(y.p.name, "ru"); });
    return results.slice(0, limit).map(function (r) { return r.p; });
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  function toGrams(product, amount, unit) {
    var a = Number(String(amount).replace(",", "."));
    if (!isFinite(a) || a < 0) return NaN;
    return unit === "portion" ? a * product.portion : a;
  }

  function calculate(product, amount, unit) {
    var g = toGrams(product, amount, unit);
    if (!product || !isFinite(g)) return null;
    var k = g / 100;
    return {
      grams: round1(g),
      kcal: Math.round(product.kcal * k),
      protein: round1(product.protein * k),
      fat: round1(product.fat * k),
      carbs: round1(product.carbs * k)
    };
  }

  function fmt(n, digits) {
    if (n == null || !isFinite(n)) return "—";
    var d = digits == null ? 1 : digits;
    var s = (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
    if (d > 0) s = s.replace(/\.?0+$/, "");
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return parts.join(",");
  }

  /* ---------- Дневник ---------- */
  var STORAGE_KEY = "calorie-diary-v1";
  var GOAL_KEY = "calorie-goal-v1";
  var MEALS = [["breakfast", "Завтрак"], ["lunch", "Обед"], ["dinner", "Ужин"], ["snack", "Перекус"]];

  function dateKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function shiftDate(key, days) {
    var p = key.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days);
    return dateKey(d);
  }

  function memoryStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  function createDiary(storage) {
    var store = storage || memoryStorage();
    var data = {};
    var persistent = true;
    try {
      var raw = store.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
      }
    } catch (e) { data = {}; }

    function save() {
      try { store.setItem(STORAGE_KEY, JSON.stringify(data)); persistent = true; }
      catch (e) { persistent = false; }
    }

    var api = {
      isPersistent: function () { return persistent; },
      entries: function (day) { return (data[day] || []).slice(); },
      add: function (day, entry) {
        var e = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: String(entry.name),
          grams: round1(Number(entry.grams) || 0),
          kcal: Math.round(Number(entry.kcal) || 0),
          protein: round1(Number(entry.protein) || 0),
          fat: round1(Number(entry.fat) || 0),
          carbs: round1(Number(entry.carbs) || 0),
          meal: MEALS.some(function (m) { return m[0] === entry.meal; }) ? entry.meal : "snack",
          t: Date.now()
        };
        (data[day] = data[day] || []).push(e);
        save();
        return e;
      },
      remove: function (day, id) {
        var list = data[day] || [];
        var n = list.length;
        data[day] = list.filter(function (e) { return e.id !== id; });
        if (!data[day].length) delete data[day];
        save();
        return n !== (data[day] || []).length;
      },
      clear: function (day) { delete data[day]; save(); },
      totals: function (day) {
        return (data[day] || []).reduce(function (s, e) {
          s.kcal += e.kcal; s.protein += e.protein; s.fat += e.fat; s.carbs += e.carbs; s.count++;
          return s;
        }, { kcal: 0, protein: 0, fat: 0, carbs: 0, count: 0 });
      },
      days: function () { return Object.keys(data).filter(function (k) { return data[k].length; }).sort(); },
      getGoal: function () {
        var g = Number(store.getItem(GOAL_KEY));
        return g > 0 ? g : 2000;
      },
      setGoal: function (g) {
        g = Math.round(Number(g));
        if (!(g >= 500 && g <= 10000)) return false;
        try { store.setItem(GOAL_KEY, String(g)); } catch (e) { return false; }
        return true;
      }
    };
    return api;
  }

  var Core = {
    POPULAR: POPULAR, MEALS: MEALS, STORAGE_KEY: STORAGE_KEY,
    normalize: normalize, slugify: slugify, buildProducts: buildProducts, editDistance: editDistance,
    search: search, toGrams: toGrams, calculate: calculate, fmt: fmt,
    dateKey: dateKey, shiftDate: shiftDate, createDiary: createDiary, memoryStorage: memoryStorage
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.CalorieCore = Core;
})(typeof window !== "undefined" ? window : this);
