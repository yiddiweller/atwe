/* Serve the phone app's web build at the ROOT of its own origin, and proxy
   /api to the real Atwe server. Expo Router needs to be at the root (it does
   not know about a path prefix) and the app's fetches must be same-origin
   (there is no CORS on the API), so a tiny front door satisfies both. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIST = process.env.DIST;
const API = process.env.API;      // e.g. http://localhost:3262
const PORT = Number(process.env.PORT || 4399);
const TYPES = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.css':'text/css' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const target = new URL(API + req.url);
    const p = http.request({ hostname: target.hostname, port: target.port, path: target.pathname + target.search,
      method: req.method, headers: { ...req.headers, host: target.host } }, (pr) => {
      res.writeHead(pr.statusCode, pr.headers); pr.pipe(res);
    });
    p.on('error', () => { res.writeHead(502); res.end('proxy error'); });
    req.pipe(p);
    return;
  }
  let f = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  /* Hide expo-router's WEB-ONLY tab shim.
     On iOS the tab bar is a real UITabBarController (Liquid Glass). The web has
     no such thing, so expo-router substitutes a plain HTML menu
     (`NativeTabsView.web.js` -> `.navigationMenuRoot`) and parks it at the TOP
     of the page. It is not in our source and never ships — but it lands in
     every screenshot right over the world name, and the founder reasonably read
     one as "the nav bar jumped to the top". Hiding it here makes a preview shot
     represent the phone. */
  if (path.extname(f) === '.html') {
    let html = fs.readFileSync(f, 'utf8');
    html = html.replace('</head>',
      '<style>[class*="navigationMenuRoot"]{display:none!important}</style></head>');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('preview on ' + PORT));
