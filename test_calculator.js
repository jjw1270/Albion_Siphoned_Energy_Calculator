const assert = require("node:assert/strict");
const {
  BACKUP_VERSION,
  calculate,
  compactRows,
  createLedger,
  exportBackup,
  extractAmount,
  importBackup,
  importLedger,
  mergeLedger,
  mergeRows,
  parseRow,
  parseRows,
  splitTsv,
  summarizeLedger,
} = require("./calculator");

const HEADER = '"\uB0A0\uC9DC"\t"\uD50C\uB808\uC774\uC5B4"\t"\uBAA9\uC801"\t"\uC218\uB7C9"';
const DEPOSIT = "\uC785\uAE08";
const WITHDRAW = "\uCD9C\uAE08";

function findPlayer(result, player) {
  const summary = result.players.find((item) => item.player === player);
  assert.ok(summary, `${player} aggregate should exist.`);
  return summary;
}

function findCompressedSummary(ledgerResult, player) {
  const summary = ledgerResult.summaries.find((item) => item.player === player);
  assert.ok(summary, `${player} compressed summary should exist.`);
  return summary;
}

function englishStackedRows(rows) {
  return [
    '"Date"',
    '"Player"',
    '"Reason"',
    '"Amount"',
    ...rows.flatMap(([date, player, reason, amount]) => [
      `"${date}"`,
      `"${player}"`,
      `"${reason}"`,
      `"${amount}"`,
    ]),
  ].join("\n");
}

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

const alice = findPlayer(result, "Alice");
assert.equal(alice.total, 60);
assert.equal(alice.depositTotal, 60);
assert.equal(alice.withdrawTotal, 0);
assert.equal(alice.rowCount, 2);
assert.equal(alice.firstDate, "2026-05-31 05:51:06");
assert.equal(alice.latestDate, "2026-05-31 05:55:36");

const bob = findPlayer(result, "Bob");
assert.equal(bob.firstDate, "2026-05-30 14:11:53");
assert.equal(bob.latestDate, "2026-05-31 05:52:56");

const englishStackedText = englishStackedRows([
  ["2026-05-31 17:30:27", "nagarsaki", "Withdrawal", -10],
  ["2026-05-31 08:32:04", "YunJee", "Deposit", 10],
  ["2026-05-31 07:25:14", "JNPgood", "Deposit", 10],
  ["2026-05-31 07:25:01", "JNPgood", "Withdrawal", -10],
]);
const englishResult = calculate(englishStackedText, { language: "en" });
assert.equal(englishResult.total, 0);
assert.equal(englishResult.rowCount, 4);
assert.equal(englishResult.playerCount, 3);
assert.equal(englishResult.skippedCount, 1);
assert.equal(englishResult.invalidLines.length, 0);
assert.equal(findPlayer(englishResult, "nagarsaki").withdrawTotal, -10);
assert.equal(findPlayer(englishResult, "YunJee").depositTotal, 10);
const englishJnp = findPlayer(englishResult, "JNPgood");
assert.equal(englishJnp.total, 0);
assert.equal(englishJnp.rowCount, 2);
assert.equal(englishJnp.firstDate, "2026-05-31 07:25:01");
assert.equal(englishJnp.latestDate, "2026-05-31 07:25:14");

const autoDetectedEnglishResult = calculate(englishStackedText);
assert.equal(autoDetectedEnglishResult.total, englishResult.total);
assert.equal(autoDetectedEnglishResult.rowCount, englishResult.rowCount);

const englishMerge = mergeLedger(createLedger(), englishStackedText, { language: "en" });
assert.equal(englishMerge.addedCount, 4);
assert.equal(englishMerge.duplicateCount, 0);
assert.equal(englishMerge.invalidLines.length, 0);

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
const secondMergeAlice = findPlayer(secondMerge, "Alice");
assert.equal(secondMergeAlice.firstDate, "2026-05-01 01:01:01");
assert.equal(secondMergeAlice.latestDate, "2026-06-01 01:01:01");

const duplicateMerge = mergeLedger(createLedger(), sampleText);
const duplicateMergeAgain = mergeLedger(duplicateMerge.ledger, sampleText);
assert.equal(duplicateMergeAgain.addedCount, 0);
assert.equal(duplicateMergeAgain.duplicateCount, result.rowCount);
assert.equal(duplicateMergeAgain.total, result.total);
assert.equal(duplicateMerge.ledger.rows.length, 0);

const backup = exportBackup(duplicateMerge.ledger);
assert.equal(backup.version, BACKUP_VERSION);
assert.equal(backup.format, "summary-only-latest-date-watermark");
assert.equal(backup.duplicatePolicy, "player-latest-date-watermark");
assert.equal(backup.ledger.rows.length, 0);
assert.equal(backup.ledger.summaries.length, result.playerCount);

const restoredLedger = importLedger(backup);
const restoredResult = summarizeLedger(restoredLedger);
assert.equal(restoredResult.total, result.total);
assert.equal(restoredResult.rowCount, result.rowCount);
assert.equal(restoredResult.playerCount, result.playerCount);
assert.equal(importBackup(backup).length, result.playerCount);

