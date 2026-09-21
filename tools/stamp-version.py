#!/usr/bin/env python3
"""
stamp-version.py — appends ?v=<version> to the site's own code URLs.

GitHub Pages sends `Cache-Control: max-age=600` on everything and gives you no
way to change it, so for ten minutes after a deploy a returning visitor can be
running the new index.html against a cached copy of the old stylesheet — or,
worse, a new js/app.js against a cached js/tour.js, since ES module imports are
separate requests with separate cache entries. A version in the URL makes each
deploy a different URL, so there is nothing stale to match.

Run at deploy time against a disposable checkout — see
.github/workflows/deploy-pages.yml. It is deliberately NOT run against your
working tree: the repository stays clean, and `?v=` never shows up in a diff.

    python3 tools/stamp-version.py <version> [project-root]

`version` is any token safe in a URL; the workflow passes the commit sha.

What gets stamped, and nothing else:

    index.html          css/*.css, js/*.js, vendor/*.js
    js/**.js            relative import specifiers ('./tour.js', '../x.js')
    js/**.js            the one 'config/tour.json' fetch

What does not, on purpose:

    assets/**           panoramas and tiles are ~30 MB and never change once
                        generated. Stamping them would re-download the tour on
                        every deploy to fix a problem they do not have.
    api/*               those are endpoints, not files.

Each rule has to match something. A rename that silently stops the stamping is
worse than a failed deploy, so an unmatched rule exits non-zero.
"""

import os
import re
import sys

# (label, file selector, pattern, replacement) — replacement uses \g<v> for the
# version. Every pattern refuses a URL that already carries a query, so running
# this twice cannot produce "?v=a?v=b".
RULES = [
    (
        'index.html asset links',
        ['index.html'],
        re.compile(r'(?P<head>(?:href|src)=")(?P<url>(?:css|js|vendor)/[^"?#]+\.(?:css|js))(?P<tail>")'),
        r'\g<head>\g<url>?v=\g<v>\g<tail>',
    ),
    (
        'module imports',
        None,                       # every .js under js/
        re.compile(r'(?P<head>(?:from|import\()\s*)(?P<q>[\'"])(?P<url>\.{1,2}/[^\'"?#]+\.js)(?P=q)'),
        r'\g<head>\g<q>\g<url>?v=\g<v>\g<q>',
    ),
    (
        'the tour.json fetch',
        None,
        re.compile(r"(?P<head>')(?P<url>config/tour\.json)(?P<tail>')"),
        r'\g<head>\g<url>?v=\g<v>\g<tail>',
    ),
]


def javascript_files(root):
    found = []
    for directory, subdirectories, names in os.walk(os.path.join(root, 'js')):
        subdirectories[:] = [name for name in subdirectories if not name.startswith('.')]
        found.extend(os.path.join(directory, name)
                     for name in sorted(names) if name.endswith('.js'))
    return found


def main():
    if not 2 <= len(sys.argv) <= 3:
        sys.exit(__doc__.strip())

    version = sys.argv[1].strip()
    if not version or re.search(r'[^A-Za-z0-9._-]', version):
        sys.exit('The version has to be a plain URL-safe token, not %r.' % version)
    root = os.path.abspath(sys.argv[2] if len(sys.argv) == 3 else
                           os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    if not os.path.isfile(os.path.join(root, 'index.html')):
        sys.exit('No index.html under %s — is that the project root?' % root)

    failures = []
    for label, selector, pattern, replacement in RULES:
        paths = ([os.path.join(root, name) for name in selector] if selector
                 else javascript_files(root))
        stamped = 0
        for path in paths:
            with open(path, encoding='utf-8') as handle:
                before = handle.read()
            after, count = pattern.subn(
                replacement.replace(r'\g<v>', version), before)
            if not count:
                continue
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(after)
            stamped += count
            print('  %-24s %-24s %d' % (label, os.path.relpath(path, root), count))
        if not stamped:
            failures.append(label)

    if failures:
        sys.exit('\nNothing matched for: %s.\nThe files moved or were renamed and '
                 'the stamping silently stopped working — fix tools/stamp-version.py '
                 'rather than deploying unstamped.' % ', '.join(failures))

    print('\n  Stamped every code URL with ?v=%s' % version)


if __name__ == '__main__':
    main()
