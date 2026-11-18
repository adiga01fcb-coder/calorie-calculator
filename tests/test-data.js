#!/usr/bin/env node
/* Проверка базы продуктов: количество, категории, правдоподобие БЖУ, дубли, порции. */
"use strict";
var T = require("./harness");
var DATA = require("../data/products.js");
var Core = require("../js/core.js");
var P = Core.buildProducts(DATA);

// Известные исключения из проверки «ккал ≈ 4·Б + 9·Ж + 4·У» (USDA применяет для них
// специфические коэффициенты Этуотера или в продукте есть органические кислоты):
var ATWATER_EXCEPTIONS = {
  "Какао-порошок": "специфические коэффициенты USDA для какао (много клетчатки и неусвояемых веществ)",
  "Овсяные отруби": "специфические коэффициенты USDA для отрубей",
  "Отруби пшеничные": "специфические коэффициенты USDA для отрубей",
  "Паприка молотая": "специфические коэффициенты USDA для пряностей",
  "Ростки сои": "специфические коэффициенты USDA для соевых продуктов",
  "Уксус столовый": "энергия уксусной кислоты (≈3,6 ккал/г), не входящей в БЖУ",
  "Уксус бальзамический": "энергия уксусной кислоты",
  "Кетчуп": "специфические коэффициенты USDA для томатных продуктов (органические кислоты)"
};

T.ok(P.length >= 500, "в базе не менее 500 продуктов (" + P.length + ")");

var catKeys = DATA.categories.map(function (c) { return c[0]; });
var counts = {};
P.forEach(function (p) { counts[p.cat] = (counts[p.cat] || 0) + 1; });
["krupy", "myaso", "ryba", "ovoshi", "frukty", "moloko", "fastfood", "blyuda", "sladkoe", "napitki", "orehi", "hleb", "masla"].forEach(function (k) {
  T.ok(catKeys.indexOf(k) !== -1, "категория " + k + " объявлена");
  T.ok((counts[k] || 0) >= 25, "в категории " + k + " не меньше 25 позиций (" + (counts[k] || 0) + ")");
});
P.forEach(function (p) { T.ok(catKeys.indexOf(p.cat) !== -1, "у «" + p.name + "» известная категория"); });

// Дубли
var seen = {};
P.forEach(function (p) {
  var k = Core.normalize(p.name);
  T.ok(!seen[k], "нет дубля названия: " + p.name);
  seen[k] = true;
});
var slugs = {};
P.forEach(function (p) { T.ok(!slugs[p.slug], "уникальный slug: " + p.slug); slugs[p.slug] = true; });

// Значения
var atwaterChecked = 0, exceptionsUsed = 0;
P.forEach(function (p) {
  var n = "«" + p.name + "»";
  ["kcal", "protein", "fat", "carbs"].forEach(function (f) {
    T.ok(typeof p[f] === "number" && isFinite(p[f]) && p[f] >= 0, n + ": " + f + " — неотрицательное число");
  });
  T.ok(p.kcal <= 902, n + ": не больше 902 ккал на 100 г (чистый жир)");
  T.ok(p.protein + p.fat + p.carbs <= 100.5, n + ": Б+Ж+У не больше 100 г на 100 г");
  T.ok(p.source === "U" || p.source === "R", n + ": указан источник");
  T.ok(typeof p.name === "string" && p.name.length >= 2 && p.name.trim() === p.name, n + ": корректное название");
  // Этуотер: клетчатка (если известна) ≈2 ккал/г, алкоголь 7 ккал/г
  var est = 4 * p.protein + 9 * p.fat + 4 * (p.carbs - p.fiber) + 2 * p.fiber + 7 * p.alcohol;
  var tol = Math.max(12, p.kcal * 0.12);
  if (ATWATER_EXCEPTIONS[p.name]) { exceptionsUsed++; return; }
  atwaterChecked++;
  T.ok(Math.abs(est - p.kcal) <= tol, n + ": ккал " + p.kcal + " ≈ 4Б+9Ж+4У(+7·алк) = " + est.toFixed(0));
});
T.eq(exceptionsUsed, Object.keys(ATWATER_EXCEPTIONS).length, "все исключения Этуотера реально используются");

// Порции
P.forEach(function (p) {
  var n = "«" + p.name + "»";
  T.ok(p.portion > 0 && p.portion <= 600, n + ": порция в пределах 0–600 г (" + p.portion + ")");
  T.ok(typeof p.portionLabel === "string" && p.portionLabel.length > 0, n + ": есть подпись порции");
});
function portionOf(name) { return P.filter(function (p) { return p.name === name; })[0].portion; }
T.eq(portionOf("Яйцо куриное"), 55, "1 яйцо = 55 г");
T.ok(portionOf("Банан") >= 100 && portionOf("Банан") <= 150, "средний банан 100–150 г");
T.ok(portionOf("Бургер Биг Мак / Биг Хит") >= 200, "большой бургер ≥ 200 г");
T.ok(portionOf("Масло подсолнечное") <= 20, "ложка масла ≤ 20 г");

// Контрольные значения из справочников
function v(name) { return P.filter(function (p) { return p.name === name; })[0]; }
T.eq(v("Яйцо куриное").kcal, 143, "яйцо куриное 143 ккал (USDA 171287)");
T.eq(v("Банан").kcal, 89, "банан 89 ккал (USDA)");
T.eq(v("Рис белый варёный").kcal, 130, "рис варёный 130 ккал (USDA)");
T.eq(v("Творог 5%").kcal, 121, "творог 5 % — 121 ккал");
T.eq(v("Масло сливочное 82,5%").kcal, 748, "масло 82,5 % — 748 ккал");

// Синонимы
P.forEach(function (p) {
  T.ok(Array.isArray(p.aliases), "«" + p.name + "»: синонимы — массив");
});

console.log("Продуктов: " + P.length + "; по категориям: " + JSON.stringify(counts));
console.log("Проверка Этуотера: " + atwaterChecked + " позиций, документированных исключений: " + exceptionsUsed);
T.done("Данные");
