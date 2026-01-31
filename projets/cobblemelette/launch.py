#!/usr/bin/env python3
"""
serve.py - Lance un serveur HTTP simple pour servir le répertoire courant.
"""

import http.server
import socketserver
import sys
import os
import webbrowser
import threading

def run(port: int = 80):
    handler = http.server.SimpleHTTPRequestHandler

    # Serve from current directory
    webdir = os.path.abspath(os.getcwd())
    os.chdir(webdir)

    with socketserver.TCPServer(("", port), handler) as httpd:
        sa = httpd.socket.getsockname()
        url = f"http://localhost:{sa[1]}/"

        print(f"Serving HTTP on {sa[0]} port {sa[1]} (directory: {webdir}) ...")
        print(f"Opening browser at {url}")

        # Ouvre le navigateur dans un thread séparé pour ne pas bloquer le serveur
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

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
            port = 80
    run(port)
