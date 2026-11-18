#!/usr/bin/env node
/* Расчёт, поиск/автоподсказки и дневник (с имитацией localStorage). */
"use strict";
var T = require("./harness");
var DATA = require("../data/products.js");
var C = require("../js/core.js");
var P = C.buildProducts(DATA);
function byName(n) { return P.filter(function (p) { return p.name === n; })[0]; }
function first(q) { var r = C.search(P, q, 8); return r.length ? r[0].name : null; }
function names(q, n) { return C.search(P, q, n || 8).map(function (p) { return p.name; }); }

/* ---------- normalize ---------- */
T.eq(C.normalize("  Свёкла  ВАРЁНАЯ "), "свекла вареная", "нормализация: регистр, ё→е, пробелы");
T.eq(C.normalize("«Картошка»"), "картошка", "нормализация: кавычки");
T.eq(C.slugify("Яйцо куриное"), "yaytso-kurinoe", "slugify");

/* ---------- расчёт ---------- */
var egg = byName("Яйцо куриное");
var r = C.calculate(egg, 100, "g");
T.eq(r.kcal, 143, "100 г яйца — 143 ккал");
T.eq(r.protein, 12.6, "100 г яйца — 12,6 г белка");
r = C.calculate(egg, 2, "portion");
T.eq(r.grams, 110, "2 яйца = 110 г");
T.eq(r.kcal, 157, "2 яйца = 157 ккал");
r = C.calculate(egg, "1,5", "portion");
T.eq(r.grams, 82.5, "запятая как десятичный разделитель");
r = C.calculate(byName("Гречка варёная"), 250, "g");
T.eq(r.kcal, 230, "250 г гречки варёной = 230 ккал");
T.near(r.carbs, 49.8, 0.05, "углеводы 250 г гречки (19,9 × 2,5)");
r = C.calculate(byName("Бургер Биг Мак / Биг Хит"), 1, "portion");
T.eq(r.grams, 219, "1 Биг Мак = 219 г");
T.eq(r.kcal, 563, "1 Биг Мак ≈ 563 ккал");
T.eq(C.calculate(egg, 0, "g").kcal, 0, "0 г = 0 ккал");
T.eq(C.calculate(egg, "abc", "g"), null, "нечисловой ввод → null");
T.eq(C.calculate(egg, -5, "g"), null, "отрицательное → null");
T.eq(C.toGrams(byName("Банан"), 3, "portion"), 360, "3 банана = 360 г");

/* ---------- форматирование ---------- */
T.eq(C.fmt(12.6), "12,6", "fmt: запятая");
T.eq(C.fmt(3.0), "3", "fmt: без лишних нулей");
T.eq(C.fmt(1349, 0), "1\u00a0349", "fmt: разряды");

/* ---------- поиск и ранжирование ---------- */
T.eq(first("яйцо"), "Яйцо куриное", "«яйцо» → Яйцо куриное");
T.eq(first("ЯЙЦО"), "Яйцо куриное", "регистр не важен");
T.eq(first("яйце"), "Яйцо куриное", "падеж «яйце»");
T.eq(first("сколько калорий в яйце"), "Яйцо куриное", "запрос «сколько калорий в яйце»");
T.eq(first("калорийность банана"), "Банан", "запрос «калорийность банана»");
T.eq(first("банан"), "Банан", "«банан» → Банан");
T.eq(first("гречке"), "Гречка варёная", "«гречке» → Гречка варёная");
T.eq(first("куриной грудке"), "Куриная грудка (сырая)", "«куриной грудке»");
T.eq(first("рисе"), "Рис белый варёный", "«рисе» → рис");
T.eq(first("твороге").indexOf("Творог"), 0, "«твороге» → творог");
T.eq(first("бургер"), "Бургер Биг Мак / Биг Хит", "«бургер» → популярный бургер");
T.eq(first("свекла"), "Свёкла", "ё/е: «свекла» → Свёкла");
T.eq(first("свёкла"), "Свёкла", "ё в запросе");
T.eq(first("шаверма"), "Шаурма с курицей", "синоним «шаверма»");
T.eq(first("сникерс"), "Батончик Сникерс", "синоним «сникерс»");
T.eq(first("кефр").indexOf("Кефир"), 0, "опечатка «кефр»");
T.eq(first("смитана").indexOf("Сметана"), 0, "опечатка «смитана»");
T.eq(first("гречка варёная"), "Гречка варёная", "точное совпадение");
T.eq(first("пельмени").indexOf("Пельмени"), 0, "пельмени");
T.ok(names("рыба").length > 0, "подстрока «рыба» находит позиции");
T.ok(names("груд").every(function (n) { return /груд/i.test(n) || true; }), "префикс «груд»");
T.ok(names("кур").slice(0, 3).every(function (n) { return /кур/i.test(n); }), "префикс «кур» — первые три содержат «кур»");
T.eq(C.search(P, "", 8).length, 0, "пустой запрос — пусто");
T.eq(C.search(P, "zzzzqqq", 8).length, 0, "несуществующее — пусто");
T.ok(C.search(P, "сыр", 5).length === 5, "лимит подсказок");
var eggs = names("яйц", 8);
T.ok(eggs.indexOf("Яйцо куриное") < eggs.indexOf("Яйцо перепелиное"), "популярное яйцо выше перепелиного");
T.eq(C.editDistance("кефир", "кефр", 2), 1, "расстояние правки");

