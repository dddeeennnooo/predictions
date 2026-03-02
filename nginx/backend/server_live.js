import { WebSocketServer } from 'ws';
import { URL } from 'url';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const PORT = 3000;
const NGINX_RTMP_BASE = 'rtmp://localhost:1936';

// --- SECURITY KEY ---
const PUBLISH_AUTH_KEY = 'MDS';
// ---------------------

// Path to font
const FONT_PATH = 'arial.ttf'; 
const HAS_FONT = fs.existsSync(FONT_PATH);

if (!HAS_FONT) {
  console.warn(`⚠️ Font ${FONT_PATH} not found. Names will not be displayed.`);
}

const clients = new Map();
let composerProc = null;
let compTimeout = null;

// --- HTTP SERVER ---
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
  
  if (req.method === 'GET' && req.url === '/presenters') {
    const list = Array.from(clients.entries()).map(([id, obj]) => ({
      id,
      name: obj.name || id,
      isMuted: obj.isMuted || false
    }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(list));
  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const clientId = params.get('clientId');
  const authKey = params.get('authKey'); // Retrieve authorization key
  const rawName = params.get('name') || clientId;
  const name = decodeURIComponent(rawName).replace(/['":\\]/g, '');

  if (!clientId) { ws.close(); return; }

    // --- AUTHORIZATION CHECK ---
    if (authKey !== PUBLISH_AUTH_KEY) {
      console.warn(`🚨 Unauthorized connection attempt! Client ${clientId} blocked.`);
      ws.close();
      return;
    }
    // ---------------------------
  
  console.log(`🔌 Client connected: ${clientId} (${name})`);

  // 1. INPUT FFmpeg
  const ffmpegInput = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error', 
    '-fflags', '+discardcorrupt+genpts',
    '-flags', 'low_delay',
    
    // Input format
    '-f', 'webm',
    '-thread_queue_size', '4096',
    '-i', 'pipe:0',

    // Encoding to RTMP
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-r', '30',            
    '-pix_fmt', 'yuv420p',  
    '-g', '60',
    '-sc_threshold', '0',
    
    '-c:a', 'aac',
    '-ar', '44100',
    '-b:a', '128k',
    '-async', '1',
    
    '-f', 'flv',
    `${NGINX_RTMP_BASE}/input/${clientId}`
  ]);

  // --- PREVENT SERVER CRASH (Error Handling) ---
  ffmpegInput.stdin.on('error', (e) => {
      if (e.code !== 'EPIPE' && e.code !== 'EOF') {
          console.error(`[Input ${clientId} Stdin Error]:`, e);
      }
  });
  // ---------------------------------------------

    ffmpegInput.stderr.on('data', d => {
      const msg = d.toString();
      if (!msg.startsWith('frame=') && !msg.includes('size=') && (msg.includes('Error') || msg.includes('Fail'))) {
       console.error(`[Input ${clientId} Error]: ${msg}`); 
      }
    });

  ffmpegInput.on('close', (code) => {
    console.log(`Input process ${clientId} exited: ${code}`);
  });

  clients.set(clientId, { ws, ffmpegInput, name });
  scheduleCompositionUpdate();

  ws.on('message', (data, isBinary) => {
    
    if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'muteStatus') {
            const clientObj = clients.get(clientId);
            if (clientObj) {
              clientObj.isMuted = msg.muted;
              console.log(`🎤 Client ${clientId} changed microphone: ${msg.muted ? 'OFF' : 'ON'}`);
            }
          }
        } catch (e) {
          console.error("Error parsing message:", e);
        }
        return;
    }

    if (ffmpegInput.exitCode === null && !ffmpegInput.stdin.destroyed) {
        try { 
            ffmpegInput.stdin.write(data); 
        } catch (e) {
        }
    }
  });

  ws.on('close', () => {
    console.log(`❌ Client disconnected: ${clientId}`);
    
    if (ffmpegInput.exitCode === null) {
        try { ffmpegInput.stdin.end(); } catch(e){}
        setTimeout(() => { 
            if(ffmpegInput.exitCode === null) {
                try { ffmpegInput.kill('SIGKILL'); } catch(e){}
            } 
        }, 1000);
    }
    
    clients.delete(clientId);
    scheduleCompositionUpdate();
  });
});
// --- COMPOSER ---
function scheduleCompositionUpdate() {
  if (compTimeout) clearTimeout(compTimeout);
  compTimeout = setTimeout(updateComposition, 4000);
}

