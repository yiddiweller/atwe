/* DOES THE STORAGE MODULE SIGN ITS UPLOADS CORRECTLY?
 *
 * storage.js writes AWS Signature V4 by hand — deliberately, to avoid pulling a
 * large SDK in for one PUT and one DELETE. It had never been run against a real
 * bucket, so nobody knew whether the signature was right. Finding that out by
 * creating a Cloudflare account and watching it fail is the expensive way.
 *
 * This stands up a FAKE bucket on localhost, points storage.js at it, and does a
 * real upload. It then re-derives the signature from the received request using
 * `aws4` — a small, independently written, very widely used SigV4 library — and
 * compares. Two independent implementations agreeing on the same bytes is strong
 * evidence the recipe is right.
 *
 * It exercises the REAL path (putDataUrl -> fetch -> headers on the wire), not an
 * internal function, so key generation, content types and the canonical request
 * are all covered too.
 *
 *   cd scratchpad && node storagesign.js
 */
const https = require('https');
const fs = require('fs');
const { execFileSync } = require('child_process');

/* aws4 is the independent yardstick, and it is deliberately NOT a dependency of
   Atwe — it exists only to check our arithmetic. Install it into the scratchpad
   when you want to run this:  npm install aws4 --no-save  */
let aws4 = null;
try { aws4 = require('./node_modules/aws4'); } catch (_) {
  console.log('  aws4 is not installed — skipping (npm install aws4 --no-save)');
  process.exit(0);
}

/* storage.js only ever speaks https, which is right for R2, B2 and AWS. So the
   fake bucket needs a real certificate; make one if it is not already there. */
const CERT = '/tmp/fakes3.crt', CKEY = '/tmp/fakes3.key';
if (!fs.existsSync(CERT) || !fs.existsSync(CKEY)) {
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', CKEY, '-out', CERT,
      '-days', '2', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
      { stdio: 'ignore' });
  } catch (_) { console.log('  openssl is not available — skipping'); process.exit(0); }
}

const KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const BUCKET = 'atwe-media';
const REGION = 'us-east-1';

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