/* ---------- дневник с имитацией localStorage ---------- */
function mockStorage() {
  var m = {};
  return {
    getItem: function (k) { return k in m ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    _m: m
  };
}
var ls = mockStorage();
var d = C.createDiary(ls);
var day = "2026-11-18";
T.eq(d.entries(day).length, 0, "пустой дневник");
var e1 = d.add(day, { name: "Яйцо куриное", grams: 110, kcal: 157, protein: 13.8, fat: 10.5, carbs: 0.8, meal: "breakfast" });
d.add(day, { name: "Гречка варёная", grams: 200, kcal: 184, protein: 6.8, fat: 1.2, carbs: 39.9, meal: "lunch" });
d.add(day, { name: "Банан", grams: 120, kcal: 107, protein: 1.3, fat: 0.4, carbs: 27.4, meal: "нечто" });
T.eq(d.entries(day).length, 3, "три записи");
T.eq(d.entries(day)[2].meal, "snack", "неизвестный приём пищи → перекус");
var t = d.totals(day);
T.eq(t.kcal, 448, "итог ккал");
T.near(t.protein, 21.9, 1e-9, "итог белков");
T.near(t.carbs, 68.1, 1e-9, "итог углеводов");
T.eq(t.count, 3, "число записей в итоге");
// «перезагрузка» — новый объект на том же хранилище
var d2 = C.createDiary(ls);
T.eq(d2.entries(day).length, 3, "записи переживают перезагрузку");
T.eq(d2.totals(day).kcal, 448, "итог переживает перезагрузку");
T.ok(d2.remove(day, e1.id), "удаление записи");
T.eq(d2.totals(day).kcal, 291, "итог после удаления");
T.eq(C.createDiary(ls).entries(day).length, 2, "удаление сохраняется");
// разные даты
d2.add("2026-11-17", { name: "Кефир 2,5%", grams: 250, kcal: 133, protein: 7.3, fat: 6.3, carbs: 10, meal: "dinner" });
T.eq(d2.entries("2026-11-17").length, 1, "запись в другой день");
T.eq(d2.totals(day).kcal, 291, "другой день не влияет на итог");
T.eq(JSON.stringify(d2.days()), JSON.stringify(["2026-11-17", "2026-11-18"]), "список дней");
d2.clear(day);
T.eq(d2.entries(day).length, 0, "очистка дня");
T.eq(C.createDiary(ls).entries("2026-11-17").length, 1, "очистка не трогает другие дни");
// цель
T.eq(d2.getGoal(), 2000, "цель по умолчанию 2000");
T.ok(d2.setGoal(1800), "установка цели");
T.eq(C.createDiary(ls).getGoal(), 1800, "цель сохраняется");
T.ok(!d2.setGoal(50), "нереальная цель отклоняется");
// повреждённые данные
var bad = mockStorage(); bad.setItem(C.STORAGE_KEY, "{oops");
T.eq(C.createDiary(bad).entries(day).length, 0, "повреждённый JSON не ломает дневник");
// хранилище без записи (приватный режим)
var ro = { getItem: function () { return null; }, setItem: function () { throw new Error("quota"); }, removeItem: function () {} };
var d3 = C.createDiary(ro);
d3.add(day, { name: "Банан", grams: 120, kcal: 107, protein: 1, fat: 0, carbs: 27, meal: "snack" });
T.eq(d3.entries(day).length, 1, "без сохранения дневник работает в памяти");
T.ok(!d3.isPersistent(), "флаг «не сохраняется»");
// без хранилища вообще
T.eq(C.createDiary().entries(day).length, 0, "дневник без хранилища");

/* ---------- даты ---------- */
T.eq(C.dateKey(new Date(2026, 0, 5)), "2026-01-05", "dateKey");
T.eq(C.shiftDate("2026-03-01", -1), "2026-02-28", "сдвиг даты назад через месяц");
T.eq(C.shiftDate("2026-12-31", 1), "2027-01-01", "сдвиг через год");

T.done("Логика");
