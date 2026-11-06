"""Build update-bundle.zip for launchers 1.3.0 and older.

Those launchers apply a full exe update to the temporary copy of the portable exe,
so it never reaches the user's file and they are asked to update on every start.
They do apply UI zip patches correctly, so we send them this one page that tells
the user to download the new launcher from the site once.

The stub reports version 1.3.9: lower than the real launcher (1.4.0+), which drops
any UI patch older than itself, so only old launchers ever show this page.

Usage: python scripts/make-legacy-stub.py <out.zip>
"""
import sys, os, zipfile
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'legacy-stub')
out = sys.argv[1] if len(sys.argv) > 1 else 'update-bundle.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ('index.html', 'version.json'):
        z.write(os.path.join(here, name), name)
print(out, os.path.getsize(out), 'bytes')
