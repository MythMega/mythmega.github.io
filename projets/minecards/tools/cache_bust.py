#!/usr/bin/env python3
"""cache_bust.py - Stamps a version on every stylesheet and module of a page.

Reference: `index.html` (the `<link rel="stylesheet">` and `<script type="module">` tags),
`sw.js` (the service worker that stores those files) and `.docs/main.md` (the update policy).

WHY A SCRIPT RATHER THAN A BUNDLER
MineCards ships plain files: no build step, no hashed filenames. A browser (and the service
worker) may therefore keep serving a stylesheet or a module the deployment already replaced,
which is exactly the "I changed it but nothing moved" bug. Appending `?v=...` to the URL gives
the browser a NEW resource whenever the file changed: no hard reload, no cleared cache.

WHY A CONTENT HASH BY DEFAULT
A timestamp changes every URL on every run, even for the files nobody touched, so a player
re-downloads the whole game for nothing and the service worker stores a second copy of each
file. The hash of the file content only changes when the file does, which is both reliable and
cheap. `--mode timestamp` keeps the plain timestamp behaviour (one value shared by every file)
for the cases where a single build number is preferred.

USAGE
  python tools/cache_bust.py                 stamp index.html with per-file content hashes
  python tools/cache_bust.py --mode timestamp  stamp index.html with a single timestamp
  python tools/cache_bust.py overlay.html collection.html
  python tools/cache_bust.py --check         exit 1 when a page is not stamped (CI)

The script is idempotent: running it twice rewrites the same values, and an existing `?v=` (or
a query of another tool, such as `?lang=en`) is replaced instead of being appended twice.

Remote URLs (`http://`, `https://`, `//`), data URLs and bare fragments are left untouched: they
are not files of this project. A file missing on disk is left untouched too, with a warning, so a
page never ends up pointing at a version of something that does not exist.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import time
from pathlib import Path

#: Directory of the project (the parent of `tools/`), so the script works from any cwd.
PROJECT_ROOT = Path(__file__).resolve().parent.parent

#: Pages stamped when none is given on the command line.
DEFAULT_PAGES = ["index.html"]

#: Version shared by every file in `--mode timestamp`.
TIMESTAMP_VERSION = str(int(time.time()))

#: Tags whose URL is versioned, and the attribute each one carries it in.
#: `link` is restricted to stylesheets: a favicon or a manifest is not a module of the page.
TAG_PATTERN = re.compile(r"<(link|script)\b[^>]*>", re.IGNORECASE)
ATTRIBUTE_PATTERNS = {
    "link": re.compile(r'(?P<prefix>\bhref=")(?P<url>[^"]+)(?P<suffix>")', re.IGNORECASE),
    "script": re.compile(r'(?P<prefix>\bsrc=")(?P<url>[^"]+)(?P<suffix>")', re.IGNORECASE),
}

#: Extension each tag must point at to be versioned.
EXPECTED_SUFFIX = {"link": ".css", "script": ".js"}

#: Addresses that are not files of the project.
REMOTE_PATTERN = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.IGNORECASE)

#: Query parameter carrying the version.
VERSION_PARAM = "v"

#: An existing version parameter, with the `?` or `&` that introduces it.
VERSION_PATTERN = re.compile(r"(?P<separator>[?&])v=[^&#]*")

#: Printed once per page, so the report stays readable on a 200-line document.
WARNING_PREFIX = "warning"


def is_remote(url: str) -> bool:
    """Tells whether a URL addresses something other than a project file.

    Args:
        url: Value of the `href` / `src` attribute.

    Returns:
        True for an absolute URL (`https://...`, `//cdn...`), a data URL or a bare fragment.
    """
    text = url.strip()
    if text == "" or text.startswith("#"):
        return True
    return REMOTE_PATTERN.match(text) is not None


def split_url(url: str) -> tuple[str, str]:
    """Splits a URL into its path and its query / fragment tail.

    Args:
        url: Raw attribute value, relative to the page.

    Returns:
        A `(path, tail)` pair where `tail` starts with `?` or `#` (empty when there is none).
    """
    for index, character in enumerate(url):
        if character in "?#":
            return url[:index], url[index:]
    return url, ""


def strip_version(tail: str) -> str:
    """Removes a previous `v=` parameter from a query / fragment tail.

    Args:
        tail: Part of the URL starting at `?` or `#` (may be empty).

    Returns:
        The tail without its version parameter, still starting with `?` or `#` when non-empty.
    """
    if tail == "":
        return ""
    cleaned = VERSION_PATTERN.sub("", tail)
    if cleaned.startswith("?&"):
        cleaned = "?" + cleaned[2:]
    if cleaned == "?":
        cleaned = ""
    return cleaned


def with_version(tail: str, version: str) -> str:
    """Appends the version parameter to a query / fragment tail.

    Args:
        tail: Tail without a version parameter (see `strip_version`).
        version: Value to append.

    Returns:
        The tail carrying `v=<version>`. A fragment stays last, because a query written after a
        `#` would be part of the fragment and never reach the server.
    """
    fragment = ""
    query = tail
    if "#" in tail:
        query, fragment = tail.split("#", 1)
    separator = "&" if "?" in query else "?"
    return f"{query}{separator}{VERSION_PARAM}={version}{('#' + fragment) if fragment else ''}"


def content_version(path: Path) -> str:
    """Builds the version of one file from its content.

    Args:
        path: File on disk.

    Returns:
        The first ten hexadecimal characters of its SHA-256 (short enough to read, wide enough
        that two different files sharing a prefix is not a concern for a game shell).
    """
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest[:10]


def resolve_version(url_path: str, mode: str, page_dir: Path) -> tuple[str | None, str]:
    """Finds the version to append to one referenced file.

    Args:
        url_path: Path of the reference, relative to the page.
        mode: `hash` (per file) or `timestamp` (one value for the whole run).
        page_dir: Directory of the page, used to resolve the reference.

    Returns:
        A `(version, reason)` pair: `version` is None when the file cannot be versioned, and
        `reason` explains why (empty on success).
    """
    if mode == "timestamp":
        return TIMESTAMP_VERSION, ""

    candidate = (page_dir / url_path).resolve()
    try:
        candidate.relative_to(PROJECT_ROOT)
    except ValueError:
        return None, "outside the project"
    if not candidate.is_file():
        return None, "missing on disk"
    return content_version(candidate), ""


def stamp_tag(tag: str, tag_name: str, mode: str, page_dir: Path, report: dict) -> str:
    """Versions the URL of one `link` / `script` tag.

    Args:
        tag: Whole tag, attributes included.
        tag_name: `link` or `script` (lowercase).
        mode: `hash` or `timestamp`.
        page_dir: Directory of the page being stamped.
        report: Mutable counters of the run (`stamped`, `skipped`, `missing`).

    Returns:
        The tag, with its URL versioned when it points at a file of the project.
    """
    attribute = ATTRIBUTE_PATTERNS[tag_name]
    match = attribute.search(tag)
    if match is None:
        return tag

    url = match.group("url")
    if tag_name == "link" and "stylesheet" not in tag.lower():
        report["skipped"] += 1
        return tag
    if not url.lower().split("?")[0].split("#")[0].endswith(EXPECTED_SUFFIX[tag_name]):
        report["skipped"] += 1
        return tag
    if is_remote(url):
        report["skipped"] += 1
        return tag

    url_path, tail = split_url(url)
    version, reason = resolve_version(url_path, mode, page_dir)
    if version is None:
        report["missing"] += 1
        print(f"{WARNING_PREFIX}: {url_path} ({reason}) is left unversioned", file=sys.stderr)
        return tag

    stamped = f"{url_path}{with_version(strip_version(tail), version)}"
    report["stamped"] += 1
    return tag[: match.start("url")] + stamped + tag[match.end("url") :]


def stamp_page(page: Path, mode: str, check: bool) -> tuple[int, dict]:
    """Versions every stylesheet and module of one page.

    Args:
        page: Page to rewrite.
        mode: `hash` or `timestamp`.
        check: When True, the page is never written (only compared).

    Returns:
        A `(changes, report)` pair: how many tags WOULD change (or changed), and the counters.
    """
    original = page.read_bytes().decode("utf-8")
    report = {"stamped": 0, "skipped": 0, "missing": 0}

    def replace(match: re.Match) -> str:
        return stamp_tag(match.group(0), match.group(1).lower(), mode, page.parent, report)

    updated = TAG_PATTERN.sub(replace, original)
    changes = 0
    if updated != original:
        changes = sum(
            1 for before, after in zip(original.split("<"), updated.split("<")) if before != after
        )
        if not check:
            page.write_bytes(updated.encode("utf-8"))
    return changes, report


def main(argv: list[str] | None = None) -> int:
    """Runs the tool.

    Args:
        argv: Command line arguments (without the program name).

    Returns:
        Process exit code: 0 on success (and when `--check` finds nothing to do), 1 when a page
        is out of date in `--check` mode or cannot be read.
    """
    parser = argparse.ArgumentParser(
        description="Version the stylesheets and modules of a page against the browser cache.",
    )
    parser.add_argument(
        "pages",
        nargs="*",
        default=DEFAULT_PAGES,
        help=f"pages to stamp (default: {' '.join(DEFAULT_PAGES)})",
    )
    parser.add_argument(
        "--mode",
        choices=("hash", "timestamp"),
        default="hash",
        help="hash: one version per file content (default); timestamp: one value for the run",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write: exit 1 when a page is not stamped with the current versions",
    )
    args = parser.parse_args(argv)

    failures = 0
    for name in args.pages:
        page = (PROJECT_ROOT / name).resolve()
        if not page.is_file():
            print(f"error: {name} does not exist", file=sys.stderr)
            failures += 1
            continue

        changes, report = stamp_page(page, args.mode, args.check)
        state = "up to date" if changes == 0 else f"{changes} tag(s) {'to update' if args.check else 'updated'}"
        print(
            f"{name}: {report['stamped']} versioned, {report['skipped']} ignored, "
            f"{report['missing']} missing ({state})"
        )
        if args.check and changes > 0:
            failures += 1

    return 1 if failures > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
