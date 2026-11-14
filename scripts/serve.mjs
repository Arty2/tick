// A static server for the end-to-end tests, and nothing else. No dependency:
// it serves the repository root read-only, so the browser loads tick.html
// exactly as a user's web host would — over http, from an origin, with the
// service worker and clipboard paths that file:// skips.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

createServer(async (req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
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
