"use strict";
var results = { passed: 0, failed: 0 };
function ok(cond, msg) {
  if (cond) results.passed++;
  else { results.failed++; console.error("  FAIL " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (получено " + JSON.stringify(a) + ", ожидалось " + JSON.stringify(b) + ")"); }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, msg + " (получено " + a + ", ожидалось " + b + " ± " + eps + ")"); }
function done(name) {
  console.log(name + ": пройдено " + results.passed + ", ошибок " + results.failed);
  if (results.failed) process.exitCode = 1;
  return results;
}
module.exports = { ok: ok, eq: eq, near: near, done: done, results: results };
