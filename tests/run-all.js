#!/usr/bin/env node
/* Запускает все node-тесты (без браузера): node tests/run-all.js */
"use strict";
var cp = require("child_process"), path = require("path");
var failed = 0;
["test-data.js", "test-core.js", "test-html.js"].forEach(function (f) {
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
});
process.exit(failed ? 1 : 0);
