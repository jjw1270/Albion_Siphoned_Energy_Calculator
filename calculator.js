(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ExploitCalculator = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const UNKNOWN_PLAYER = "\uC54C \uC218 \uC5C6\uC74C";
  const BACKUP_VERSION = 4;
  const ROW_COLUMNS = ["date", "player", "purpose", "amount"];
  const ENGLISH_STACKED_HEADER = ["date", "player", "reason", "amount"];

  function normalizeNumber(raw) {
    return Number(String(raw).replace(/,/g, "").trim());
  }

  function unquote(value) {
    const text = String(value || "").trim();
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
      return text.slice(1, -1).replace(/""/g, '"').trim();
    }
    return text;
  }

  function splitTsv(line) {
    const fields = [];
    let current = "";
    let inQuote = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (char === '"') {
        if (inQuote && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuote = !inQuote;
        }
        continue;
      }

      if (char === "\t" && !inQuote) {
        fields.push(current.trim());
        current = "";
        continue;
      }

      current += char;
    }

    fields.push(current.trim());
    return fields.map(unquote);
  }

  function extractAmount(line) {
    const fields = splitTsv(line);
    const lastField = fields[fields.length - 1];

    if (fields.length > 1 && /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(lastField)) {
      return normalizeNumber(lastField);
    }

    const match = line.trim().match(/"?([-+]?\d[\d,]*(?:\.\d+)?)"?\s*$/);
    return match ? normalizeNumber(match[1]) : null;
  }

  function isHeaderLine(line) {
    const fields = splitTsv(line);
    return fields.length >= 4 && Number.isNaN(normalizeNumber(fields[fields.length - 1]));
  }

  function normalizeLanguage(options) {
    if (typeof options === "string") return options;
    return options && options.language ? String(options.language) : "ko";
  }

  function isEnglishStackedHeader(records, startIndex = 0) {
    if (records.length - startIndex < ENGLISH_STACKED_HEADER.length) return false;

    return ENGLISH_STACKED_HEADER.every(
      (label, offset) => unquote(records[startIndex + offset].text).toLowerCase() === label,
    );
  }

  function englishStackedInvalidGroup(group) {
    return {
      lineNumber: group[0].lineNumber,
      text: group.map((item) => item.text).join("\n"),
    };
  }

  function parseEnglishStackedRows(records) {
    const result = { rows: [], skippedCount: 0, invalidLines: [] };
    let index = 0;

    if (isEnglishStackedHeader(records)) {
      index = ENGLISH_STACKED_HEADER.length;
      result.skippedCount = 1;
    }

    while (index < records.length) {
      const group = records.slice(index, index + ENGLISH_STACKED_HEADER.length);
      if (group.length < ENGLISH_STACKED_HEADER.length) {
        result.invalidLines.push(englishStackedInvalidGroup(group));
        break;
      }

      const fields = group.map((item) => unquote(item.text));
      const amount = normalizeNumber(fields[3]);
      if (Number.isNaN(amount)) {
        result.invalidLines.push(englishStackedInvalidGroup(group));
      } else {
        result.rows.push(makeRow({ date: fields[0], player: fields[1], purpose: fields[2], amount }));
      }
      index += ENGLISH_STACKED_HEADER.length;
    }

    return result;
  }

  function normalizeDate(raw) {
    return String(raw || "").trim();
  }

  function dateToTime(date) {
    const normalized = normalizeDate(date).replace(" ", "T");
    const time = new Date(normalized).getTime();
    return Number.isNaN(time) ? null : time;
  }

  function normalizeRowKey(row) {
    return [row.date, row.player, row.purpose, row.amount].join("|");
  }

  function makeRow({ date, player, purpose, amount }) {
    const normalized = {
      date: normalizeDate(date),
      player: String(player || UNKNOWN_PLAYER).trim() || UNKNOWN_PLAYER,
      purpose: String(purpose || "").trim(),
      amount: Number(amount),
    };
    normalized.key = normalizeRowKey(normalized);
    return normalized;
  }

  function parseRow(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed || isHeaderLine(trimmed)) {
      return null;
    }

    const fields = splitTsv(trimmed);
    if (fields.length >= 4) {
      const amount = normalizeNumber(fields[3]);
      if (!Number.isNaN(amount)) {
        return makeRow({ date: fields[0], player: fields[1], purpose: fields[2], amount });
      }
    }

    const fallback = trimmed.match(
      /^(.+?)\s+(\S+)\s+(\S+)\s+"?([-+]?\d[\d,]*(?:\.\d+)?)"?$/,
    );
    if (!fallback) {
      return null;
    }

    return makeRow({
      date: fallback[1],
      player: fallback[2],
      purpose: fallback[3],
      amount: normalizeNumber(fallback[4]),
    });
  }

  function parseRows(input, options = {}) {
    const result = { rows: [], skippedCount: 0, invalidLines: [] };
    const records = String(input || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line, index) => ({ lineNumber: index + 1, text: line.trim(), rawText: line }))
      .filter((record) => record.text);
    const language = normalizeLanguage(options);

    if (language === "en" || isEnglishStackedHeader(records)) {
      return parseEnglishStackedRows(records);
    }

    records.forEach((record) => {
      const trimmed = record.text;
      if (isHeaderLine(trimmed)) {
        result.skippedCount += 1;
        return;
      }

      const row = parseRow(trimmed);
      if (row) {
        result.rows.push(row);
      } else {
        result.invalidLines.push({ lineNumber: record.lineNumber, text: record.rawText });
      }
    });
    return result;
  }

  function createPlayerSummary(player) {
    return {
      player,
      total: 0,
      depositTotal: 0,
      withdrawTotal: 0,
      rowCount: 0,
      firstDate: "",
      latestDate: "",
      hasUnknownDate: false,
    };
  }

  function updateSummaryDates(summary, date) {
    const normalized = normalizeDate(date);
    const time = dateToTime(normalized);
    if (time === null) {
      summary.hasUnknownDate = true;
      return;
    }

    const firstTime = dateToTime(summary.firstDate);
    const latestTimeValue = dateToTime(summary.latestDate);
    if (!summary.hasUnknownDate && (!summary.firstDate || firstTime === null || time < firstTime)) {
      summary.firstDate = normalized;
    }
    if (!summary.latestDate || latestTimeValue === null || time > latestTimeValue) {
      summary.latestDate = normalized;
    }
  }

  function addAmount(summary, amount, date) {
    summary.total += amount;
    if (amount >= 0) {
      summary.depositTotal += amount;
    } else {
      summary.withdrawTotal += amount;
    }
    summary.rowCount += 1;
    updateSummaryDates(summary, date);
  }

  function addRowToPlayerMap(playerMap, row) {
    const amount = Number(row.amount);
    if (Number.isNaN(amount)) return;

    const player = row.player || UNKNOWN_PLAYER;
    if (!playerMap.has(player)) {
      playerMap.set(player, createPlayerSummary(player));
    }
    addAmount(playerMap.get(player), amount, row.date);
  }

  function normalizeSummary(summary) {
    const player = String(summary.player || UNKNOWN_PLAYER).trim() || UNKNOWN_PLAYER;
    const rowCount = Number(summary.rowCount) || 0;
    const firstDate = normalizeDate(summary.firstDate);
    const latestDate = normalizeDate(summary.latestDate);
    return {
      player,
      total: Number(summary.total) || 0,
      depositTotal: Number(summary.depositTotal) || 0,
      withdrawTotal: Number(summary.withdrawTotal) || 0,
      rowCount,
      firstDate,
      latestDate,
      hasUnknownDate: Boolean(summary.hasUnknownDate) || (rowCount > 0 && (!firstDate || !latestDate)),
    };
  }

  function summarizeRows(rows, baseSummaries = []) {
    const playerMap = new Map();

    baseSummaries.map(normalizeSummary).forEach((summary) => {
      playerMap.set(summary.player, { ...summary });
    });
    sanitizeRows(rows).forEach((row) => addRowToPlayerMap(playerMap, row));

    const players = Array.from(playerMap.values()).sort((a, b) =>
      a.player.localeCompare(b.player, "ko-KR"),
    );

    return players.reduce(
      (result, player) => {
        result.total += player.total;
        result.depositTotal += player.depositTotal;
        result.withdrawTotal += player.withdrawTotal;
        result.rowCount += player.rowCount;
        return result;
      },
      { total: 0, depositTotal: 0, withdrawTotal: 0, rowCount: 0, playerCount: players.length, players },
    );
  }

  function calculate(input, options = {}) {
    const parsed = parseRows(input, options);
    return { ...summarizeRows(parsed.rows), skippedCount: parsed.skippedCount, invalidLines: parsed.invalidLines };
  }

  function rowFromCompact(row) {
    if (!Array.isArray(row) || row.length < 4) return null;
    const amount = Number(row[3]);
    return Number.isNaN(amount)
      ? null
      : makeRow({ date: row[0], player: row[1], purpose: row[2], amount });
  }

  function sanitizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => {
        if (Array.isArray(row)) return rowFromCompact(row);
        if (row && row.text) return parseRow(row.text);
        if (!row) return null;

        const amount = Number(row.amount);
        return Number.isNaN(amount)
          ? null
          : makeRow({ date: row.date, player: row.player, purpose: row.purpose, amount });
      })
      .filter(Boolean);
  }

  function compactRows(rows) {
    return sanitizeRows(rows).map((row) => [row.date, row.player, row.purpose, row.amount]);
  }

  function createLedger(rows = [], summaries = []) {
    return {
      rows: [],
      summaries: summarizeRows(sanitizeRows(rows), summaries).players,
    };
  }

  function importLedger(data) {
    if (!data) return createLedger();

    if (Array.isArray(data)) {
      return createLedger(sanitizeRows(data));
    }

    if (data.ledger) {
      return createLedger(data.ledger.rows, data.ledger.summaries);
    }

    if (Array.isArray(data.rows)) {
      return createLedger(sanitizeRows(data.rows), data.summaries || []);
    }

    return createLedger();
  }

  function compressLedger(ledger) {
    return createLedger(ledger.rows, ledger.summaries);
  }

  function summarizeLedger(ledger) {
    const normalized = importLedger(ledger);
    return summarizeRows(normalized.rows, normalized.summaries);
  }

  function mergeLedger(existingLedger, input, options = {}) {
    const ledger = importLedger(existingLedger);
    const parsed = parseRows(input, options);
    const playerMap = new Map();

    ledger.summaries.map(normalizeSummary).forEach((summary) => {
      playerMap.set(summary.player, { ...summary });
    });

    let addedCount = 0;
    let duplicateCount = 0;
    sortRowsByDate(parsed.rows).forEach((row) => {
      const player = row.player || UNKNOWN_PLAYER;
      const summary = playerMap.get(player);
      if (summary && isDuplicateByLatestDate(summary, row)) {
        duplicateCount += 1;
        return;
      }

      if (!summary) {
        playerMap.set(player, createPlayerSummary(player));
      }
      addRowToPlayerMap(playerMap, row);
      addedCount += 1;
    });

    const compressed = {
      rows: [],
      summaries: sortedSummaries(playerMap),
    };

    return {
      ...summarizeLedger(compressed),
      ledger: compressed,
      rows: compressed.rows,
      summaries: compressed.summaries,
      addedCount,
      duplicateCount,
      skippedCount: parsed.skippedCount,
      invalidLines: parsed.invalidLines,
    };
  }

  function mergeRows(existingRows, input, options = {}) {
    const merged = mergeLedger({ rows: existingRows, summaries: [] }, input, options);
    return { ...merged, rows: [...merged.rows, ...summaryRowsForCompatibility(merged.summaries)] };
  }

  function summaryRowsForCompatibility(summaries) {
    return summaries.map((summary) =>
      makeRow({
        date: summary.latestDate || summary.firstDate || "",
        player: summary.player,
        purpose: "summary",
        amount: summary.total,
      }),
    );
  }

  function isDuplicateByLatestDate(summary, row) {
    const rowTime = dateToTime(row.date);
    const latest = dateToTime(summary.latestDate);
    return rowTime !== null && latest !== null && rowTime <= latest;
  }

  function sortRowsByDate(rows) {
    return sanitizeRows(rows).sort((a, b) => {
      const aTime = dateToTime(a.date);
      const bTime = dateToTime(b.date);
      if (aTime !== null && bTime !== null) {
        return aTime - bTime || a.player.localeCompare(b.player, "ko-KR");
      }
      if (aTime !== null) return -1;
      if (bTime !== null) return 1;
      return String(a.date).localeCompare(String(b.date), "ko-KR");
    });
  }

  function sortedSummaries(playerMap) {
    return Array.from(playerMap.values()).sort((a, b) =>
      a.player.localeCompare(b.player, "ko-KR"),
    );
  }

  function exportBackup(ledgerOrRows) {
    const ledger = importLedger(Array.isArray(ledgerOrRows) ? { rows: ledgerOrRows } : ledgerOrRows);
    return {
      version: BACKUP_VERSION,
      format: "summary-only-latest-date-watermark",
      duplicatePolicy: "player-latest-date-watermark",
      columns: ROW_COLUMNS,
      ledger: {
        summaries: ledger.summaries,
        rows: [],
      },
    };
  }

  function importBackup(backup) {
    const ledger = importLedger(backup);
    return [...ledger.rows, ...summaryRowsForCompatibility(ledger.summaries)];
  }

  function sortPlayers(players, sortMode) {
    const list = [...players];
    const sorters = {
      totalAsc: (a, b) => a.total - b.total || a.player.localeCompare(b.player, "ko-KR"),
      totalDesc: (a, b) => b.total - a.total || a.player.localeCompare(b.player, "ko-KR"),
      nameAsc: (a, b) => a.player.localeCompare(b.player, "ko-KR"),
      countDesc: (a, b) => b.rowCount - a.rowCount || a.player.localeCompare(b.player, "ko-KR"),
    };
    return list.sort(sorters[sortMode] || sorters.totalAsc);
  }

  function formatNumber(value, locale = "ko-KR") {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
  }

  return {
    BACKUP_VERSION,
    calculate,
    compactRows,
    compressLedger,
    createLedger,
    dateToTime,
    exportBackup,
    extractAmount,
    formatNumber,
    importBackup,
    importLedger,
    makeRow,
    mergeLedger,
    mergeRows,
    parseRow,
    parseRows,
    sanitizeRows,
    sortPlayers,
    splitTsv,
    summarizeLedger,
    summarizeRows,
  };
});
