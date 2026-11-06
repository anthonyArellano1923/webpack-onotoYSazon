/**
 * Esquema único y versionado de la BD.
 *
 * La versión vive en `PRAGMA user_version`. Cada paso es un número fijo e
 * idempotente:
 *   1      → baseline: exec de schema.sql (forma final, CREATE ... IF NOT EXISTS).
 *            En una BD nueva crea todo; en una existente no toca lo que ya hay.
 *   2..N+1 → los pasos de database/migrate.js (STEPS), en orden.
 *
 * Una BD nueva y una BD preexistente de cualquier versión (incluso con
 * user_version = 0, como las anteriores a este módulo) recorren la misma
 * secuencia y terminan en el mismo esquema. Los pasos son idempotentes, así
 * que si un arranque se corta a mitad, el siguiente retoma sin daño.
 *
 * Reglas para agregar una migración: añadir un paso AL FINAL de STEPS en
 * migrate.js, idempotente, y nunca reordenar ni borrar los existentes.
 */
const fs = require('fs');
const path = require('path');
const { STEPS } = require('./migrate');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Lista completa de pasos numerados (versión = posición + 1).
 * @returns {Array<{version: number, name: string, up: Function}>}
 */
function getSteps() {
  const baseline = {
    name: 'baseline-schema-sql',
    up: (db) => db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8')),
  };
  return [baseline, ...STEPS].map((s, i) => ({ version: i + 1, ...s }));
}

/** Versión más reciente del esquema que conoce este código. */
const LATEST_VERSION = getSteps().length;

/**
 * Lleva la BD a la última versión del esquema. Ejecuta solo los pasos con
 * versión mayor a user_version, y fija user_version tras cada paso.
 * @param {import('better-sqlite3').Database} db
 * @returns {number} versión final de la BD
 */
function migrateToLatest(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current > LATEST_VERSION) {
    // Rollback de código sobre una BD más nueva: no tocar nada.
    console.warn(
      `⚠ BD en versión ${current} > ${LATEST_VERSION} conocida por este código; se omiten migraciones.`
    );
    return current;
  }
  for (const step of getSteps()) {
    if (step.version <= current) continue;
    step.up(db);
    // user_version no admite parámetros; version es un entero propio.
    db.pragma(`user_version = ${step.version}`);
  }
  return LATEST_VERSION;
}

module.exports = { migrateToLatest, getSteps, LATEST_VERSION };
