import Fastify from 'fastify';
import { createStagingDatabaseFromEnv, type DatabaseConnection } from './db/client.js';
import { registerReviewRoutes } from './routes/reviews.js';
import { registerCardsRoutes } from './routes/cards.js';
import { registerGrammarRoutes } from './routes/grammar.js';
import { registerIeltsReadRoutes } from './routes/ielts.js';
import { registerIeltsWriteRoutes } from './routes/ielts-writes.js';
import { registerLearningRoutes } from './routes/learning-writes.js';
import { verifyStagingDatabaseIdentity } from './db/staging-identity.js';
import { verifySingleOwnerRequest } from './auth/single-owner.js';

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
    const path = request.url.split('?')[0];
    if (path === '/api/v1/health') return;
    // A service credential authenticates Web as a service, NOT a learner.
    const auth = request.headers.authorization;
    if (auth !== 'Bearer ' + serviceToken) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    // Infrastructure status does not expose learner data or perform mutations.
    if (path === '/api/v1/status' && request.method === 'GET') return;

    // Every private Core route is bound to a signed, short-lived owner
    // assertion matching the *actual* HTTP method and original URL.
    const decision = verifySingleOwnerRequest(
      request.headers['x-kiokudo-owner-assertion'], request.method, request.url,
    );
    if (decision === 'not_configured') {
      return reply.code(503).send({ error: 'owner_auth_not_configured' });
    }
    if (decision === 'writes_disabled') {
      return reply.code(403).send({ error: 'staging_writes_disabled' });
    }
    if (decision !== 'ok') {
      return reply.code(401).send({ error: 'owner_unauthorized' });
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
  registerIeltsWriteRoutes(app, db);
  registerLearningRoutes(app, db);
  return app;
}
