// A static server for the end-to-end tests, and nothing else. No dependency:
// it serves the repository root read-only, over http from an origin as the
// live site does, and applies vercel.json's redirects and headers — so the
// whole suite runs under the production Content-Security-Policy, and a
// violation fails a test as a console error instead of shipping quietly.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
// Vercel's "/(.*)" source matches every path; that is the only shape used.
const headers = Object.fromEntries(
	vercel.headers.filter((r) => r.source === '/(.*)').flatMap((r) => r.headers.map((h) => [h.key, h.value]))
);
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const path = normalize(decodeURIComponent(url.pathname));
	for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
	// Vercel carries the query string through a redirect; so must this, or a
	// share link to the bare domain would lose its timer.
	const redirect = vercel.redirects?.find((r) => r.source === path);
	if (redirect) return res.writeHead(redirect.permanent ? 308 : 307, { location: redirect.destination + url.search }).end();
	// Browsers ask for one unprompted; a 404 would read as a console error.
	if (path === '/favicon.ico') return res.writeHead(204).end();
	const file = join(root, path === '/' ? 'tick.html' : path);
	// normalize() resolves "..", so anything still outside root is refused.
	if (!file.startsWith(root)) return res.writeHead(403).end();
	try {
		const body = await readFile(file);
		res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
	} catch {
		res.writeHead(404).end();
	}
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
