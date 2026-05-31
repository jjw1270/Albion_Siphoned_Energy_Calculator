const assert = require("node:assert/strict");
const {
  BACKUP_VERSION,
  calculate,
  compactRows,
  createLedger,
  exportBackup,
  extractAmount,
  importLedger,
  mergeLedger,
  mergeRows,
  parseRow,
  splitTsv,
  summarizeLedger,
} = require("./calculator");

const HEADER = '"\uB0A0\uC9DC"\t"\uD50C\uB808\uC774\uC5B4"\t"\uBAA9\uC801"\t"\uC218\uB7C9"';
const DEPOSIT = "\uC785\uAE08";
const WITHDRAW = "\uCD9C\uAE08";

assert.deepEqual(splitTsv(HEADER), [
  "\uB0A0\uC9DC",
  "\uD50C\uB808\uC774\uC5B4",
  "\uBAA9\uC801",
  "\uC218\uB7C9",
]);
assert.equal(extractAmount(`"2026-05-31 05:55:36"\t"Alice"\t"${DEPOSIT}"\t"50"`), 50);
assert.equal(extractAmount(`2026-05-31 055106\tAlice\t${DEPOSIT}\t10`), 10);
assert.equal(extractAmount(`2026-05-30 151520 Alice ${WITHDRAW} -10`), -10);
assert.equal(extractAmount(`2026-05-26 155331\tAlice\t${DEPOSIT}\t1,000`), 1000);

const quotedRow = parseRow(`"2026-05-31 05:52:56"\t"Bob"\t"${WITHDRAW}"\t"-10"`);
assert.equal(quotedRow.date, "2026-05-31 05:52:56");
assert.equal(quotedRow.player, "Bob");
assert.equal(quotedRow.purpose, WITHDRAW);
assert.equal(quotedRow.amount, -10);

const sampleText = [
  HEADER,
  `"2026-05-31 05:55:36"	"Alice"	"${DEPOSIT}"	"50"`,
  `"2026-05-31 05:52:56"	"Bob"	"${WITHDRAW}"	"-10"`,
  `"2026-05-31 05:51:06"	"Alice"	"${DEPOSIT}"	"10"`,
  `"2026-05-30 14:58:44"	"Bob"	"${DEPOSIT}"	"10"`,
  `"2026-05-30 14:11:53"	"Bob"	"${WITHDRAW}"	"-10"`,
  `"2026-05-30 01:11:48"	"Carol"	"${DEPOSIT}"	"10"`,
].join("\n");
const result = calculate(sampleText);
assert.equal(result.total, 60);
assert.equal(result.rowCount, 6);
assert.equal(result.playerCount, 3);
assert.equal(result.invalidLines.length, 0);

const alice = result.players.find((item) => item.player === "Alice");
assert.ok(alice, "Alice aggregate should exist.");
assert.equal(alice.total, 60);
assert.equal(alice.depositTotal, 60);
assert.equal(alice.withdrawTotal, 0);
assert.equal(alice.rowCount, 2);

const firstWindow = [
  HEADER,
  `"2026-05-01 01:01:01"\t"Alice"\t"${DEPOSIT}"\t"10"`,
  `"2026-05-02 01:01:01"\t"Bob"\t"${WITHDRAW}"\t"-10"`,
].join("\n");
const secondWindow = [
  HEADER,
  `"2026-05-02 01:01:01"\t"Bob"\t"${WITHDRAW}"\t"-10"`,
  `"2026-06-01 01:01:01"\t"Alice"\t"${DEPOSIT}"\t"20"`,
].join("\n");

const firstMerge = mergeLedger(createLedger(), firstWindow);
assert.equal(firstMerge.total, 0);
assert.equal(firstMerge.playerCount, 2);
assert.equal(firstMerge.addedCount, 2);
assert.equal(firstMerge.duplicateCount, 0);

const secondMerge = mergeLedger(firstMerge.ledger, secondWindow);
assert.equal(secondMerge.total, 20);
assert.equal(secondMerge.rowCount, 3);
assert.equal(secondMerge.playerCount, 2);
assert.equal(secondMerge.addedCount, 1);
assert.equal(secondMerge.duplicateCount, 1);

const duplicateMerge = mergeLedger(createLedger(), sampleText);
const duplicateMergeAgain = mergeLedger(duplicateMerge.ledger, sampleText);
assert.equal(duplicateMergeAgain.addedCount, 0);
assert.equal(duplicateMergeAgain.duplicateCount, duplicateMerge.rows.length);
assert.equal(duplicateMergeAgain.total, result.total);

const backup = exportBackup(duplicateMerge.ledger);
assert.equal(backup.version, BACKUP_VERSION);
assert.equal(backup.format, "summary-plus-recent-rows");
assert.equal(backup.ledger.rows[0].length, 4);

const restoredLedger = importLedger(backup);
const restoredResult = summarizeLedger(restoredLedger);
assert.equal(restoredResult.total, result.total);
assert.equal(restoredResult.rowCount, result.rowCount);
assert.equal(restoredResult.playerCount, result.playerCount);

const legacyRows = mergeRows([], sampleText).rows;
const legacyLedger = importLedger(legacyRows);
assert.equal(summarizeLedger(legacyLedger).total, result.total);
assert.equal(compactRows(legacyLedger.rows).length, legacyLedger.rows.length);

const fullCompactBackup = {
  version: 2,
  format: "compact-row-array",
  columns: ["date", "player", "purpose", "amount"],
  rows: compactRows(legacyRows),
};
const v2Restored = summarizeLedger(importLedger(fullCompactBackup));
assert.equal(v2Restored.total, result.total);
assert.equal(v2Restored.rowCount, result.rowCount);

const fullJsonSize = JSON.stringify(legacyRows).length;
const compactJsonSize = JSON.stringify(fullCompactBackup).length;
const compressedJsonSize = JSON.stringify(backup).length;
assert.ok(compactJsonSize < fullJsonSize * 0.65);

const longRangeWindow = [
  HEADER,
  `"2026-01-01 00:00:00"\t"Alice"\t"${DEPOSIT}"\t"100"`,
  `"2026-01-02 00:00:00"\t"Alice"\t"${WITHDRAW}"\t"-10"`,
  `"2026-01-03 00:00:00"\t"Bob"\t"${WITHDRAW}"\t"-20"`,
  `"2026-05-31 00:00:00"\t"Alice"\t"${DEPOSIT}"\t"5"`,
].join("\n");
const longRangeMerge = mergeLedger(createLedger(), longRangeWindow);
assert.equal(longRangeMerge.total, 75);
assert.equal(longRangeMerge.rows.length, 1);
assert.equal(longRangeMerge.summaries.length, 2);

const longRangeBackup = exportBackup(longRangeMerge.ledger);
const longRangeRestored = summarizeLedger(importLedger(longRangeBackup));
assert.equal(longRangeRestored.total, 75);
assert.equal(longRangeRestored.rowCount, 4);
assert.equal(longRangeBackup.ledger.rows.length, 1);
assert.equal(longRangeBackup.ledger.summaries.length, 2);

console.log(
  `OK: sample ${result.rowCount} rows, ${result.playerCount} players, total ${result.total}`,
);
