const video = document.getElementById('localVideo');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const grayscaleSwitch = document.getElementById('grayscaleSwitch');
const nameInput = document.getElementById('nameInput');
const muteBtn = document.getElementById('muteBtn');
const clientIdSpan = document.getElementById('clientIdSpan');
const authKeyInput = document.getElementById('authKeyInput');

// Canvas for video processing (this is what you see on screen)
const canvasVideo = document.getElementById('modifiedVideo');
const ctxVideo = canvasVideo.getContext('2d');

// Helper variables
let isMuted = false;
let grayScaleEnabled = false;
let mediaRecorder; 
let localStream; 
let ws; 
let isRecording = false;
let animationId; 

// 1. Initialize camera
async function init() {
  // Fix for iOS/Safari
  video.playsInline = true; 
  video.muted = true;

  try {
    // Try HD resolution
    localStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
            width: { ideal: 1280 }, 
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
        }, 
        audio: true 
    });
  } catch (e) {
  console.warn("HD camera not available, trying basic...", e);
  try {
    // Fallback to any available camera
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err2) {
        alert("Camera error: check if another application is using the camera.");
        return;
    }
  }

  video.srcObject = localStream;

  // IMPORTANT: When the camera has metadata and is ready
  video.onloadedmetadata = () => {
    video.play();
    
    // Nastavíme velikost plátna podle kamery
    canvasVideo.width = video.videoWidth;
    canvasVideo.height = video.videoHeight;
    
    // Manual draw loop start (fix applied)
    drawLoop(); 
  };
}

// 2. Main draw loop (replaces FaceAPI)
function drawLoop() {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
        // Draw current frame from the camera to the canvas
        ctxVideo.drawImage(video, 0, 0, canvasVideo.width, canvasVideo.height);

        // If grayscale filter is enabled
        if (grayScaleEnabled) {
            const frame = ctxVideo.getImageData(0, 0, canvasVideo.width, canvasVideo.height);
            const data = frame.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                data[i] = avg;     // R
                data[i + 1] = avg; // G
                data[i + 2] = avg; // B
            }
            ctxVideo.putImageData(frame, 0, 0);
        }
    }
    // Schedule next draw (~60fps)
    animationId = requestAnimationFrame(drawLoop);
}

// 3. Start broadcasting
startBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const authKey = authKeyInput.value.trim();

    if (!name) { alert('Please enter your name first.'); return; }
  if (!authKey) { alert('Please enter the authorization key.'); return; }

  const clientId = 'user' + Math.floor(Math.random() * 10000);
  clientIdSpan.innerText = clientId;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/?clientId=${clientId}&name=${encodeURIComponent(name)}&authKey=${authKey}`;
  
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
  console.log('Connected to server');
    isRecording = true;

    // Streamujeme z CANVASU (obsahuje i filtry)
    const outputStream = canvasVideo.captureStream(30); 
    
    if (localStream.getAudioTracks().length > 0) {
        outputStream.addTrack(localStream.getAudioTracks()[0]);
    }

    let options = { mimeType: 'video/webm;codecs=vp8' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm' };
    }
    
    try {
        mediaRecorder = new MediaRecorder(outputStream, options);
    } catch (e) {
      alert("Your browser does not support recording.");
        return;
    }

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data);
      }
    };

    mediaRecorder.start(1000);
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    muteBtn.disabled = false;
    nameInput.disabled = true;
    authKeyInput.disabled = true;
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    stopBtn.click();
  };
});

// 4. Stop broadcasting
stopBtn.addEventListener('click', () => {
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (ws) {
    ws.close();
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
  muteBtn.disabled = true;
  nameInput.disabled = false;
  authKeyInput.disabled = false;
  clientIdSpan.innerText = "(not connected)";
});

grayscaleSwitch.addEventListener('change', () => {
  grayScaleEnabled = grayscaleSwitch.checked;
});

muteBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;

  audioTrack.enabled = !audioTrack.enabled;
  const isMuted = !audioTrack.enabled; 
  
  if (audioTrack.enabled) {
    muteBtn.textContent = 'Mute Microphone';
    muteBtn.classList.replace('btn-warning', 'btn-secondary');
  } else {
    muteBtn.textContent = 'Unmute Microphone';
    muteBtn.classList.replace('btn-secondary', 'btn-warning');
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'muteStatus', muted: isMuted }));
  }
});

// Start
init();