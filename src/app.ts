import Fastify from 'fastify';

export interface AppOptions {
  serviceToken?: string;
  logger?: boolean;
}

export function buildApp(options: AppOptions = {}) {
  const serviceToken = options.serviceToken ?? process.env.KIOKUDO_SERVICE_TOKEN;
  if (!serviceToken || serviceToken.length < 24 || serviceToken.startsWith('replace-')) {
    throw new Error('KIOKUDO_SERVICE_TOKEN is required (at least 24 characters); refusing fail-open API');
  }

  const app = Fastify({ logger: options.logger ?? false, trustProxy: false });

  // Public liveness has no DB state, configuration detail or user data.
  app.get('/api/v1/health', async () => ({
    status: 'ok', service: 'kiokudo-core', apiVersion: 'v1',
  }));

  // All other API routes require a service-to-service bearer token. No CORS plugin.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/api/v1/health') return;
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${serviceToken}`) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/api/v1/status', async () => ({
    service: 'kiokudo-core',
    phase: 'bootstrap',
    businessApisReady: false,
    warning: 'ReviewService, persistent APIs and DB are not migrated yet.',
  }));

  return app;
}