function safeKillProcess(proc) {
  if (!proc) return;
  try { proc.stdin && proc.stdin.end(); } catch(e){}
  try { proc.kill && proc.kill('SIGKILL'); } catch(e){}
}

function updateComposition() {
  if (composerProc) {
    console.log('🔄 Restarting composer to pick up clients...');
    safeKillProcess(composerProc);
    composerProc = null;
    setTimeout(startNewComposer, 2500);
  } else {
    startNewComposer();
  }
}

function startNewComposer() {
  const activeClients = Array.from(clients.entries()).map(([id, val]) => ({ id, name: val.name }));
  const count = activeClients.length;

  if (count === 0) {
    console.log('ℹ️ No streams available — composer idle.');
    return;
  }

  console.log(`🎬 Launching composer for ${count} client(s)...`);

  const args = ['-y', '-loglevel', 'info'];

  for (const c of activeClients) {
    args.push(
      '-thread_queue_size', '1024',
      '-rw_timeout', '5000000',
      '-analyzeduration', '10000000',
      '-probesize', '50M',
      '-f', 'flv',
      '-i', `${NGINX_RTMP_BASE}/input/${c.id}`
    );
  }

  let filter = '';
  // A) Normalization and labels
  activeClients.forEach((c, i) => {
    const txt = HAS_FONT ? `,drawtext=text='${c.name}':fontfile='${FONT_PATH}':fontcolor=white:fontsize=24:x=10:y=10:box=1:boxcolor=black@0.5` : '';
    filter += `[${i}:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2${txt}[v${i}];`;
  });

  // B) Grid layout
  if (count === 1) filter += `[v0]null[v_base];`;
  else if (count === 2) filter += `[v0][v1]hstack=inputs=2[v_base];`;
  else if (count <= 4) {
    if (count === 3) filter += `nullsrc=size=640x360[black];[v0][v1]hstack=inputs=2[top];[v2][black]hstack=inputs=2[bot];[top][bot]vstack=inputs=2[v_base];`;
    else filter += `[v0][v1]hstack=inputs=2[top];[v2][v3]hstack=inputs=2[bot];[top][bot]vstack=inputs=2[v_base];`;
  } else {
    let inputs = '';
    for (let k = 0; k < count; k++) inputs += `[v${k}]`;
    filter += `${inputs}xstack=inputs=${count}:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[v_base];`;
  }

  // C) Audio mix
  for (let i = 0; i < count; i++) filter += `[${i}:a]`;
  filter += `amix=inputs=${count}[a_mixed];[a_mixed]asplit=3[a_src][a_mid][a_low];`;

  // D) Video splits for HLS
  filter += `[v_base]split=3[v_src][v_mid_in][v_low_in];`;
  filter += `[v_mid_in]scale=854:480[v_mid_out];`;
  filter += `[v_low_in]scale=426:240[v_low_out]`;

  args.push('-filter_complex', filter);

  const commonFlags = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-ar', '44100', '-f', 'flv'];

  args.push(
    '-map', '[v_src]', '-map', '[a_src]', ...commonFlags, '-b:v', '2500k', '-b:a', '128k', `${NGINX_RTMP_BASE}/hls/stream_src`,
    '-map', '[v_mid_out]', '-map', '[a_mid]', ...commonFlags, '-b:v', '800k', '-b:a', '96k', `${NGINX_RTMP_BASE}/hls/stream_mid`,
    '-map', '[v_low_out]', '-map', '[a_low]', ...commonFlags, '-b:v', '400k', '-b:a', '64k', `${NGINX_RTMP_BASE}/hls/stream_low`
  );

  composerProc = spawn('ffmpeg', args);

  composerProc.stderr.on('data', d => {
    console.error(`[FFmpeg]: ${d.toString()}`);
  });

  composerProc.on('close', (code) => {
    console.log(`Composer exited: ${code}`);
  });
}