#!/usr/bin/env node
/* Проверка страницы после автопополнения (headless Chrome, без звука).
   node tools/auto/check-page.js <url> <ожидаемое число продуктов> <название 1> [название 2 ...]
   Печатает JSON и завершается с кодом 0, если: нет ошибок JS, число продуктов совпадает,
   поиск по каждому названию показывает этот продукт в подсказках. Нужен puppeteer-core (NODE_PATH). */
"use strict";
var fs = require("fs"), os = require("os"), path = require("path");
var puppeteer = require("puppeteer-core");
var url = process.argv[2], expected = Number(process.argv[3]), names = process.argv.slice(4);
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function isGa(u) { return /googletagmanager\.com|google-analytics\.com/.test(u); }
(async function () {
  var res = { url: url, expected: expected, errors: [], count: null, search: {}, ok: false };
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-auto-"));
  var browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true,
    userDataDir: profile, args: ["--mute-audio", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--lang=ru-RU"] });
  try {
    var page = await browser.newPage();
    page.on("pageerror", function (e) { res.errors.push("pageerror: " + e.message); });
    page.on("console", function (m) { if (m.type() === "error" && !isGa(m.text())) res.errors.push("console: " + m.text()); });
    page.on("requestfailed", function (r) { if (!isGa(r.url())) res.errors.push("requestfailed: " + r.url()); });
    var resp = await page.goto(url, { waitUntil: "load", timeout: 60000 });
    res.status = resp ? resp.status() : null;
    await page.waitForSelector("#q", { timeout: 15000 });
    res.count = await page.evaluate(function () { return window.CALORIE_DATA && window.CALORIE_DATA.raw.length; });
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      await page.$eval("#q", function (e) { e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.focus("#q"); await sleep(150);
      await page.type("#q", n, { delay: 5 });
      var found = false;
      try {
        await page.waitForSelector("#q-list:not([hidden]) li", { timeout: 4000 });
        found = await page.$$eval("#q-list li", function (lis, n) { return lis.some(function (li) { return li.textContent.indexOf(n) !== -1; }); }, n);
      } catch (e) { found = false; }
      res.search[n] = found;
    }
    res.ok = (res.status === null || res.status === 200 || res.status === 0) && res.errors.length === 0 && res.count === expected &&
      names.every(function (n) { return res.search[n]; });
  } catch (e) { res.errors.push("exception: " + e.message); }
  finally { await browser.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  console.log(JSON.stringify(res, null, 1));
  process.exit(res.ok ? 0 : 1);
})();
