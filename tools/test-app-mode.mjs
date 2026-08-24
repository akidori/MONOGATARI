import assert from "node:assert/strict";
import { getAppMode } from "../src/app-mode.js";

assert.equal(getAppMode("").showProjectNavigation, true);
assert.equal(getAppMode("?case=abc").showProjectNavigation, true);
assert.equal(getAppMode("?live=live123").isLiveEdit, true);
assert.equal(getAppMode("?live=live123").showProjectNavigation, false);
assert.equal(getAppMode("?live=").showProjectNavigation, true);
assert.equal(getAppMode("?ch=channel123").isChannelEdit, true);
assert.equal(getAppMode("", true).showProjectNavigation, false);

console.log("app mode regression tests passed");
