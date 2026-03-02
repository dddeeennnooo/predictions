===== BPC-MDS Live Streaming — Quick Start (2025/26) =====

Authors: Denis Bandura (262726), 

Overview
--------
This project provides a lightweight local live-streaming setup using Nginx (with the RTMP module), a Node.js WebSocket backend that accepts WebM camera streams from browsers, and FFmpeg to compose and publish HLS variants.

Prerequisites
-------------
- Windows (instructions below use Windows conventions)
- Node.js (LTS) installed: https://nodejs.org/
- FFmpeg (6.x recommended) installed and available in your PATH

Quick Setup
-----------
1. Extract the project archive into a folder of your choice (the repository root contains the `nginx` folder).
2. Install Node.js and make sure `node` is available from a terminal.
3. Download FFmpeg for Windows and add the `bin` folder to your system PATH (System Properties → Environment Variables → Path).

Running the system
------------------
1. Start Nginx (Windows build included in the repo as `NGINX.exe`) from a terminal opened in the `nginx` folder:

```powershell
cd nginx
.\NGINX.exe
```

2. Start the Node backend which accepts browser WebM streams and forwards them into the RTMP pipeline:

```powershell
cd backend
node server_live.js
```

3. Open a web browser (Chrome or Edge recommended) and navigate to the local site. You can use either `https://localhost` or the machine's local IP address (from `ipconfig`) if you want to access the site from other devices on the same network.

Usage (broadcaster)
-------------------
- Open the broadcaster UI (e.g., `localhost/index.html` or `localhost/player.html` depending on your setup).
- Allow camera and microphone access when prompted.
- Enter a display name and the publish authorization key (default shown in `backend/server_live.js` as `PUBLISH_AUTH_KEY`).
- Click `Start` to begin sending your camera stream to the Node backend; the backend transcodes and publishes HLS variants via Nginx/RTMP.

Notes and Troubleshooting
-------------------------
- If names are not displayed in the composed output, make sure the font file `arial.ttf` exists in the backend folder (or update `FONT_PATH` in `backend/server_live.js`).
- Ensure FFmpeg is on the PATH; otherwise the Node backend will fail to spawn encoder processes.
- If you see CORS or proxy issues when the frontend calls `/api/presenters`, check that the Node backend is running on port 3000 and the Nginx `location /api/` proxy is enabled (see `nginx/conf/nginx.conf`).
- Server logs are printed to the terminal where you started Nginx and Node. Increase log verbosity in `server_live.js` or FFmpeg args if you need more diagnostics.