(async () => {
  const seen = [];
  /* A real HTTPS bucket, because storage.js deliberately only ever speaks https —
     correct for R2, B2 and AWS, and a good safe default. A self-signed cert plus
     NODE_TLS_REJECT_UNAUTHORIZED=0 (this process only) is what lets us test it. */
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const srv = https.createServer(
    { key: fs.readFileSync(CKEY), cert: fs.readFileSync(CERT) },
    (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(200); res.end('');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  process.env.S3_BUCKET = BUCKET;
  process.env.S3_ACCESS_KEY = KEY;
  process.env.S3_SECRET_KEY = SECRET;
  process.env.S3_REGION = REGION;
  process.env.S3_ENDPOINT = 'https://127.0.0.1:' + port;
  const storage = require('../storage.js');

  ok(storage.isConfigured(), 'the module reports itself configured');

  /* A real upload of a real (tiny) PNG. */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  const url = await storage.putDataUrl(dataUrl, 'probe');

  ok(!!url, 'the upload was accepted and returned a URL', String(url));
  ok(seen.length === 1, 'exactly one request was made', 'saw ' + seen.length);
  if (!seen.length) { srv.close(); console.log('\n1 FAILED'); process.exit(1); }

  const r = seen[0];
  ok(r.method === 'PUT', 'it is a PUT', r.method);
  ok(r.body.equals(png), 'the bytes on the wire are the original image, decoded');
  ok(/^\/atwe-media\/atwe\/probe\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.png$/.test(r.url),
     'the object path is bucket + prefix + kind + date + a random name', r.url);
  ok(r.headers['content-type'] === 'image/png', 'the content type is carried', r.headers['content-type']);

  const payloadHash = require('crypto').createHash('sha256').update(r.body).digest('hex');
  ok(r.headers['x-amz-content-sha256'] === payloadHash,
     'x-amz-content-sha256 really is the hash of the body');

  /* ── the actual question: is the signature right? ──────────────────────────
     Rebuild the same request for aws4, forcing its clock to the one storage.js
     used (aws4 honours an X-Amz-Date it is handed). Only the headers storage.js
     signed are passed, so both sides sign the same canonical request. */
  const signedHeaders = (/SignedHeaders=([^,]+)/.exec(r.headers.authorization || '') || [])[1] || '';
  const opts = {
    host: '127.0.0.1:' + port,
    method: 'PUT',
    path: r.url,
    service: 's3',
    region: REGION,
    headers: {},
    body: r.body,
  };
  for (const h of signedHeaders.split(';')) {
    if (h === 'host') continue;                       // aws4 sets host itself
    opts.headers[h] = r.headers[h];
  }
  /* aws4 adds Content-Length to what IT signs; storage.js does not. Neither is
     wrong — S3 verifies against whatever SignedHeaders lists, and content-length
     is not one of the headers it requires — but comparing them straight would be
     comparing two different canonical requests and reporting a bug that is not
     there. Tell aws4 to ignore it, so both sign the identical header set. */
  opts.extraHeadersToIgnore = { 'content-length': true };
  aws4.sign(opts, { accessKeyId: KEY, secretAccessKey: SECRET });
  ok((/SignedHeaders=([^,]+)/.exec(opts.headers.Authorization || '') || [])[1] === signedHeaders,
     'both implementations are signing the same set of headers',
     'ours=' + signedHeaders + ' aws4=' + (/SignedHeaders=([^,]+)/.exec(opts.headers.Authorization || '') || [])[1]);

  const mine = (/Signature=([0-9a-f]+)/.exec(r.headers.authorization || '') || [])[1];
  const theirs = (/Signature=([0-9a-f]+)/.exec(opts.headers.Authorization || '') || [])[1];
  console.log('    ours   ' + mine);
  console.log('    aws4   ' + theirs);
  ok(!!mine && mine === theirs,
     'the signature matches an independent SigV4 implementation, byte for byte',
     'ours=' + mine + ' aws4=' + theirs);

  ok(/^AWS4-HMAC-SHA256 Credential=/.test(r.headers.authorization || ''),
     'the Authorization header has the shape S3 expects');
  ok(new RegExp('Credential=' + KEY + '/\\d{8}/' + REGION + '/s3/aws4_request').test(r.headers.authorization || ''),
     'the credential scope names the right key, region and service');

  /* ── the DELETE path ─────────────────────────────────────────────────────
     Used whenever a post or message with media is removed. Same signing recipe,
     different verb — worth proving separately, because a broken DELETE fails
     silently and quietly leaks storage forever. */
  seen.length = 0;
  await storage.remove(url);
  ok(seen.length === 1 && seen[0].method === 'DELETE', 'removing a file sends a signed DELETE',
     seen.length ? seen[0].method : 'no request');

  /* ── the presigned upload ────────────────────────────────────────────────
     This is the path for LARGE files — it hands the browser a URL that lets it
     upload a video straight to the bucket without passing through the server.
     It is what makes 3-hour videos possible instead of 2-minute ones, and it is
     signed a completely different way (in the query string, not a header). */
  const pre = storage.presignPut('video/mp4', 'probe', 900);
  ok(pre && pre.uploadUrl && /X-Amz-Signature=/.test(pre.uploadUrl), 'a presigned upload URL is produced',
     pre ? JSON.stringify(Object.keys(pre)) : 'null');

  if (pre && pre.uploadUrl) {
    const u = new URL(pre.uploadUrl);
    const mineQ = u.searchParams.get('X-Amz-Signature');
    const qOpts = {
      host: u.host, method: 'PUT', path: u.pathname, service: 's3', region: REGION,
      headers: {}, signQuery: true,
      /* aws4 works out the expiry from this; force ours so both sign the same string. */
    };
    qOpts.path = u.pathname + '?X-Amz-Expires=' + u.searchParams.get('X-Amz-Expires');
    const rs = new aws4.RequestSigner(qOpts, { accessKeyId: KEY, secretAccessKey: SECRET });
    /* Set aws4's CLOCK, not a header. Handing it an X-Amz-Date header makes it sign
       host;x-amz-date, while storage.js signs host alone — which is what AWS's own
       presigners do for S3. Comparing those two reports a bug that is not there. */
    rs.datetime = u.searchParams.get('X-Amz-Date');
    rs.sign();
    const theirsQ = new URL('https://' + u.host + rs.request.path).searchParams.get('X-Amz-Signature');
    console.log('    presign ours ' + mineQ);
    console.log('    presign aws4 ' + theirsQ);
    ok(!!mineQ && mineQ === theirsQ,
       'the presigned signature matches the independent implementation too',
       'ours=' + mineQ + ' aws4=' + theirsQ);
    ok(u.searchParams.get('X-Amz-SignedHeaders') === 'host',
       'only the host is signed, so the browser may send its own headers');
  }

  /* ── the button the owner will actually press ────────────────────────────── */
  const st = await storage.selfTest();
  ok(st && st.ok === true, 'the admin dashboard self-test reports success against a live bucket',
     JSON.stringify(st));

  /* ── and the safety property: with nothing configured, nothing is lost ──── */
  for (const k of Object.keys(require.cache)) if (/storage\.js$/.test(k)) delete require.cache[k];
  delete process.env.S3_BUCKET; delete process.env.S3_ACCESS_KEY; delete process.env.S3_SECRET_KEY;
  const off = require('../storage.js');
  ok(off.isConfigured() === false, 'with no bucket configured it reports itself off');
  ok((await off.putDataUrl(dataUrl, 'probe')) === null,
     'and an upload returns null, so the caller keeps the photo in the database');

  srv.close();
  console.log(fail ? `\n${fail} FAILED` : '\nThe storage module signs its uploads correctly');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
