/**
 * Daily SQLite backup using better-sqlite3's online `.backup()` API (safe
 * while the server is writing, unlike copying the .db file under WAL).
 *
 * Usage:  node scripts/backup.js
 *
 * Env:
 *   DB_PATH       Source database (same variable the server uses).
 *   BACKUP_DIR    Destination folder. Default: <dirname(DB_PATH)>/backups,
 *                 i.e. on the Render persistent disk when DB_PATH=/data/onoto.db.
 *   BACKUP_KEEP   Number of copies to retain (default 14).
 *
 * Output files: onoto-YYYYMMDD-HHMMSS.db (UTC). Older copies beyond
 * BACKUP_KEEP are deleted; only files matching that pattern are touched.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const FILE_RE = /^onoto-\d{8}-\d{6}\.db$/;

/**
 * Timestamp for file names, in UTC.
 * @param {Date} d
 * @returns {string} YYYYMMDD-HHMMSS
 */
function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Copies the database into `backupDir` and prunes old copies.
 * @param {object} opts
 * @param {string} opts.dbPath - Source database file.
 * @param {string} opts.backupDir - Destination folder (created if missing).
 * @param {number} [opts.keep=14] - Copies to retain.
 * @param {Date} [opts.now] - Clock override (tests).
 * @returns {Promise<{file: string, removed: string[]}>}
 */
async function runBackup({ dbPath, backupDir, keep = 14, now = new Date() }) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('keep debe ser un entero >= 1');
  if (!fs.existsSync(dbPath)) throw new Error(`No existe la BD: ${dbPath}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const final = path.join(backupDir, `onoto-${stamp(now)}.db`);
  // Se escribe a un .tmp y se renombra: una copia a medias nunca cuenta como respaldo.
  const tmp = `${final}.tmp`;
  const src = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await src.backup(tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  } finally {
    src.close();
  }

  // Verifica que la copia abre y es íntegra antes de aceptarla (y de rotar).
  // La copia hereda el modo WAL; pasarla a DELETE la deja en un único archivo
  // autocontenido (sin -wal/-shm).
  const check = new Database(tmp);
  try {
    check.pragma('journal_mode = DELETE');
    const res = check.pragma('integrity_check', { simple: true });
    if (res !== 'ok') throw new Error(`integrity_check falló: ${res}`);
  } catch (err) {
    check.close();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  check.close();
  fs.renameSync(tmp, final);

  // Rotación: nombres ordenables por fecha; se conservan los `keep` más nuevos.
  const all = fs.readdirSync(backupDir).filter((f) => FILE_RE.test(f)).sort();
  const removed = all.slice(0, Math.max(0, all.length - keep));
  for (const f of removed) fs.rmSync(path.join(backupDir, f), { force: true });
  return { file: final, removed };
}

if (require.main === module) {
  require('dotenv').config();
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'onoto.db');
  const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
  const keep = Number(process.env.BACKUP_KEEP || 14);
  runBackup({ dbPath, backupDir, keep })
    .then(({ file, removed }) => {
      console.log(`✓ Backup creado: ${file} (${removed.length} antiguo(s) eliminado(s))`);
    })
    .catch((err) => {
      console.error('✗ Backup falló:', err.message);
      process.exit(1);
    });
}

module.exports = { runBackup, stamp };
