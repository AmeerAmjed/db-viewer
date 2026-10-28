import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

// Fetches a Supabase project's PostgREST OpenAPI spec server-side so the key never has to be
// used from the browser (Supabase rejects secret / service_role keys on browser requests).
// Only exists while `vite` (dev) or `vite preview` is running.
export function supabaseProxy(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url !== '/api/introspect') return next();
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    void introspect(req, res);
  };
  return {
    name: 'supabase-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

async function introspect(req: IncomingMessage, res: ServerResponse) {
  let url: string;
  let key: string;
  try {
    ({ url, key } = JSON.parse(await readBody(req)));
  } catch {
    return send(res, 400, { error: 'Invalid JSON body' });
  }
  if (typeof url !== 'string' || typeof key !== 'string' || !key.trim()) {
    return send(res, 400, { error: 'Project URL and API key are required' });
  }

  let base: URL;
  try {
    base = new URL(url.trim());
  } catch {
    return send(res, 400, { error: 'Project URL is not a valid URL' });
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    return send(res, 400, { error: 'Project URL must be http(s)' });
  }

  const headers: Record<string, string> = { apikey: key.trim(), Accept: 'application/openapi+json' };
  // Legacy anon / service_role keys are JWTs and also go in Authorization; new sb_* keys must not.
  if (key.trim().startsWith('eyJ')) headers.Authorization = `Bearer ${key.trim()}`;

  try {
    const upstream = await fetch(new URL('/rest/v1/', base.origin), { headers });
    const text = await upstream.text();
    if (!upstream.ok) {
      return send(res, upstream.status, { error: `Supabase responded ${upstream.status}: ${text.slice(0, 300)}` });
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(text);
  } catch (err) {
    send(res, 502, { error: `Could not reach ${base.origin}: ${(err as Error).message}` });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
