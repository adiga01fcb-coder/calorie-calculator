/* Интерфейс калькулятора калорий. Логика — в js/core.js, данные — в data/products.js. */
(function () {
  "use strict";
  var C = window.CalorieCore;
  var DATA = window.CALORIE_DATA;
  if (!C || !DATA) return;

  var products = C.buildProducts(DATA);
  var byName = {};
  products.forEach(function (p) { byName[p.name] = p; });

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var fmt = C.fmt;

  var storage = null;
  try { storage = window.localStorage; storage.getItem("x"); } catch (e) { storage = null; }
  var diary = C.createDiary(storage || undefined);

  var state = { product: null, unit: "g", day: C.dateKey(), results: [], active: -1 };

  /* ---------- Автоподсказки ---------- */
  var input = $("q"), list = $("q-list"), clearBtn = $("q-clear");

  function highlight(name, query) {
    var qn = C.normalize(query).split(" ").filter(function (t) { return t.length > 1; });
    var norm = name.toLowerCase().replace(/ё/g, "е");
    var marks = [];
    qn.forEach(function (t) {
      var i = norm.indexOf(t);
      if (i === -1 && t.length > 3) i = norm.indexOf(t.slice(0, t.length - 1));
      if (i !== -1) marks.push([i, i + Math.min(t.length, norm.length - i)]);
    });
    if (!marks.length) return esc(name);
    marks.sort(function (a, b) { return a[0] - b[0]; });
    var out = "", pos = 0;
    marks.forEach(function (m) {
      if (m[0] < pos) return;
      out += esc(name.slice(pos, m[0])) + "<mark>" + esc(name.slice(m[0], m[1])) + "</mark>";
      pos = m[1];
    });
    return out + esc(name.slice(pos));
  }

  function openList() { list.hidden = false; input.setAttribute("aria-expanded", "true"); }
  function closeList() {
    list.hidden = true; input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant"); state.active = -1;
  }

  function renderList() {
    var q = input.value;
    clearBtn.hidden = !q;
    if (!C.normalize(q)) { closeList(); return; }
    state.results = C.search(products, q, 8);
    state.active = state.results.length ? 0 : -1;
    if (!state.results.length) {
      list.innerHTML = '<li class="opt--none" role="option" aria-disabled="true">Ничего не нашлось. Попробуйте другое название или проверьте опечатки.</li>';
    } else {
      list.innerHTML = state.results.map(function (p, i) {
        return '<li role="option" id="opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === state.active) + '">' +
          '<span class="opt__name">' + highlight(p.name, q) + '</span>' +
          '<span class="opt__cat">' + esc(p.catName) + '</span>' +
          '<span class="opt__kcal">' + p.kcal + ' ккал / 100 г</span></li>';
      }).join("");
    }
    openList();
    setActive(state.active);
  }

  function setActive(i) {
    state.active = i;
    var items = list.querySelectorAll("li[data-i]");
    for (var k = 0; k < items.length; k++) items[k].setAttribute("aria-selected", String(k === i));
    if (i >= 0 && items[i]) {
      input.setAttribute("aria-activedescendant", "opt-" + i);
      var el = items[i];
      if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
      else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
    } else input.removeAttribute("aria-activedescendant");
  }

  input.addEventListener("input", renderList);
  input.addEventListener("focus", function () { if (input.value && (!state.product || input.value !== state.product.name)) renderList(); });
  input.addEventListener("keydown", function (e) {
    var n = state.results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) { renderList(); return; }
      if (n) setActive((state.active + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive((state.active - 1 + n) % n);
    } else if (e.key === "Enter") {
      if (!list.hidden && n) { e.preventDefault(); choose(state.results[Math.max(0, state.active)]); }
    } else if (e.key === "Escape") {
      if (!list.hidden) { e.preventDefault(); closeList(); }
    } else if (e.key === "Tab") {
      if (!list.hidden && n && state.active >= 0) choose(state.results[state.active], true);
    }
  });
  input.addEventListener("blur", function () { setTimeout(closeList, 120); });
  list.addEventListener("mousedown", function (e) { e.preventDefault(); });
  list.addEventListener("click", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) choose(state.results[Number(li.getAttribute("data-i"))]);
  });
  clearBtn.addEventListener("click", function () {
    input.value = ""; clearBtn.hidden = true; closeList(); input.focus();
  });

  function choose(p, keepFocus) {
    if (!p) return;
    state.product = p;
    input.value = p.name;
    clearBtn.hidden = false;
    closeList();
    if (state.unit === "portion" && !(Number(String($("amount").value).replace(",", ".")) > 0)) $("amount").value = "1";
    if (state.unit === "g" && !(Number(String($("amount").value).replace(",", ".")) > 0)) $("amount").value = "100";
    update();
    if (!keepFocus && window.matchMedia && window.matchMedia("(pointer: coarse)").matches) input.blur();
  }

  /* ---------- Количество и единицы ---------- */
  var amount = $("amount");
  var segBtns = document.querySelectorAll(".seg button");

  function setUnit(u, convert) {
    if (u === state.unit) return;
    var p = state.product;
    var a = Number(String(amount.value).replace(",", "."));
    if (convert) {
      // в порции — начинаем с одной; в граммы — переводим текущие порции в граммы
      if (u === "portion") amount.value = "1";
      else amount.value = p && a > 0 ? fmt(a * p.portion, 0).replace(/\u00a0/g, "") : "100";
    }
    state.unit = u;
    for (var i = 0; i < segBtns.length; i++) segBtns[i].setAttribute("aria-checked", String(segBtns[i].getAttribute("data-unit") === u));
    update();
  }
  for (var i = 0; i < segBtns.length; i++) {
    segBtns[i].addEventListener("click", function () { setUnit(this.getAttribute("data-unit"), true); });
  }
  document.querySelector(".seg").addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      var u = state.unit === "g" ? "portion" : "g";
      setUnit(u, true);
      document.querySelector('.seg button[data-unit="' + u + '"]').focus();
    }
  });
  amount.addEventListener("input", update);

  $("quick-amounts").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-amount]");
    if (!b) return;
    var u = b.getAttribute("data-unit");
    if (u !== state.unit) {
      state.unit = u;
      for (var i = 0; i < segBtns.length; i++) segBtns[i].setAttribute("aria-checked", String(segBtns[i].getAttribute("data-unit") === u));
    }
    amount.value = b.getAttribute("data-amount");
    update();
  });

  function renderQuick() {
    var p = state.product, box = $("quick-amounts");
    if (!p) { box.innerHTML = ""; return; }
    var opts = [["g", "50", "50 г"], ["g", "100", "100 г"], ["g", "200", "200 г"],
      ["portion", "1", "1 порция · " + fmt(p.portion, 0) + " г"], ["portion", "2", "2 порции · " + fmt(p.portion * 2, 0) + " г"]];
    box.innerHTML = opts.map(function (o) {
      return '<button type="button" data-unit="' + o[0] + '" data-amount="' + o[1] + '">' + esc(o[2]) + "</button>";
    }).join("");
  }

  /* ---------- Результат ---------- */
  var lastCalc = null;
  function update() {
    var p = state.product;
    var hint = $("portion-hint");
    renderQuick();
    if (!p) {
      $("result-empty").hidden = false; $("result-body").hidden = true; lastCalc = null;
      hint.textContent = "Выберите продукт, чтобы увидеть размер порции.";
      return;
    }
    hint.textContent = "Порция: " + p.portionLabel + " = " + fmt(p.portion, 0) + " г.";
    var r = C.calculate(p, amount.value, state.unit);
    $("result-empty").hidden = true; $("result-body").hidden = false;
    $("r-name").textContent = p.name;
    if (!r) {
      lastCalc = null;
      $("r-meta").textContent = "Введите количество числом, например 150 или 1,5";
      $("r-kcal").textContent = "—"; $("r-p").textContent = "—"; $("r-f").textContent = "—"; $("r-c").textContent = "—";
      $("add-btn").disabled = true;
    } else {
      lastCalc = r;
      $("add-btn").disabled = r.grams <= 0;
      $("r-meta").textContent = (state.unit === "portion" ? fmt(Number(String(amount.value).replace(",", ".")), 2) + " × " + p.portionLabel + " = " : "") + fmt(r.grams, 1) + " г · " + p.catName;
      $("r-kcal").textContent = fmt(r.kcal, 0);
      $("r-p").textContent = fmt(r.protein, 1) + " г";
      $("r-f").textContent = fmt(r.fat, 1) + " г";
      $("r-c").textContent = fmt(r.carbs, 1) + " г";
      var kp = r.protein * 4, kf = r.fat * 9, kc = r.carbs * 4, sum = kp + kf + kc || 1;
      $("r-p-bar").style.width = Math.round(kp / sum * 100) + "%";
      $("r-f-bar").style.width = Math.round(kf / sum * 100) + "%";
      $("r-c-bar").style.width = Math.round(kc / sum * 100) + "%";
    }
    $("r-per100").textContent = "На 100 г: " + p.kcal + " ккал · Б " + fmt(p.protein) + " г · Ж " + fmt(p.fat) + " г · У " + fmt(p.carbs) + " г" +
      (p.source === "U" ? " · источник: USDA" : " · источник: российские таблицы");
  }

  /* ---------- Дневник ---------- */
  var MEAL_NAMES = {};
  C.MEALS.forEach(function (m) { MEAL_NAMES[m[0]] = m[1]; });

  function defaultMeal() {
    var h = new Date().getHours();
    return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 21 ? "dinner" : "snack";
  }
  $("meal").value = defaultMeal();

  function dayTitle(key) {
    var p = key.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var today = C.dateKey(), label = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    if (key === today) return "Сегодня, " + label;
    if (key === C.shiftDate(today, -1)) return "Вчера, " + label;
    if (key === C.shiftDate(today, 1)) return "Завтра, " + label;
    return label.charAt(0).toUpperCase() + label.slice(1) + (p[0] !== String(new Date().getFullYear()) ? " " + p[0] : "");
  }

  function renderDiary() {
    var day = state.day, entries = diary.entries(day), t = diary.totals(day), goal = diary.getGoal();
    $("day").value = day;
    $("day-title").textContent = dayTitle(day);
    $("t-kcal").textContent = fmt(t.kcal, 0);
    $("t-p").textContent = fmt(t.protein, 1);
    $("t-f").textContent = fmt(t.fat, 1);
    $("t-c").textContent = fmt(t.carbs, 1);
    if (document.activeElement !== $("goal")) $("goal").value = goal;
    var pct = Math.min(100, Math.round(t.kcal / goal * 100));
    var bar = $("goal-bar");
    bar.style.width = pct + "%";
    bar.className = t.kcal > goal ? "over" : "";
    $("goal-text").textContent = t.kcal > goal ? "Больше цели на " + fmt(t.kcal - goal, 0) + " ккал" : "Осталось " + fmt(goal - t.kcal, 0) + " ккал";
    $("diary-empty").hidden = entries.length > 0;
    $("day-clear").hidden = entries.length === 0;
    var html = "";
    C.MEALS.forEach(function (m) {
      var items = entries.filter(function (e) { return e.meal === m[0]; });
      if (!items.length) return;
      var sum = items.reduce(function (s, e) { return s + e.kcal; }, 0);
      html += '<div class="meal"><div class="meal__head"><span>' + m[1] + "</span><span>" + fmt(sum, 0) + " ккал</span></div><ul>" +
        items.map(function (e) {
          return '<li class="entry"><span class="entry__name">' + esc(e.name) + "</span>" +
            '<span class="entry__meta">' + fmt(e.grams, 1) + " г · Б " + fmt(e.protein) + " · Ж " + fmt(e.fat) + " · У " + fmt(e.carbs) + "</span>" +
            '<span class="entry__kcal">' + fmt(e.kcal, 0) + " ккал</span>" +
            '<button type="button" class="entry__del" data-del="' + esc(e.id) + '" aria-label="Удалить: ' + esc(e.name) + '">×</button></li>';
        }).join("") + "</ul></div>";
    });
    $("diary-list").innerHTML = html;
    $("storage-note").hidden = !!storage && diary.isPersistent();
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  $("add-btn").addEventListener("click", function () {
    if (!state.product || !lastCalc || lastCalc.grams <= 0) return;
    var meal = $("meal").value;
    diary.add(state.day, {
      name: state.product.name, grams: lastCalc.grams, kcal: lastCalc.kcal,
      protein: lastCalc.protein, fat: lastCalc.fat, carbs: lastCalc.carbs, meal: meal
    });
    renderDiary();
    toast("Добавлено: " + MEAL_NAMES[meal].toLowerCase() + ", " + dayTitle(state.day).split(",")[0].toLowerCase() + " — " + fmt(lastCalc.kcal, 0) + " ккал");
  });
  $("diary-list").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-del]");
    if (!b) return;
    diary.remove(state.day, b.getAttribute("data-del"));
    renderDiary();
  });
  $("day-prev").addEventListener("click", function () { state.day = C.shiftDate(state.day, -1); renderDiary(); });
  $("day-next").addEventListener("click", function () { state.day = C.shiftDate(state.day, 1); renderDiary(); });
  $("day-today").addEventListener("click", function () { state.day = C.dateKey(); renderDiary(); });
  $("day").addEventListener("change", function () { if (/^\d{4}-\d{2}-\d{2}$/.test(this.value)) { state.day = this.value; renderDiary(); } });
  $("day-clear").addEventListener("click", function () {
    if (!diary.entries(state.day).length) return;
    if (window.confirm("Удалить все записи за " + dayTitle(state.day).toLowerCase() + "?")) { diary.clear(state.day); renderDiary(); }
  });
  $("goal").addEventListener("change", function () {
    if (!diary.setGoal(this.value)) this.value = diary.getGoal();
    renderDiary();
  });

  /* ---------- Популярные и «Посчитать» ---------- */
  var chipNames = ["Яйцо куриное", "Банан", "Гречка варёная", "Куриная грудка (сырая)", "Рис белый варёный", "Творог 5%", "Бургер Биг Мак / Биг Хит", "Яблоко"];
  $("popular").innerHTML = chipNames.filter(function (n) { return byName[n]; }).map(function (n) {
    return '<button type="button" class="chip" data-pick="' + esc(n) + '">' + esc(n.replace(/ \(.*\)$/, "").replace(/ \/ .*$/, "")) + "</button>";
  }).join("");

  function pick(name, scroll) {
    var p = byName[name];
    if (!p) return;
    choose(p, true);
    if (scroll) $("kalkulyator").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pick]");
    if (b) { pick(b.getAttribute("data-pick"), !b.classList.contains("chip")); return; }
    var tr = e.target.closest("tr[data-name]");
    if (tr) pick(tr.getAttribute("data-name"), true);
  });

  /* ---------- Таблица калорийности ---------- */
  var catSel = $("t-cat"), tFilter = $("t-filter"), tBody = $("t-body"), tMore = $("t-more");
  DATA.categories.forEach(function (c) {
    var o = document.createElement("option"); o.value = c[0]; o.textContent = c[1]; catSel.appendChild(o);
  });
  var PAGE = 60, shown = PAGE;
  function tableRows() {
    var q = C.normalize(tFilter.value), cat = catSel.value;
    var rows = products.filter(function (p) {
      if (cat && p.cat !== cat) return false;
      if (!q) return true;
      return p._name.indexOf(q) !== -1 || p._aliases.some(function (a) { return a.indexOf(q) !== -1; });
    });
    if (q && !rows.length) rows = C.search(products, q, 20).filter(function (p) { return !cat || p.cat === cat; });
    return rows;
  }
  function renderTable() {
    var rows = tableRows(), html = "", lastCat = null, grouped = !C.normalize(tFilter.value);
    rows.slice(0, shown).forEach(function (p) {
      if (grouped && p.cat !== lastCat) { html += '<tr class="cat-row"><th colspan="5" scope="rowgroup">' + esc(p.catName) + "</th></tr>"; lastCat = p.cat; }
      html += '<tr data-name="' + esc(p.name) + '"><th scope="row">' + esc(p.name) + "</th><td>" + p.kcal + "</td><td>" + fmt(p.protein) +
        "</td><td>" + fmt(p.fat) + "</td><td>" + fmt(p.carbs) + "</td></tr>";
    });
    tBody.innerHTML = html || '<tr><td colspan="5" style="text-align:left">Ничего не нашлось.</td></tr>';
    $("t-count").textContent = "Показано " + Math.min(shown, rows.length) + " из " + rows.length;
    tMore.hidden = rows.length <= shown;
  }
  tFilter.addEventListener("input", function () { shown = PAGE; renderTable(); });
  catSel.addEventListener("change", function () { shown = PAGE; renderTable(); });
  tMore.addEventListener("click", function () { shown += PAGE * 2; renderTable(); });

  /* ---------- Старт ---------- */
  var countEl = document.querySelector("[data-count]");
  if (countEl) countEl.textContent = String(products.length);
  renderTable();
  renderDiary();
  update();
  window.addEventListener("storage", function (e) { if (e.key === C.STORAGE_KEY) { diary = C.createDiary(storage); renderDiary(); } });
})();
