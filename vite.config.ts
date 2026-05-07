import { defineConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

const SAMPLES_DIR = path.resolve('samples');
const TEMPLATES_DIR = path.resolve('templates-runtime');

function sanitizeLabel(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return 'unlabeled';
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60);
}

function readBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [
    {
      name: 'sre-sample-saver',
      configureServer(server) {
        server.middlewares.use('/api/save-sample', async (req, res, next) => {
          if (req.method !== 'POST') {
            return next();
          }
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            await fs.mkdir(SAMPLES_DIR, { recursive: true });

            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const label = sanitizeLabel(payload.label);
            const filename = `${ts}-${label}.json`;
            const out = {
              savedAt: new Date().toISOString(),
              label,
              ...payload,
            };
            await fs.writeFile(
              path.join(SAMPLES_DIR, filename),
              JSON.stringify(out, null, 2),
              'utf8',
            );
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, filename }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });

        server.middlewares.use('/api/save-template', async (req, res, next) => {
          if (req.method !== 'POST') return next();
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const shape = sanitizeLabel(payload.shape);
            if (!shape || shape === 'unlabeled') {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: 'shape required' }));
              return;
            }
            await fs.mkdir(TEMPLATES_DIR, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${shape}-${ts}.json`;
            // Schema 1.0.0 — see src/sre/template-schema.ts
            const out = {
              schemaVersion: '1.0.0',
              shape,
              points: payload.points,
              capturedAt: new Date().toISOString(),
              captureContext: payload.captureContext ?? {
                device: 'unknown',
                os: 'unknown',
                viewport: { w: 0, h: 0 },
                pixelRatio: 1,
                inputType: 'unknown',
              },
              ...(payload.stroke ? { stroke: payload.stroke } : {}),
              importedFrom: 'ui',
            };
            await fs.writeFile(
              path.join(TEMPLATES_DIR, filename),
              JSON.stringify(out, null, 2),
              'utf8',
            );
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, filename }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });

        server.middlewares.use('/api/list-templates', async (req, res, next) => {
          if (req.method !== 'GET') return next();
          try {
            await fs.mkdir(TEMPLATES_DIR, { recursive: true });
            const files = await fs.readdir(TEMPLATES_DIR);
            const templates: Array<{ shape: string; points: unknown[] }> = [];
            for (const f of files) {
              if (!f.endsWith('.json')) continue;
              try {
                const raw = await fs.readFile(path.join(TEMPLATES_DIR, f), 'utf8');
                const t = JSON.parse(raw);
                if (t.shape && Array.isArray(t.points)) {
                  templates.push({ shape: t.shape, points: t.points });
                }
              } catch {
                // skip malformed
              }
            }
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, count: templates.length, templates }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });

        server.middlewares.use('/api/list-samples', async (req, res, next) => {
          if (req.method !== 'GET') return next();
          try {
            await fs.mkdir(SAMPLES_DIR, { recursive: true });
            const files = await fs.readdir(SAMPLES_DIR);
            const json = files.filter((f) => f.endsWith('.json')).sort();
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, count: json.length, files: json }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      },
    },
  ],
});
