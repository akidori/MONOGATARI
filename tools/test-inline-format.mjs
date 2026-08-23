import assert from "node:assert/strict";
import { toggleInlineMarker } from "../src/inline-format.js";

const red = toggleInlineMarker("朝風景インサート", 0, 8, "!!");
assert.equal(red.value, "!!朝風景インサート!!");
assert.deepEqual([red.start, red.end], [2, 10]);

const redOff = toggleInlineMarker(red.value, red.start, red.end, "!!");
assert.equal(redOff.value, "朝風景インサート");
assert.deepEqual([redOff.start, redOff.end], [0, 8]);

const bold = toggleInlineMarker("朝風景インサート", 0, 8, "**");
const nestedRed = toggleInlineMarker(bold.value, bold.start, bold.end, "!!");
assert.equal(nestedRed.value, "**!!朝風景インサート!!**");

const collapsed = toggleInlineMarker("abc", 1, 1, "!!");
assert.equal(collapsed.value, "a!!ここ!!bc");

console.log("inline format regression tests passed");
