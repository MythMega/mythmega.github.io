#!/usr/bin/env python3
"""
Ce script lance un serveur web sur le port 25565.
Il autorise les connexions de toutes les IP et sert les fichiers du répertoire courant,
y compris index.html et les autres pages.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Écoute sur toutes les interfaces ('0.0.0.0' équivalent à une chaîne vide)
HOST = ""
PORT = 25565

def run_server():
    server_address = (HOST, PORT)
    httpd = ThreadingHTTPServer(server_address, SimpleHTTPRequestHandler)
    print(f"Serveur démarré sur http://0.0.0.0:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
