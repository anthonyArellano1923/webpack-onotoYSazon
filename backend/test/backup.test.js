/** Backup script: .backup() copy is valid, and rotation keeps the newest N. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runBackup } = require('../scripts/backup');

test('backup: copia consistente y rotación conserva las N más nuevas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onoto-bk-'));
  const dbPath = path.join(dir, 'onoto.db');
  const backupDir = path.join(dir, 'backups');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1),(2),(3);');
  try {
    let last;
    for (let day = 1; day <= 5; day++) {
      last = await runBackup({
        dbPath, backupDir, keep: 3, now: new Date(Date.UTC(2026, 0, day, 3, 0, 0)),
      });
    }
    const files = fs.readdirSync(backupDir).sort();
    assert.deepEqual(files, [
      'onoto-20260103-030000.db', 'onoto-20260104-030000.db', 'onoto-20260105-030000.db',
    ]);
    assert.equal(last.removed.length, 1);
    const copy = new Database(last.file, { readonly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM t').get().n, 3);
    copy.close();
    await assert.rejects(runBackup({ dbPath: path.join(dir, 'nope.db'), backupDir }), /No existe/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
