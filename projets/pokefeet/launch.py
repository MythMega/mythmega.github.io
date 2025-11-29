#!/usr/bin/env python3
"""
serve.py - Lance un serveur HTTP simple pour servir le répertoire courant.
Usage:
  sudo python3 serve.py        # écoute sur le port 80 (Linux/macOS)
  python3 serve.py 8000        # écoute sur le port 8000 (Windows sans élévation)
"""

import http.server
import socketserver
import sys
import os

def run(port: int = 80):
    handler = http.server.SimpleHTTPRequestHandler
    # Serve from current directory
    webdir = os.path.abspath(os.getcwd())
    os.chdir(webdir)
    with socketserver.TCPServer(("", port), handler) as httpd:
        sa = httpd.socket.getsockname()
        print(f"Serving HTTP on {sa[0]} port {sa[1]} (directory: {webdir}) ...")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()

if __name__ == "__main__":
    port = 80
    if len(sys.argv) >= 2:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Argument de port invalide, utilisation du port 80.")
    run(port)
