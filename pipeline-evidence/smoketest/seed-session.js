// Seed a user + session against the running DB. Prints the bearer token.
// Usage: DB_PATH=/tmp/rhythm-smoketest-nud7u3.db node seed-session.js
process.chdir(require('path').join(__dirname, '..', '..', 'apps', 'api_server'));
process.env.DB_PATH = process.env.DB_PATH || '/tmp/rhythm-smoketest-nud7u3.db';

(async () => {
  // Use the compiled output to avoid tsx in this throwaway script.
  const { initDb } = require('../../apps/api_server/dist/database/db');
  const { UsersRepository } = require('../../apps/api_server/dist/repositories/users_repository');
  const { SessionsRepository } = require('../../apps/api_server/dist/repositories/sessions_repository');
  await initDb();
  const users = new UsersRepository();
  const sessions = new SessionsRepository();
  const email = `smoketest+${Date.now()}@example.com`;
  const user = await users.createAsync({ name: 'Smoketest User', email });
  const session = await sessions.createAsync(user.id);
  console.log(JSON.stringify({ userId: user.id, token: session.token }));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
