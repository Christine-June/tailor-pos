"""Writes THIRD_PARTY_LICENSES.txt for the Python packages the server runs on.

    docker compose run --rm --no-deps api python scripts/licenses.py

Run inside the production image (requirements.txt only) so dev and test tools are left out.
Exits with an error for a licence outside ALLOWED, so a problem dependency is caught early.
"""
import re
import sys
from importlib.metadata import distributions
from pathlib import Path

ALLOWED = re.compile(r"MIT|BSD|Apache|ISC|PSF|Python Software Foundation|LGPL|MPL|Unlicense|HPND", re.I)
SKIP = {"pip", "setuptools", "wheel"}

MIT_TEXT = """Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE."""

# Packages whose published metadata omits the licence. Checked against each project's repository.
KNOWN = {
    "flask-cors": ("MIT (per github.com/corydolphin/flask-cors)", "Copyright (C) 2016 Cory Dolphin, Olin College\n\n" + MIT_TEXT),
}


def licence_of(dist) -> str:
    if dist.metadata["Name"].lower() in KNOWN:
        return KNOWN[dist.metadata["Name"].lower()][0]
    meta = dist.metadata
    expression = meta.get("License-Expression")
    if expression:
        return expression
    classifiers = [c.split("::")[-1].strip() for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    if classifiers:
        return ", ".join(classifiers)
    text = (meta.get("License") or "").strip()
    return text.splitlines()[0][:80] if text else "UNKNOWN"


def licence_text(dist) -> str:
    if dist.metadata["Name"].lower() in KNOWN:
        return KNOWN[dist.metadata["Name"].lower()][1]
    for f in dist.files or []:
        if re.search(r"(^|/)(licen[cs]e|copying|notice)[^/]*$", str(f), re.I):
            try:
                return Path(dist.locate_file(f)).read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                continue
    return (dist.metadata.get("License") or "").strip() or "(no licence text shipped with the package)"


def main() -> int:
    dists = sorted({d.metadata["Name"].lower(): d for d in distributions() if d.metadata["Name"]}.values(), key=lambda d: d.metadata["Name"].lower())
    dists = [d for d in dists if d.metadata["Name"].lower() not in SKIP]
    problems, sections = [], []
    for d in dists:
        name, version, lic = d.metadata["Name"], d.version, licence_of(d)
        if not ALLOWED.search(lic):
            problems.append(f"{name} {version}: {lic}")
        sections.append(f"{'=' * 72}\n{name} {version}\nLicence: {lic}\n\n{licence_text(d)}\n")
    out = Path(__file__).resolve().parent.parent / "THIRD_PARTY_LICENSES.txt"
    out.write_text(f"Tailor POS server: open-source packages ({len(dists)}).\n\n" + "\n".join(sections), encoding="utf-8")
    print(f"Wrote {out.name} ({len(dists)} packages).")
    if problems:
        print("Licences that need a look before shipping:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
