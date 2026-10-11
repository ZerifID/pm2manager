const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { execSync } = require('child_process');

// Helper to open DB safely in readonly or read-write mode
function getDb(dbPath, readonly = false) {
  const resolved = path.resolve(dbPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Database file not found: ${resolved}`);
  }
  return new Database(resolved, { readonly, fileMustExist: true });
}

// GET /api/sqlite/find
// Find .db, .sqlite, .sqlite3 files under /data and /root
router.get('/find', (req, res) => {
  try {
    const scanDir = req.query.dir || '/data';
    const resolved = path.resolve(scanDir);
    const dbFiles = [];

    function scan(dir, depth = 0) {
      if (depth > 4) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'proc' || entry.name === 'sys') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
              try {
                const stat = fs.statSync(fullPath);
                dbFiles.push({
                  name: entry.name,
                  path: fullPath,
                  size: stat.size,
                  modified: stat.mtime
                });
              } catch {}
            }
          }
        }
      } catch {}
    }

    scan(resolved);
    res.json({ success: true, databases: dbFiles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sqlite/tables?db=/path/to.db
router.get('/tables', (req, res) => {
  const dbPath = req.query.db;
  if (!dbPath) return res.status(400).json({ error: 'Parameter db wajib diisi' });

  let db;
  try {
    db = getDb(dbPath, true);
    const tablesQuery = db.prepare(`
      SELECT name, type, sql FROM sqlite_master 
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `);
    const list = tablesQuery.all();

    const tables = list.map(t => {
      let rowCount = 0;
      if (t.type === 'table') {
        try {
          const countRow = db.prepare(`SELECT count(*) as count FROM "${t.name}"`).get();
          rowCount = countRow ? countRow.count : 0;
        } catch {}
      }
      return {
        name: t.name,
        type: t.type,
        sql: t.sql,
        rowCount
      };
    });

    res.json({ success: true, dbPath: path.resolve(dbPath), tables });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (db) db.close();
  }
});

// GET /api/sqlite/schema?db=...&table=...
router.get('/schema', (req, res) => {
  const { db: dbPath, table } = req.query;
  if (!dbPath || !table) return res.status(400).json({ error: 'Parameter db dan table wajib diisi' });

  let db;
  try {
    db = getDb(dbPath, true);
    const columns = db.pragma(`table_info("${table}")`);
    const foreignKeys = db.pragma(`foreign_key_list("${table}")`);
    const indexes = db.pragma(`index_list("${table}")`);
    
    const masterInfo = db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table);

    res.json({
      success: true,
      table,
      columns,
      foreignKeys,
      indexes,
      createSql: masterInfo ? masterInfo.sql : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (db) db.close();
  }
});

// GET /api/sqlite/data?db=...&table=...&page=1&limit=50&sort=col&order=asc&search=...
router.get('/data', (req, res) => {
  const { db: dbPath, table, page = 1, limit = 50, sort, order = 'ASC', search } = req.query;
  if (!dbPath || !table) return res.status(400).json({ error: 'Parameter db dan table wajib diisi' });

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let db;
  try {
    db = getDb(dbPath, true);
    const columns = db.pragma(`table_info("${table}")`);
    const colNames = columns.map(c => c.name);

    let whereClause = '';
    const params = {};

    if (search && search.trim() && colNames.length > 0) {
      const searchTerms = colNames.map(c => `CAST("${c}" AS TEXT) LIKE @searchTerm`).join(' OR ');
      whereClause = `WHERE (${searchTerms})`;
      params.searchTerm = `%${search.trim()}%`;
    }

    // Count total
    const countSql = `SELECT count(*) as total FROM "${table}" ${whereClause}`;
    const totalRow = db.prepare(countSql).get(params);
    const total = totalRow ? totalRow.total : 0;

    // Order by
    let orderByClause = '';
    if (sort && colNames.includes(sort)) {
      const dir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderByClause = `ORDER BY "${sort}" ${dir}`;
    }

    const dataSql = `SELECT rowid as _rowid_, * FROM "${table}" ${whereClause} ${orderByClause} LIMIT ${limitNum} OFFSET ${offset}`;
    let rows;
    try {
      rows = db.prepare(dataSql).all(params);
    } catch {
      // If table is WITHOUT ROWID, fallback to without rowid
      const fallbackSql = `SELECT * FROM "${table}" ${whereClause} ${orderByClause} LIMIT ${limitNum} OFFSET ${offset}`;
      rows = db.prepare(fallbackSql).all(params);
    }

    res.json({
      success: true,
      table,
      columns,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      rows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (db) db.close();
  }
});

// POST /api/sqlite/query
// Execute raw SQL queries
router.post('/query', (req, res) => {
  const { db: dbPath, query } = req.body;
  if (!dbPath || !query || !query.trim()) {
    return res.status(400).json({ error: 'Parameter db dan query wajib diisi' });
  }

  let db;
  const startTime = process.hrtime();
  try {
    db = getDb(dbPath, false);

    // Split multiple queries or run singular
    const trimmed = query.trim();
    const isSelect = /^(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed);

    if (isSelect) {
      const stmt = db.prepare(trimmed);
      const rows = stmt.all();
      const hrDiff = process.hrtime(startTime);
      const execTimeMs = (hrDiff[0] * 1e3 + hrDiff[1] * 1e-6).toFixed(2);

      const columns = stmt.columns ? stmt.columns().map(c => c.name) : (rows.length > 0 ? Object.keys(rows[0]) : []);

      return res.json({
        success: true,
        isSelect: true,
        columns,
        rows,
        count: rows.length,
        execTimeMs
      });
    } else {
      // Execute transaction or multi-statement exec
      const info = db.exec(trimmed);
      const hrDiff = process.hrtime(startTime);
      const execTimeMs = (hrDiff[0] * 1e3 + hrDiff[1] * 1e-6).toFixed(2);

      return res.json({
        success: true,
        isSelect: false,
        message: 'Query berhasil dieksekusi!',
        execTimeMs
      });
    }
  } catch (err) {
    const hrDiff = process.hrtime(startTime);
    const execTimeMs = (hrDiff[0] * 1e3 + hrDiff[1] * 1e-6).toFixed(2);
    res.status(500).json({ success: false, error: err.message, execTimeMs });
  } finally {
    if (db) db.close();
  }
});

// POST /api/sqlite/row-insert
router.post('/row-insert', (req, res) => {
  const { db: dbPath, table, row } = req.body;
  if (!dbPath || !table || !row || typeof row !== 'object') {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  let db;
  try {
    db = getDb(dbPath, false);
    const keys = Object.keys(row).filter(k => k !== '_rowid_');
    if (keys.length === 0) return res.status(400).json({ error: 'Tidak ada kolom yang diisi' });

    const cols = keys.map(k => `"${k}"`).join(', ');
    const placeholders = keys.map(k => `@${k}`).join(', ');
    const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`;

    const stmt = db.prepare(sql);
    const info = stmt.run(row);

    res.json({ success: true, message: 'Data berhasil ditambahkan!', lastInsertRowid: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (db) db.close();
  }
});

// POST /api/sqlite/row-update
router.post('/row-update', (req, res) => {
  const { db: dbPath, table, rowid, pkColumn, pkValue, data } = req.body;
  if (!dbPath || !table || !data) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  let db;
  try {
    db = getDb(dbPath, false);
    const keys = Object.keys(data).filter(k => k !== '_rowid_');
    if (keys.length === 0) return res.status(400).json({ error: 'Tidak ada kolom yang diupdate' });

    const setClauses = keys.map(k => `"${k}" = @${k}`).join(', ');
    const params = { ...data };

    let whereClause = '';
    if (rowid !== undefined && rowid !== null) {
      whereClause = 'WHERE rowid = @target_rowid';
      params.target_rowid = rowid;
    } else if (pkColumn && pkValue !== undefined) {
      whereClause = `WHERE "${pkColumn}" = @target_pk`;
      params.target_pk = pkValue;
    } else {
      return res.status(400).json({ error: 'Identifikasi baris (rowid/primary key) tidak ditemukan' });
    }

    const sql = `UPDATE "${table}" SET ${setClauses} ${whereClause}`;
    const stmt = db.prepare(sql);
    const info = stmt.run(params);

    res.json({ success: true, message: 'Data berhasil diupdate!', changes: info.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (db) db.close();
  }
});

// POST /api/sqlite/row-delete
router.post('/row-delete', (req, res) => {
  const { db: dbPath, table, rowid, pkColumn, pkValue } = req.body;
  if (!dbPath || !table) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  let db;
  try {
    db = getDb(dbPath, false);
    let sql = '';
    const params = {};

    if (rowid !== undefined && rowid !== null) {
      sql = `DELETE FROM "${table}" WHERE rowid = @target_rowid`;
      params.target_rowid = rowid;
    } else if (pkColumn && pkValue !== undefined) {
      sql = `DELETE FROM "${table}" WHERE "${pkColumn}" = @target_pk`;
      params.target_pk = pkValue;
    } else {
      return res.status(400).json({ error: 'Identifikasi baris tidak ditemukan' });
    }

    const stmt = db.prepare(sql);
    const info = stmt.run(params);

    res.json({ success: true, message: 'Data berhasil dihapus!', changes: info.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (db) db.close();
  }
});

module.exports = router;
