# A CSS CUSTOM PROPERTY collides exactly the way a duplicate class does: declare
# --card-r twice on :root and the LATER one silently wins, so a rule reading it gets
# a value nothing nearby explains. That happened for real (build 1725→1726): a new
# --card-r: 26px was added at the top of the file while an unrelated component family
# already declared --card-r: 18px on :root further down. Every card rendered at 18
# while the line above it said 26, and only a pixel probe noticed.
#
#   python3 tools/find-duplicate-vars.py [file ...]
#
# Reports a variable declared more than once, at the same level, in the same theme
# block, with DIFFERENT values. Theme blocks (body.light, [data-theme]) redefining a
# token is the whole point of the theme system, so those are grouped separately and a
# base-vs-theme difference is never reported.
import io, re, sys, collections

FILES = sys.argv[1:] or ['public/index.html', 'public/admin.html']

def strip_at_blocks(css):
    """Drop @media/@supports/@container bodies — a responsive override is deliberate."""
    out, i, n = [], 0, len(css)
    while i < n:
        m = re.compile(r'@(?:media|supports|container)[^{]*\{').search(css, i)
        if not m:
            out.append(css[i:]); break
        out.append(css[i:m.start()])
        depth, j = 1, m.end()
        while j < n and depth:
            if css[j] == '{': depth += 1
            elif css[j] == '}': depth -= 1
            j += 1
        i = j
    return ''.join(out)

bad = 0
for path in FILES:
    try: src = io.open(path, encoding='utf-8').read()
    except OSError: continue
    css = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', src, re.S)) or src
    css = re.sub(r'/\*.*?\*/', ' ', css, flags=re.S)   # a comment between } and the next
    css = strip_at_blocks(css)                          # selector otherwise becomes part of it
    # selector { ... } at the top level of what remains
    seen = collections.defaultdict(list)   # (selector, var) -> [values]
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel = ' '.join(m.group(1).split())
        for vm in re.finditer(r'(--[\w-]+)\s*:\s*([^;]+)', m.group(2)):
            seen[(sel, vm.group(1))].append(vm.group(2).strip())
    hits = []
    for (sel, var), vals in seen.items():
        u = list(dict.fromkeys(vals))
        if len(u) > 1:
            hits.append('%-28s %-22s %s' % (sel[:28], var, '  →  '.join(u)[:60]))
    print('%s — variable declared twice on the same selector with different values: %d'
          % (path, len(hits)))
    for h in sorted(hits): print('   ', h)
    bad += len(hits)
sys.exit(1 if bad else 0)
