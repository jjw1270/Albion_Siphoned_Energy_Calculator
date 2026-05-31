(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ExploitCalculator = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const RETAIN_DAYS = 28;
  const UNKNOWN_PLAYER = "\uC54C \uC218 \uC5C6\uC74C";
  const BACKUP_VERSION = 3;
  const ROW_COLUMNS = ["date", "player", "purpose", "amount"];

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

  function parseRows(input) {
    const result = { rows: [], skippedCount: 0, invalidLines: [] };
    String(input || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (isHeaderLine(trimmed)) {
          result.skippedCount += 1;
          return;
        }

        const row = parseRow(trimmed);
        if (row) {
          result.rows.push(row);
        } else {
          result.invalidLines.push({ lineNumber: index + 1, text: line });
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
    };
  }

  function updateSummaryDates(summary, date) {
    const normalized = normalizeDate(date);
    const time = dateToTime(normalized);
    if (time === null) return;

    const firstTime = dateToTime(summary.firstDate);
    const latestTimeValue = dateToTime(summary.latestDate);
    if (!summary.firstDate || firstTime === null || time < firstTime) {
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
    return {
      player,
      total: Number(summary.total) || 0,
      depositTotal: Number(summary.depositTotal) || 0,
      withdrawTotal: Number(summary.withdrawTotal) || 0,
      rowCount: Number(summary.rowCount) || 0,
      firstDate: normalizeDate(summary.firstDate),
      latestDate: normalizeDate(summary.latestDate),
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

  function calculate(input) {
    const parsed = parseRows(input);
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
    return compressLedger({ rows: sanitizeRows(rows), summaries: summaries.map(normalizeSummary) });
  }

  function importLedger(data) {
    if (!data) return createLedger();

    if (Array.isArray(data)) {
      return createLedger(sanitizeRows(data));
    }

    if (data.version === BACKUP_VERSION && data.ledger) {
      return createLedger(data.ledger.rows, data.ledger.summaries);
    }

    if (Array.isArray(data.rows)) {
      return createLedger(sanitizeRows(data.rows), data.summaries || []);
    }

    return createLedger();
  }

  function latestTime(rows) {
    return sanitizeRows(rows).reduce((latest, row) => {
      const time = dateToTime(row.date);
      return time === null ? latest : Math.max(latest, time);
    }, Number.NEGATIVE_INFINITY);
  }

  function cutoffFromRows(rows) {
    const latest = latestTime(rows);
    if (!Number.isFinite(latest)) return null;
    return latest - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  }

  function compressLedger(ledger) {
    const rows = sanitizeRows(ledger.rows);
    const cutoff = cutoffFromRows(rows);
    if (cutoff === null) {
      return { rows, summaries: (ledger.summaries || []).map(normalizeSummary) };
    }

    const playerMap = new Map();
    (ledger.summaries || []).map(normalizeSummary).forEach((summary) => {
      playerMap.set(summary.player, { ...summary });
    });

    const recentRows = [];
    rows.forEach((row) => {
      const time = dateToTime(row.date);
      if (time !== null && time < cutoff) {
        addRowToPlayerMap(playerMap, row);
      } else {
        recentRows.push(row);
      }
    });

    return {
      rows: recentRows,
      summaries: Array.from(playerMap.values()).sort((a, b) =>
        a.player.localeCompare(b.player, "ko-KR"),
      ),
    };
  }

  function summarizeLedger(ledger) {
    const normalized = importLedger(ledger);
    return summarizeRows(normalized.rows, normalized.summaries);
  }

  function mergeLedger(existingLedger, input) {
    const ledger = importLedger(existingLedger);
    const parsed = parseRows(input);
    const rowMap = new Map();

    ledger.rows.forEach((row) => rowMap.set(row.key, row));

    let addedCount = 0;
    let duplicateCount = 0;
    parsed.rows.forEach((row) => {
      if (rowMap.has(row.key)) {
        duplicateCount += 1;
        return;
      }
      rowMap.set(row.key, row);
      addedCount += 1;
    });

    const rows = Array.from(rowMap.values()).sort((a, b) => {
      const dateCompare = String(b.date).localeCompare(String(a.date), "ko-KR");
      return dateCompare || a.player.localeCompare(b.player, "ko-KR");
    });
    const compressed = compressLedger({ rows, summaries: ledger.summaries });

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

  function mergeRows(existingRows, input) {
    const merged = mergeLedger({ rows: existingRows, summaries: [] }, input);
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

  function exportBackup(ledgerOrRows) {
    const ledger = importLedger(Array.isArray(ledgerOrRows) ? { rows: ledgerOrRows } : ledgerOrRows);
    return {
      version: BACKUP_VERSION,
      format: "summary-plus-recent-rows",
      retainDays: RETAIN_DAYS,
      columns: ROW_COLUMNS,
      ledger: {
        summaries: ledger.summaries,
        rows: compactRows(ledger.rows),
      },
    };
  }

  function importBackup(backup) {
    return importLedger(backup).rows;
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

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(value);
  }

  return {
    RETAIN_DAYS,
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
