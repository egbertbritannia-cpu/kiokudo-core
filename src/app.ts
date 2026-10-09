import Fastify from 'fastify';
import { createStagingDatabaseFromEnv, type DatabaseConnection } from './db/client.js';
import { registerReviewRoutes } from './routes/reviews.js';
import { registerCardsRoutes } from './routes/cards.js';
import { registerGrammarRoutes } from './routes/grammar.js';
import { registerIeltsReadRoutes } from './routes/ielts.js';
import { verifyStagingDatabaseIdentity } from './db/staging-identity.js';

export interface AppOptions {
  serviceToken?: string;
  logger?: boolean;
  database?: DatabaseConnection;
}

export function buildApp(options: AppOptions = {}) {
  const serviceToken = options.serviceToken ?? process.env.KIOKUDO_SERVICE_TOKEN;
  if (!serviceToken || serviceToken.length < 24 || serviceToken.startsWith('replace-')) {
    throw new Error('KIOKUDO_SERVICE_TOKEN is required (at least 24 characters); refusing fail-open API');
  }

  // No DB is opened without explicit staging scope (or an injected test connection).
  const ownedConnection = options.database ? undefined : createStagingDatabaseFromEnv();
  const connection = options.database ?? ownedConnection;
  const db = connection?.db;

  const app = Fastify({ logger: options.logger ?? false, trustProxy: false });
  if (ownedConnection) {
    // Fastify onReady runs before listen / inject; no review handler is served
    // until the actual database marker is confirmed via a read-only query.
    app.addHook('onReady', async () => {
      await verifyStagingDatabaseIdentity(
        ownedConnection.client, process.env.KIOKUDO_EXPECTED_STAGING_MARKER!,
      );
    });
    app.addHook('onClose', async () => { ownedConnection.client.close(); });
  }

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/api/v1/health') return;
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${serviceToken}`) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok', service: 'kiokudo-core', apiVersion: 'v1',
  }));

  app.get('/api/v1/status', async () => ({
    service:'kiokudo-core', phase:'phase2-staging',
    businessApisReady:false, // not all legacy APIs are migrated
    reviewApiStagingReady: Boolean(db),
    productionCutoverAllowed:false,
  }));

  registerReviewRoutes(app, db);
  registerCardsRoutes(app, db);
  registerGrammarRoutes(app, db);
  registerIeltsReadRoutes(app, db);
  return app;
}