const legacyRows = mergeRows([], sampleText).rows;
const legacyLedger = importLedger(legacyRows);
assert.equal(summarizeLedger(legacyLedger).total, result.total);
assert.equal(compactRows(legacyLedger.rows).length, legacyLedger.rows.length);

const sampleRows = parseRows(sampleText).rows;
const fullCompactBackup = {
  version: 2,
  format: "compact-row-array",
  columns: ["date", "player", "purpose", "amount"],
  rows: compactRows(sampleRows),
};
const v2Restored = summarizeLedger(importLedger(fullCompactBackup));
assert.equal(v2Restored.total, result.total);
assert.equal(v2Restored.rowCount, result.rowCount);

const fullJsonSize = JSON.stringify(sampleRows).length;
const compactJsonSize = JSON.stringify(fullCompactBackup).length;
assert.ok(compactJsonSize < fullJsonSize * 0.65);

const manyRowsText = [
  HEADER,
  ...Array.from({ length: 60 }, (_, index) => {
    const day = String((index % 30) + 1).padStart(2, "0");
    const hour = String(index % 24).padStart(2, "0");
    return `"2026-05-${day} ${hour}:00:00"\t"Alice"\t"${DEPOSIT}"\t"1"`;
  }),
].join("\n");
const manyRowsBackup = exportBackup(mergeLedger(createLedger(), manyRowsText).ledger);
assert.ok(JSON.stringify(manyRowsBackup).length < JSON.stringify(parseRows(manyRowsText).rows).length * 0.5);

const longRangeWindow = [
  HEADER,
  `"2026-01-01 00:00:00"\t"Alice"\t"${DEPOSIT}"\t"100"`,
  `"2026-01-02 00:00:00"\t"Alice"\t"${WITHDRAW}"\t"-10"`,
  `"2026-01-03 00:00:00"\t"Bob"\t"${WITHDRAW}"\t"-20"`,
  `"2026-05-31 00:00:00"\t"Alice"\t"${DEPOSIT}"\t"5"`,
].join("\n");
const longRangeMerge = mergeLedger(createLedger(), longRangeWindow);
assert.equal(longRangeMerge.total, 75);
assert.equal(longRangeMerge.rows.length, 0);
assert.equal(longRangeMerge.summaries.length, 2);
const longRangeAlice = findPlayer(longRangeMerge, "Alice");
assert.equal(longRangeAlice.firstDate, "2026-01-01 00:00:00");
assert.equal(longRangeAlice.latestDate, "2026-05-31 00:00:00");
const compressedAlice = findCompressedSummary(longRangeMerge, "Alice");
assert.equal(compressedAlice.firstDate, "2026-01-01 00:00:00");
assert.equal(compressedAlice.latestDate, "2026-05-31 00:00:00");

const longRangeBackup = exportBackup(longRangeMerge.ledger);
const longRangeRestored = summarizeLedger(importLedger(longRangeBackup));
assert.equal(longRangeRestored.total, 75);
assert.equal(longRangeRestored.rowCount, 4);
assert.equal(longRangeBackup.ledger.rows.length, 0);
assert.equal(longRangeBackup.ledger.summaries.length, 2);
const longRangeRestoredAlice = findPlayer(longRangeRestored, "Alice");
assert.equal(longRangeRestoredAlice.firstDate, "2026-01-01 00:00:00");
assert.equal(longRangeRestoredAlice.latestDate, "2026-05-31 00:00:00");

const overlappingWindow = [
  HEADER,
  `"2026-05-31 05:51:06"\t"Alice"\t"${DEPOSIT}"\t"10"`,
  `"2026-05-31 06:00:00"\t"Alice"\t"${DEPOSIT}"\t"20"`,
].join("\n");
const overlappingMerge = mergeLedger(duplicateMerge.ledger, overlappingWindow);
assert.equal(overlappingMerge.addedCount, 1);
assert.equal(overlappingMerge.duplicateCount, 1);
assert.equal(findPlayer(overlappingMerge, "Alice").latestDate, "2026-05-31 06:00:00");

const dateUnknownLedger = createLedger([], [
  { player: "Alice", total: 100, depositTotal: 100, withdrawTotal: 0, rowCount: 1 },
]);
const dateUnknownMerge = mergeLedger(
  dateUnknownLedger,
  [HEADER, `"2026-06-01 00:00:00"\t"Alice"\t"${DEPOSIT}"\t"20"`].join("\n"),
);
const dateUnknownAlice = findPlayer(dateUnknownMerge, "Alice");
assert.equal(dateUnknownAlice.total, 120);
assert.equal(dateUnknownAlice.firstDate, "");
assert.equal(dateUnknownAlice.latestDate, "2026-06-01 00:00:00");
assert.equal(dateUnknownAlice.hasUnknownDate, true);

console.log(
  `OK: sample ${result.rowCount} rows, ${result.playerCount} players, total ${result.total}`,
);
