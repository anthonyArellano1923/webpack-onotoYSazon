# Backup diario de SQLite en Render

El script `backend/scripts/backup.js` usa la API `.backup()` de better-sqlite3 (copia consistente aunque el servidor esté escribiendo, a diferencia de copiar el `.db` con la BD en modo WAL). Verifica la copia con `integrity_check` y rota las más antiguas.

- Salida: `onoto-YYYYMMDD-HHMMSS.db` (UTC) en `BACKUP_DIR`.
- Variables: `DB_PATH` (la misma del servidor), `BACKUP_DIR` (por defecto `<carpeta de DB_PATH>/backups`, es decir `/data/backups` con `DB_PATH=/data/onoto.db`), `BACKUP_KEEP` (por defecto 14).
- Manual: `cd backend && npm run backup`.

## Importante: el disco persistente

Un disco de Render se monta en **un solo servicio**. Por eso un *Cron Job* de Render, que es un servicio aparte, **no puede ver `/data`**. Hay dos opciones.

### Opción A (recomendada): tarea interna al servicio web

Ejecutar el backup dentro del mismo servicio, que sí tiene el disco. Pendiente de implementar (no se hizo para no tocar `server.js` en esta tarea). Esquema:

```js
// server.js (al arrancar, solo en producción)
const { runBackup } = require('./scripts/backup');
setInterval(() => {
  runBackup({ dbPath: DB_PATH, backupDir: process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups') })
    .catch((e) => console.error('backup falló', e.message));
}, 24 * 60 * 60 * 1000);
```

Requiere que el servicio esté siempre encendido (con disco persistente lo está). Se puede disparar también un backup al arrancar si no existe uno de las últimas 24 h.

### Opción B: Cron Job de Render

Solo sirve si la BD se respalda hacia **fuera** del disco (p. ej. S3/R2), porque el cron no monta el disco del web service. Habría que añadir al script una subida a almacenamiento externo; hoy no la tiene.

## Pasos manuales en Render (no hechos)

1. Opción A: implementar el `setInterval` anterior (o llamar `npm run backup` desde Shell del servicio para probar).
2. Confirmar que el disco persistente está montado en `/data` y `DB_PATH=/data/onoto.db`.
3. Probar una vez desde la Shell del servicio: `cd backend && npm run backup` y revisar `ls -lh /data/backups`.

## Restaurar

1. Detener el servicio (o ponerlo en modo mantenimiento).
2. Copiar el respaldo elegido sobre la BD: `cp /data/backups/onoto-AAAAMMDD-HHMMSS.db /data/onoto.db` y borrar `/data/onoto.db-wal` y `/data/onoto.db-shm` si existen.
3. Reiniciar. El arranque aplica las migraciones pendientes según `PRAGMA user_version`.

Las copias viven en el mismo disco que la BD: protegen contra borrados y corrupción lógica, **no** contra la pérdida del disco. Para eso hay que descargar copias periódicamente fuera de Render.
