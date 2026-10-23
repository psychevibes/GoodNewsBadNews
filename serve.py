#!/usr/bin/env python3
"""
Simple HTTP server for local development of the News Sentiment Dashboard.

This script starts a local web server to serve the dashboard files,
avoiding CORS issues that can occur when opening HTML files directly
in the browser via file:// protocol.

Usage:
    python serve.py [port]

Default port is 8000. The server will serve files from the 'docs' directory.
"""

import http.server
import socketserver
import os
import sys
from pathlib import Path

def main():
    # Default port
    PORT = 8000
    
    # Check if port was provided as argument
    if len(sys.argv) > 1:
        try:
            PORT = int(sys.argv[1])
        except ValueError:
            print("Invalid port number. Using default port 8000.")
    
    # Change to docs directory if it exists
    docs_dir = Path("docs")
    if docs_dir.exists() and docs_dir.is_dir():
        os.chdir(docs_dir)
        print(f"Serving files from: {docs_dir.resolve()}")
    else:
        print("Warning: 'docs' directory not found. Serving from current directory.")
        print(f"Current directory: {Path.cwd()}")
    
    # Create server
    Handler = http.server.SimpleHTTPRequestHandler
    
    # Enable CORS for local development
    class CORSHTTPRequestHandler(Handler):
        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            super().end_headers()
    
    try:
        with socketserver.TCPServer(("", PORT), CORSHTTPRequestHandler) as httpd:
            print(f"\n🚀 News Sentiment Dashboard server starting...")
            print(f"📡 Server running at: http://localhost:{PORT}")
            print(f"📰 Dashboard URL: http://localhost:{PORT}/index.html")
            print(f"📰 Headlines: http://localhost:{PORT}/headlines.html")
            print("\n🛑 Press Ctrl+C to stop the server\n")
            
            # Check if data files exist
            data_dir = Path("data")
            if data_dir.exists():
                latest_file = data_dir / "latest.json"
                history_file = data_dir / "history.json"
                
                if latest_file.exists() and history_file.exists():
                    print("✅ Data files found - dashboard should load successfully")
                else:
                    print("⚠️  Warning: Data files missing. Run fetcher.py to generate data.")
            else:
                print("⚠️  Warning: Data directory not found. Run fetcher.py to generate data.")
            
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n\n🛑 Server stopped by user")
    except OSError as e:
        if e.errno == 98 or e.errno == 48:  # Address already in use
            print(f"\n❌ Error: Port {PORT} is already in use.")
            print(f"Try a different port: python serve.py {PORT + 1}")
        else:
            print(f"\n❌ Error starting server: {e}")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")

if __name__ == "__main__":
    main()
