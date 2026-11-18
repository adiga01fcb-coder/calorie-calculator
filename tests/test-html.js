#!/usr/bin/env node
/* Статическая проверка index.html: SEO, AdSense-заглушка, отсутствие внешних ресурсов, совпадение цифр с базой. */
"use strict";
var fs = require("fs"), path = require("path");
var T = require("./harness");
var ROOT = path.resolve(__dirname, "..");
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
var DATA = require("../data/products.js");
var C = require("../js/core.js");
var P = C.buildProducts(DATA);
function byName(n) { return P.filter(function (p) { return p.name === n; })[0]; }

T.ok(/<html lang="ru">/.test(html), "lang=ru");
var title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
T.ok(/калори/i.test(title) && /сколько калорий/i.test(title) && /калорийность/i.test(title), "title с ключевыми словами");
T.ok(title.length <= 90, "title не длиннее 90 символов (" + title.length + ")");
var desc = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1] || "";
T.ok(desc.length >= 80 && desc.length <= 300, "meta description 80–300 символов (" + desc.length + ")");
T.ok(/<meta name="robots" content="index,follow">/.test(html), "meta robots");
T.ok(/<!--[^]*rel="canonical"[^]*-->/.test(html), "canonical — закомментированная заглушка");
["og:title", "og:description", "og:type", "og:locale"].forEach(function (k) { T.ok(html.indexOf('property="' + k + '"') !== -1, k); });
T.ok(/<link rel="icon" href="favicon.svg"/.test(html), "favicon подключён");
T.ok(fs.existsSync(path.join(ROOT, "favicon.svg")), "favicon.svg существует");
T.eq((html.match(/<h1[\s>]/g) || []).length, 1, "ровно один h1");
T.ok(/<h1>[^<]*Калькулятор калорий[^<]*сколько калорий/i.test(html), "h1 с ключевыми словами");

var ld = (html.match(/<script type="application\/ld\+json" id="ld-json">([^]*?)<\/script>/) || [])[1];
var json = null; try { json = JSON.parse(ld); } catch (e) {}
T.ok(json && json["@graph"], "JSON-LD парсится");
if (json) {
  var types = json["@graph"].map(function (g) { return g["@type"]; });
  T.ok(types.indexOf("WebApplication") !== -1 && types.indexOf("FAQPage") !== -1, "JSON-LD: WebApplication и FAQPage");
}

// SEO-разделы «сколько калорий в …»
var anchors = ["skolko-kaloriy-v-yayce", "skolko-kaloriy-v-banane", "skolko-kaloriy-v-grechke", "skolko-kaloriy-v-kurinoy-grudke",
  "skolko-kaloriy-v-rise", "skolko-kaloriy-v-tvoroge", "skolko-kaloriy-v-burgere", "kaloriynost-produktov-tablica"];
anchors.forEach(function (a) { T.ok(html.indexOf('id="' + a + '"') !== -1, "якорь #" + a); });
var h3 = html.match(/<h3>Сколько калорий в [^<]+<\/h3>/g) || [];
T.ok(h3.length >= 10, "не меньше 10 заголовков «Сколько калорий в …» (" + h3.length + ")");
T.ok(/<h2[^>]*>Калорийность продуктов: таблица/.test(html), "h2 «Калорийность продуктов: таблица»");

// цифры в SEO-разделах совпадают с базой
var re = /<article class="seo-item" id="[^"]+">[^]*?<strong>([^<]+)<\/strong>: <strong>(\d+) ккал<\/strong>[^]*?около <strong>(\d+) ккал<\/strong>/g, m, n = 0;
while ((m = re.exec(html))) {
  var name = m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  var p = byName(name);
  n++;
  T.ok(!!p, "продукт из SEO-раздела есть в базе: " + name);
  if (p) {
    T.eq(Number(m[2]), p.kcal, "SEO: ккал на 100 г для " + name);
    T.eq(Number(m[3]), Math.round(p.kcal * p.portion / 100), "SEO: ккал на порцию для " + name);
  }
}
T.ok(n >= 10, "проверено SEO-разделов: " + n);
html.replace(/data-pick="([^"]+)"/g, function (_, nm) { T.ok(!!byName(nm.replace(/&amp;/g, "&")), "кнопка «Посчитать» ссылается на продукт: " + nm); });

// AdSense: только закомментированная заглушка
var noComments = html.replace(/<!--[^]*?-->/g, "");
T.ok(/<!--[^]*adsbygoogle\.js\?client=ca-pub-XXXXXXXXXXXXXXXX[^]*-->/.test(html), "скрипт AdSense закомментирован с ca-pub-XXXXXXXXXXXXXXXX");
T.ok(noComments.indexOf("googlesyndication") === -1, "рекламный скрипт не подключается");
T.ok((noComments.match(/class="ad-slot /g) || []).length >= 2, "видимые места под рекламу");
T.ok(!/(src|href)="(https?:)?\/\//.test(noComments), "нет внешних src/href");
T.ok(!/@import|url\(\s*["']?https?:/.test(fs.readFileSync(path.join(ROOT, "styles.css"), "utf8")), "в CSS нет внешних ресурсов");
["js/app.js", "js/core.js", "data/products.js"].forEach(function (f) {
  var s = fs.readFileSync(path.join(ROOT, f), "utf8");
  T.ok(!/fetch\(|XMLHttpRequest|https?:\/\//.test(s), f + ": нет сетевых запросов");
});
T.ok(/Значения приблизительные/.test(html) && /USDA FoodData Central/.test(html) && /Скурихин/.test(html), "видимая пометка о приблизительности и источники");

// вес страницы
var total = ["index.html", "styles.css", "js/app.js", "js/core.js", "data/products.js", "favicon.svg"].reduce(function (s, f) {
  return s + fs.statSync(path.join(ROOT, f)).size;
}, 0);
T.ok(total < 250 * 1024, "суммарный размер страницы < 250 КБ (" + Math.round(total / 1024) + " КБ)");
T.done("HTML/SEO");
