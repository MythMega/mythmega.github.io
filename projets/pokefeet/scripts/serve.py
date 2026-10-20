#!/usr/bin/env python3
"""Serveur statique local pour Pokefeet.

Contrairement a ``python -m http.server``, ce serveur envoie des en-tetes
``Cache-Control: no-store``. Sans cela, le navigateur peut reutiliser une
ancienne copie d'une page HTML apres un deplacement de fichiers et demander
des scripts qui n'existent plus (par exemple /migration.js).

Usage :
    python scripts/serve.py [port]

Le port par defaut est 5981.
"""

import argparse
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description="Serveur statique Pokefeet sans cache.")
    parser.add_argument("port", nargs="?", type=int, default=5981, help="port d'ecoute (defaut : 5981)")
    parser.add_argument("--host", default="127.0.0.1", help="adresse d'ecoute (defaut : 127.0.0.1)")
    args = parser.parse_args()

    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    try:
        httpd = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as exc:
        print("Impossible d'ecouter sur %s:%d : %s" % (args.host, args.port, exc), file=sys.stderr)
        print("Un ancien serveur utilise peut-etre deja ce port. Arretez-le (Ctrl+C), puis relancez.", file=sys.stderr)
        return 1

    print("Pokefeet : http://%s:%d" % (args.host, args.port))
    print("Cache navigateur desactive. Ctrl+C pour arreter.")
    try:
        with httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
