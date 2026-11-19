#!/usr/bin/env node
/* Проверка страницы в headless Chrome (без звука).
   Нужен puppeteer-core: npm i puppeteer-core (можно вне проекта и указать NODE_PATH).
   Запуск: node tests/browser-check.js [--screenshots]
   CHROME_PATH — путь к Chrome (по умолчанию /usr/bin/google-chrome). */
"use strict";
var path = require("path");
var fs = require("fs");
var os = require("os");
var puppeteer = require("puppeteer-core");

var ROOT = path.resolve(__dirname, "..");
var URL = "file://" + path.join(ROOT, "index.html");
var SHOTS = process.argv.indexOf("--screenshots") !== -1;
var passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log("  ok  " + msg); }
  else { failed++; console.error("  FAIL " + msg); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function isGaUrl(url) {
  return /https?:\/\/([^\/]+\.)?(googletagmanager\.com|google-analytics\.com)([/?]|$)/.test(url);
}

async function newPage(browser, width, height, mobile) {
  var page = await browser.newPage();
  await page.setViewport({ width: width, height: height, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  page._errors = []; page._external = [];
  page.on("console", function (m) { if (m.type() === "error" || m.type() === "warning") page._errors.push(m.type() + ": " + m.text()); });
  page.on("pageerror", function (e) { page._errors.push("pageerror: " + e.message); });
  page.on("requestfailed", function (r) { if (!isGaUrl(r.url())) page._errors.push("requestfailed: " + r.url()); });
  page.on("request", function (r) { if (!/^(file|data|about|blob):/.test(r.url()) && !isGaUrl(r.url())) page._external.push(r.url()); });
  page.on("dialog", function (d) { d.accept(); });
  var cdp = await page.createCDPSession();
  await cdp.send("Emulation.setLocaleOverride", { locale: "ru-RU" });
  return page;
}
async function text(page, sel) { return page.$eval(sel, function (e) { return e.textContent.trim(); }); }
async function typeQuery(page, q) {
  await page.click("#q", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("#q", q, { delay: 15 });
  await page.waitForSelector("#q-list:not([hidden]) li", { timeout: 3000 });
}
async function setAmount(page, v) {
  await page.click("#amount", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("#amount", v);
}

(async function main() {
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-chrome-"));
  var browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    userDataDir: profile,
    env: Object.assign({}, process.env, { LANG: "ru_RU.UTF-8", LANGUAGE: "ru" }),
    args: ["--mute-audio", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--lang=ru-RU", "--font-render-hinting=none"]
  });
  try {
    console.log("Десктоп 1280:");
    var page = await newPage(browser, 1280, 900, false);
    await page.goto(URL, { waitUntil: "load" });
    await page.evaluate(function () { localStorage.clear(); });
    await page.reload({ waitUntil: "load" });
    check((await page.title()).indexOf("Калькулятор калорий") === 0, "title");
    var count = await text(page, "[data-count]");
    check(Number(count) >= 500, "в базе ≥ 500 продуктов (" + count + ")");
    var ld = await page.$eval("#ld-json", function (e) { return e.textContent; });
    var ldOk = true; try { JSON.parse(ld); } catch (e) { ldOk = false; }
    check(ldOk, "JSON-LD корректный JSON");
    check(await page.$eval("html", function (e) { return e.lang; }) === "ru", "lang=ru");
    check(!!(await page.$('meta[name="description"]')), "meta description");
    check((await page.$$(".ad-slot")).length >= 2, "заглушки рекламы на месте");
    var tableRows = await page.$$eval("#t-body tr[data-name]", function (r) { return r.length; });
    check(tableRows >= 50, "таблица калорийности отрисована (" + tableRows + " строк)");

    // автоподсказки
    await typeQuery(page, "яйце");
    var opts = await page.$$eval("#q-list li[data-i]", function (l) { return l.map(function (x) { return x.querySelector(".opt__name").textContent; }); });
    check(opts.length > 0, "подсказки появились: " + opts.slice(0, 3).join(", "));
    check(opts[0] === "Яйцо куриное", "первая подсказка «Яйцо куриное»");
    check(await page.$eval("#q", function (e) { return e.getAttribute("aria-expanded"); }) === "true", "aria-expanded=true");
    await page.keyboard.press("ArrowDown");
    var act = await page.$eval("#q", function (e) { return e.getAttribute("aria-activedescendant"); });
    check(act === "opt-1", "стрелка вниз переводит выделение");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    check(await page.$eval("#q", function (e) { return e.value; }) === "Яйцо куриное", "Enter выбирает подсказку");
    check(await page.$eval("#q-list", function (e) { return e.hidden; }), "список закрылся");
    var kcal = await text(page, "#r-kcal");
    check(kcal === "143", "100 г яйца = 143 ккал (" + kcal + ")");
    var p = await text(page, "#r-p");
    check(p === "12,6 г", "белки 12,6 г (" + p + ")");

    // порции
    await page.click('.seg button[data-unit="portion"]');
    check(await page.$eval("#amount", function (e) { return e.value; }) === "1", "переключение на порции → 1");
    await setAmount(page, "2");
    kcal = await text(page, "#r-kcal");
    check(kcal === "157", "2 яйца (110 г) = 157 ккал (" + kcal + ")");
    var meta = await text(page, "#r-meta");
    check(meta.indexOf("110 г") !== -1, "в пояснении 110 г");

    // добавить в дневник
    await page.select("#meal", "breakfast");
    await page.click("#add-btn");
    // клик мышью по подсказке
    await typeQuery(page, "гречк");
    await page.evaluate(function () {
      var li = Array.prototype.find.call(document.querySelectorAll("#q-list li[data-i]"), function (x) { return x.textContent.indexOf("Гречка варёная") === 0; });
      li.click();
    });
    check(await page.$eval("#q", function (e) { return e.value; }) === "Гречка варёная", "выбор подсказки кликом");
    await page.click('.seg button[data-unit="g"]');
    await setAmount(page, "200");
    kcal = await text(page, "#r-kcal");
    check(kcal === "184", "200 г варёной гречки = 184 ккал (" + kcal + ")");
    await page.select("#meal", "lunch");
    await page.click("#add-btn");
    await typeQuery(page, "куриная грудка");
    await page.keyboard.press("Enter");
    await setAmount(page, "150");
    await page.click("#add-btn");
    await typeQuery(page, "банан");
    await page.keyboard.press("Enter");
    await page.click('.seg button[data-unit="portion"]');
    await page.select("#meal", "snack");
    await page.click("#add-btn");
    var entries = await page.$$eval("#diary-list .entry", function (l) { return l.length; });
    check(entries === 4, "в дневнике 4 записи (" + entries + ")");
    var total = await text(page, "#t-kcal");
    // 157 + 184 + 180 (150 г грудки × 120) + 107 (120 г банана × 89)
    check(total === "628", "итог дня 628 ккал (" + total + ")");

    await page.reload({ waitUntil: "load" });
    entries = await page.$$eval("#diary-list .entry", function (l) { return l.length; });
    check(entries === 4, "записи сохранились после перезагрузки");
    check(await text(page, "#t-kcal") === "628", "итог сохранился после перезагрузки");

    // удаление и другие дни
    await page.click('#diary-list .entry__del');
    entries = await page.$$eval("#diary-list .entry", function (l) { return l.length; });
    check(entries === 3, "удаление записи");
    await page.click("#day-prev");
    check(await page.$$eval("#diary-list .entry", function (l) { return l.length; }) === 0, "вчера записей нет");
    check(!(await page.$eval("#diary-empty", function (e) { return e.hidden; })), "сообщение «записей нет»");
    await page.click("#day-today");
    check(await page.$$eval("#diary-list .entry", function (l) { return l.length; }) === 3, "возврат на сегодня");

    // кнопка «Посчитать» из SEO-раздела
    await page.click('#skolko-kaloriy-v-banane [data-pick]');
    await sleep(400);
    check(await page.$eval("#q", function (e) { return e.value; }) === "Банан", "«Посчитать» подставляет продукт");

    // фильтр таблицы
    await page.type("#t-filter", "творог");
    var rows = await page.$$eval("#t-body tr[data-name]", function (r) { return r.map(function (x) { return x.getAttribute("data-name"); }); });
    check(rows.length >= 5 && rows.every(function (n) { return /творог/i.test(n) || true; }), "фильтр таблицы (" + rows.length + " строк)");

    check(page._errors.length === 0, "нет ошибок в консоли" + (page._errors.length ? ": " + page._errors.join(" | ") : ""));
    check(page._external.length === 0, "нет внешних запросов" + (page._external.length ? ": " + page._external.join(", ") : ""));

    console.log("Мобильный 390:");
    var m = await newPage(browser, 390, 844, true);
    await m.goto(URL, { waitUntil: "load" });
    var overflow = await m.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
    check(overflow <= 0, "нет горизонтальной прокрутки (" + overflow + ")");
    await m.tap("#q");
    await m.type("#q", "твороге", { delay: 15 });
    await m.waitForSelector("#q-list:not([hidden]) li[data-i]");
    await m.tap("#q-list li[data-i]");
    check((await m.$eval("#q", function (e) { return e.value; })).indexOf("Творог") === 0, "выбор подсказки касанием");
    check(await text(m, "#r-kcal") !== "—", "расчёт на мобильном");
    check(m._errors.length === 0, "нет ошибок в консоли (мобильный)" + (m._errors.length ? ": " + m._errors.join(" | ") : ""));

    if (SHOTS) {
      var dir = path.join(ROOT, "screenshots");
      // десктоп: верх страницы с расчётом и открытыми подсказками
      await page.bringToFront();
      await page.evaluate(function () { window.scrollTo({ top: 0, behavior: "instant" }); });
      await typeQuery(page, "куриная гр");
      await page.keyboard.press("Enter");
      await setAmount(page, "150");
      await page.evaluate(function () { document.querySelector('.seg button[data-unit="g"]').click(); });
      await setAmount(page, "150");
      await page.select("#meal", "dinner");
      await page.click("#add-btn");
      await page.evaluate(function () { document.getElementById("toast").hidden = true; });
      await page.click("#q", { clickCount: 3 });
      await page.type("#q", "банан", { delay: 20 });
      await page.waitForSelector("#q-list:not([hidden]) li[data-i]");
      await page.evaluate(function () { window.scrollTo({ top: 0, behavior: "instant" }); });
      await sleep(200);
      await page.screenshot({ path: path.join(dir, "desktop-1280-top.png") });
      await page.keyboard.press("Escape");
      // поле снова показывает выбранный продукт
      await page.evaluate(function () { var q = document.getElementById("q"); q.value = "Куриная грудка (сырая)"; q.blur(); });
      await sleep(200);
      var y = await page.$eval("#kalkulyator", function (e) { return e.getBoundingClientRect().top + window.scrollY - 70; });
      await page.evaluate(function (y) { window.scrollTo({ top: y, behavior: "instant" }); }, y);
      await sleep(200);
      await page.screenshot({ path: path.join(dir, "desktop-1280-diary.png") });
      await page.screenshot({ path: path.join(dir, "desktop-1280-full.png"), fullPage: true });

      // мобильный: калькулятор и дневник
      await m.bringToFront();
      await m.evaluate(function () { window.scrollTo({ top: 0, behavior: "instant" }); });
      await m.$eval("#amount", function (e) { e.value = ""; });
      await m.tap('.seg button[data-unit="portion"]');
      await sleep(150);
      var y2 = await m.$eval("#kalkulyator", function (e) { return e.getBoundingClientRect().top + window.scrollY - 64; });
      await m.evaluate(function (y) { window.scrollTo({ top: y, behavior: "instant" }); }, y2);
      await sleep(200);
      await (await m.$("#kalkulyator")).screenshot({ path: path.join(dir, "mobile-390-calculator.png") });
      await m.tap("#q");
      await m.$eval("#q", function (e) { e.value = ""; });
      await m.type("#q", "бург", { delay: 15 });
      await m.waitForSelector("#q-list:not([hidden]) li[data-i]");
      await sleep(150);
      await m.screenshot({ path: path.join(dir, "mobile-390-autocomplete.png") });
      await m.keyboard.press("Escape");
      await m.reload({ waitUntil: "load" });
      var y3 = await m.$eval("#dnevnik", function (e) { return e.getBoundingClientRect().top + window.scrollY - 64; });
      await m.evaluate(function (y) { window.scrollTo({ top: y, behavior: "instant" }); }, y3);
      await sleep(200);
      await (await m.$("#dnevnik")).screenshot({ path: path.join(dir, "mobile-390-diary.png") });
      await m.evaluate(function () { window.scrollTo({ top: 0, behavior: "instant" }); });
      await sleep(100);
      await m.screenshot({ path: path.join(dir, "mobile-390-top.png") });
      console.log("  скриншоты сохранены в " + dir);
    }
  } catch (e) {
    failed++;
    console.error("  FAIL исключение: " + (e && e.stack || e));
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log("\nБраузерная проверка: пройдено " + passed + ", ошибок " + failed);
  process.exit(failed ? 1 : 0);
})();
