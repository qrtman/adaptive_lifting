import type { Plugin } from 'vite';

/** Return an explicit API error when local development has no Edge target. */
export function edgeTargetRequiredPlugin(configured: boolean): Plugin {
  return {
    name: 'adaptive-lifting-edge-target-required',
    configureServer(server) {
      if (configured) return;
      server.middlewares.use('/api', (_request, response) => {
        response.statusCode = 503;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        response.end(JSON.stringify({ detail: 'API_EDGE_TARGET is required for local API requests' }));
      });
    },
  };
}
