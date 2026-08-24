# The trap that bit .mc-call-sub, .mc-inv-sub and .msg-act: the SAME plain class
# declared twice at the SAME level, with different values — the later one silently
# wins and edits to the first do nothing. A base rule overridden inside @media is
# deliberate, so at-rule blocks are separated out, not flattened.
import io, re, collections

def strip_at_blocks(css):
    """Return (base_css, [inner_css...]) with @media/@supports bodies removed from base."""
    base, inners, i, n = [], [], 0, len(css)
    while i < n:
        m = re.compile(r'@(?:media|supports|container)[^{]*\{').search(css, i)
        if not m:
            base.append(css[i:]); break
        base.append(css[i:m.start()])
        depth, j = 1, m.end()
        while j < n and depth:
            if css[j] == '{': depth += 1
            elif css[j] == '}': depth -= 1
            j += 1
        inners.append(css[m.end():j-1])
        i = j
    return ''.join(base), inners

def rules(css):
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel = re.sub(r'/\*.*?\*/', '', m.group(1), flags=re.S).strip()
        if sel and not sel.startswith('@'):
            out.append((sel, m.group(2)))
    return out

WATCH = ('color','background','background-color','font-size','width','height','border-radius','font-weight')

for path,label in [('/home/user/atwe/public/index.html','APP'),('/home/user/atwe/public/admin.html','ADMIN')]:
    src = io.open(path, encoding='utf-8').read()
    css = '\n'.join(m.group(1) for m in re.finditer(r'<style[^>]*>([\s\S]*?)</style>', src))
    base, inners = strip_at_blocks(css)
    print('\n==== %s — %d base rules, %d at-rule blocks ====' % (label, len(rules(base)), len(inners)))
    byname = collections.defaultdict(list)
    for sel, body in rules(base):
        if re.match(r'^\.[a-zA-Z][\w-]*$', sel):
            byname[sel].append(body)
    hits = []
    for sel, bodies in byname.items():
        if len(bodies) < 2: continue
        props = collections.defaultdict(list)
        for b in bodies:
            for pm in re.finditer(r'(?<![\w-])([a-z-]+)\s*:\s*([^;]+)', b):
                p = pm.group(1).strip()
                if p in WATCH: props[p].append(pm.group(2).strip())
        for p, vals in props.items():
            u = list(dict.fromkeys(vals))
            if len(u) > 1:
                hits.append('%-24s %-16s %s' % (sel, p, '  →  '.join(u)[:74]))
    print('SAME-LEVEL duplicate class with a conflicting value: %d' % len(hits))
    for h in sorted(hits): print('   ', h)
