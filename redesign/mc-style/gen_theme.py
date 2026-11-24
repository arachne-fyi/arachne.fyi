import re, sys
src = open(sys.argv[1]).read()
P = ':root body'
def pre(sel):
    out = []
    for s in sel.split(','):
        s = s.strip()
        if not s: continue
        if s.startswith(':root') or s.startswith('@'): out.append(s)
        elif s == 'body': out.append(P)
        elif s.startswith('body'): out.append(P + s[4:])
        else: out.append(f'{P} {s}')
    return ', '.join(out)
# simple tokenizer: handle comments, @media blocks, rules
res = []; i = 0; n = len(src)
def parse_block(s):
    out = []; i = 0
    while i < len(s):
        if s.startswith('/*', i):
            j = s.index('*/', i) + 2; out.append(s[i:j]); i = j; continue
        if s[i].isspace(): out.append(s[i]); i += 1; continue
        j = s.index('{', i); head = s[i:j].strip()
        # find matching brace
        depth = 0; k = j
        while True:
            if s[k] == '{': depth += 1
            elif s[k] == '}':
                depth -= 1
                if depth == 0: break
            k += 1
        body = s[j+1:k]
        if head.startswith('@media') or head.startswith('@supports'):
            out.append(head + ' {' + parse_block(body) + '}')
        elif head.startswith('@'):
            out.append(head + ' {' + body + '}')
        else:
            out.append(pre(head) + ' {' + body + '}')
        i = k + 1
    return ''.join(out)
print("@import './mc.css';\n" + parse_block(src))
