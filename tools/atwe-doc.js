#!/usr/bin/env node
// Render docs/ATWE.md (the one company document that goes to agencies and partners)
// into docs/ATWE.html and docs/ATWE.pdf.
//
//   node tools/atwe-doc.js
//
// The Markdown is the source of truth; never hand-edit the HTML or the PDF. The
// converter is deliberately tiny and covers only what the document uses: headings,
// paragraphs, bullet lists, tables, bold, italic, code spans and a rule. No dependency
// beyond the Chromium that playwright-core already resolves from scratchpad/.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'ATWE.md');
const OUT_HTML = path.join(ROOT, 'docs', 'ATWE.html');
const OUT_PDF = path.join(ROOT, 'docs', 'ATWE.pdf');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  .replace(/\b(atwe\.com(?:\/[\w.-]*)?)/g, '<span class="u">$1</span>');

function convert(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0, para = [], list = null, table = null, cover = true;
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push('<ul>' + list.map((l) => '<li>' + inline(l) + '</li>').join('') + '</ul>'); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'
      + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
    table = null;
  };
  const flush = () => { flushPara(); flushList(); flushTable(); };
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*$/.test(ln)) { flush(); continue; }
    if (ln === '---') { flush(); if (cover) { out.push('</section><section class="body">'); cover = false; } else out.push('<hr>'); continue; }
    let m;
    if ((m = /^(#{1,3}) (.*)$/.exec(ln))) { flush(); const n = m[1].length; const id = m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-'); out.push(`<h${n} id="${id}">${inline(m[2])}</h${n}>`); continue; }
    if (/^\|/.test(ln)) {
      flushPara(); flushList();
      if (/^\|\s*-{2,}/.test(ln)) continue;               // the header separator row
      const cells = ln.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      (table = table || []).push(cells); continue;
    }
    if ((m = /^- (.*)$/.exec(ln))) { flushPara(); flushTable(); (list = list || []).push(m[1]); continue; }
    flushList(); flushTable(); para.push(ln.trim());
  }
  flush();
  return out.join('\n');
}

const MARK = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'public', 'logo-mark.png')).toString('base64');
const md = fs.readFileSync(SRC, 'utf8');
const body = convert(md);
const css = `
  @page { size: A4; margin: 22mm 20mm 24mm 20mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111114; font-size: 10.6pt; line-height: 1.55; }
  section.cover { background: #000; color: #fff; min-height: 250mm; padding: 34mm 18mm 20mm; page-break-after: always; display: flex; flex-direction: column; justify-content: flex-end; }
  section.cover h1 { font-size: 64pt; font-weight: 800; letter-spacing: -.03em; margin: 0 0 6mm; line-height: 1; }
  section.cover h2 { font-size: 20pt; font-weight: 600; margin: 0 0 14mm; color: #fff; border: 0; padding: 0; line-height: 1.25; }
  section.cover p { color: #9a9a9e; font-size: 10.5pt; max-width: 120mm; }
  section.cover p em { font-style: normal; }
  /* THE REAL ATWE MARK, painted the way the app paints it: the PNG is a mask and the colour
     is ours, so it comes out white on the black cover whatever colour the file holds. */
  section.cover .mark { width: 26mm; height: 26mm; margin: 0 0 auto; background: #fff;
    -webkit-mask: url(${MARK}) center/contain no-repeat; mask: url(${MARK}) center/contain no-repeat; }
  section.body h1 { display: none; }
  h2 { font-size: 20pt; font-weight: 800; letter-spacing: -.02em; margin: 14mm 0 4mm; padding-top: 4mm; border-top: 2px solid #111114; page-break-after: avoid; }
  h3 { font-size: 13pt; font-weight: 700; margin: 8mm 0 2.5mm; page-break-after: avoid; }
  p { margin: 0 0 3.2mm; }
  ul { margin: 0 0 3.5mm; padding-left: 5mm; }
  li { margin: 0 0 1.4mm; }
  strong { font-weight: 700; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .92em; background: #f0f0f2; padding: .05em .3em; border-radius: 4px; }
  .u { color: #0071E0; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9.6pt; page-break-inside: auto; }
  th, td { text-align: left; vertical-align: top; padding: 2.2mm 2.5mm; border-bottom: 1px solid #e3e3e6; }
  th { font-weight: 700; border-bottom: 2px solid #111114; }
  tr { page-break-inside: avoid; }
  hr { border: 0; border-top: 1px solid #e3e3e6; margin: 8mm 0; }
  .foot { font-size: 8.5pt; color: #6b6b70; }
`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Atwe</title><style>${css}</style></head>
<body><section class="cover"><div class="mark"></div>${body}</section></body></html>`;
fs.writeFileSync(OUT_HTML, html);
console.log('wrote', path.relative(ROOT, OUT_HTML), (html.length / 1024).toFixed(0) + 'KB');

(async () => {
  let chromium;
  try { chromium = require(path.join(ROOT, 'scratchpad', 'node_modules', 'playwright-core')).chromium; }
  catch (e) { try { chromium = require('playwright-core').chromium; } catch (e2) { console.log('playwright-core not found; HTML only'); return; } }
  const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.pdf({ path: OUT_PDF, format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.5pt;color:#8a8a8f;padding:0 20mm;display:flex;justify-content:space-between"><span>Atwe · atwe.com</span><span class="pageNumber"></span></div>' });
  await b.close();
  const kb = (fs.statSync(OUT_PDF).size / 1024).toFixed(0);
  console.log('wrote', path.relative(ROOT, OUT_PDF), kb + 'KB');
})();
