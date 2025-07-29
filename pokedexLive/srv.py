import http.server
import socketserver

PORT = 80

# Crée un gestionnaire qui sert les fichiers depuis le répertoire actuel
Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serveur démarré sur le port {PORT}")
    httpd.serve_forever()
