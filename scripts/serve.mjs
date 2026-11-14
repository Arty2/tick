// A static server for the end-to-end tests, and nothing else. No dependency:
// it serves app/ read-only, over http from an origin as the live site does,
// and applies vercel.json's headers — so the whole suite runs under the
// production Content-Security-Policy, and a violation fails a test as a
// console error instead of shipping quietly.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const vercel = JSON.parse(await readFile(join(repo, 'vercel.json'), 'utf8'));
// What Vercel publishes is what this serves.
const root = join(repo, vercel.outputDirectory);
const port = Number(process.env.PORT ?? 4173);
// Vercel's "/(.*)" source matches every path; that is the only shape used.
const headers = Object.fromEntries(
	vercel.headers.filter((r) => r.source === '/(.*)').flatMap((r) => r.headers.map((h) => [h.key, h.value]))
);
// Module scripts and the manifest are refused under nosniff without the right type.
const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png'
};

createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const path = normalize(decodeURIComponent(url.pathname));
	for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
	// Browsers ask for one unprompted; a 404 would read as a console error.
	if (path === '/favicon.ico') return res.writeHead(204).end();
	const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
	// normalize() resolves "..", so anything still outside root is refused.
	if (!file.startsWith(root)) return res.writeHead(403).end();
	try {
		const body = await readFile(file);
		// Never cached by the browser, as on Vercel (max-age=0): a test must
		// see the file as it is now.
		res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
	} catch {
		res.writeHead(404).end();
	}
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
