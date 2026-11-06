/**
 * PLAN-13: startup environment validation.
 *
 * In production a weak or missing secret must abort the boot with a clear
 * message instead of running insecurely; in development it only warns.
 */

/** Example admin password shipped in .env.example; must never reach production. */
const EXAMPLE_ADMIN_PASSWORD = 'CambiaMeEnProduccion123!';
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Collects environment problems.
 * @param {NodeJS.ProcessEnv} [env] - Environment to inspect.
 * @returns {string[]} Human-readable problems (empty when the env is fine).
 */
function collectEnvProblems(env = process.env) {
  const problems = [];
  const secret = env.JWT_SECRET || '';
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET ausente o demasiado corto (mínimo ${MIN_JWT_SECRET_LENGTH} caracteres).`);
  }
  if (env.ADMIN_PASSWORD === EXAMPLE_ADMIN_PASSWORD) {
    problems.push('ADMIN_PASSWORD es la contraseña de ejemplo de .env.example; define una propia.');
  }
  if ((env.TELEGRAM_BOT_TOKEN || '').trim() && !(env.TELEGRAM_WEBHOOK_SECRET || '').trim()) {
    problems.push('TELEGRAM_BOT_TOKEN está definido pero falta TELEGRAM_WEBHOOK_SECRET.');
  }
  return problems;
}

/**
 * Validates the environment. Production: throws on any problem. Other
 * environments: logs a warning per problem and returns.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{warn?: Function}} [logger]
 * @returns {string[]} The problems found.
 * @throws {Error} When NODE_ENV is 'production' and there is at least one problem.
 */
function validateEnv(env = process.env, logger = console) {
  const problems = collectEnvProblems(env);
  if (problems.length === 0) return problems;
  if (env.NODE_ENV === 'production') {
    throw new Error(`Configuración inválida, el servidor no arrancará:\n - ${problems.join('\n - ')}`);
  }
  // Los tests fijan NODE_ENV=test con secretos de prueba: no ensuciar su salida.
  if (env.NODE_ENV !== 'test') problems.forEach((p) => logger.warn(`⚠ ${p}`));
  return problems;
}

module.exports = { validateEnv, collectEnvProblems, EXAMPLE_ADMIN_PASSWORD, MIN_JWT_SECRET_LENGTH };
