const { ipcRenderer, desktopCapturer, shell, clipboard } = require('electron');
const { writeFile } = require('fs');
const path = require('path');

// State
let mediaRecorder;
let recordedChunks = [];
let stream;
let startTime;
let timerInterval;
let timerPaused = false;
let pausedTime = 0;
let lastPauseStart = 0;

let selectedMode = 'screen'; // 'screen' | 'camera'
let selectedAudio = 'none'; // 'none' | 'mic' | 'system'

// Dragging State
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Elements (Global Scope)
let setupScreen, recordingScreen, btnScreen, btnCamera, btnAudioNone, btnAudioMic, btnAudioSystem, startBtn, stopBtn, pauseBtn, resumeBtn, videoElement, timerElement;

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Ready");

    // Assign Elements
    setupScreen = document.getElementById('setup-screen');
    recordingScreen = document.getElementById('recording-screen');
    btnScreen = document.getElementById('btn-screen-only');
    btnCamera = document.getElementById('btn-camera-only');
    btnAudioNone = document.getElementById('audio-none');
    btnAudioMic = document.getElementById('audio-mic');
    btnAudioSystem = document.getElementById('audio-system');
    startBtn = document.getElementById('start-btn');
    stopBtn = document.getElementById('stop-btn');
    pauseBtn = document.getElementById('pause-btn');
    resumeBtn = document.getElementById('resume-btn');
    videoElement = document.getElementById('preview-video');
    timerElement = document.getElementById('timer');

    if (!btnScreen || !startBtn) {
        console.error("Critical elements missing!");
        alert("Error: UI Elements missing");
        return;
    }

    // Attach Listeners
    btnScreen.addEventListener('click', () => selectMode('screen'));
    btnCamera.addEventListener('click', () => selectMode('camera'));

    btnAudioNone.addEventListener('click', () => selectAudio('none'));
    btnAudioMic.addEventListener('click', () => selectAudio('mic'));
    btnAudioSystem.addEventListener('click', () => selectAudio('system'));

    // Custom Header Controls
    const closeAppBtn = document.getElementById('close-app-btn');
    const minimizeAppBtn = document.getElementById('minimize-app-btn');

    if (closeAppBtn) closeAppBtn.addEventListener('click', () => ipcRenderer.send('close-app'));
    if (minimizeAppBtn) minimizeAppBtn.addEventListener('click', () => ipcRenderer.send('minimize-app'));

    // Payment Modal Logic
    const paymentModal = document.getElementById('payment-modal');
    const closePayment = document.getElementById('close-payment');
    const buyBtn = document.getElementById('buy-license-btn');

    if (buyBtn && paymentModal) {
        buyBtn.addEventListener('click', () => paymentModal.classList.add('active'));
    }

    if (closePayment && paymentModal) {
        closePayment.addEventListener('click', () => paymentModal.classList.remove('active'));
        paymentModal.addEventListener('click', (e) => {
            if (e.target === paymentModal) paymentModal.classList.remove('active');
        });
    }

    // Copy Buttons Logic
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const textToCopy = btn.getAttribute('data-copy');
            if (textToCopy) {
                clipboard.writeText(textToCopy);
                const originalText = btn.innerText;
                btn.innerText = "Copied!";
                btn.style.background = "#fff";
                btn.style.color = "#000";

                setTimeout(() => {
                    btn.innerText = originalText;
                    btn.style.background = "";
                    btn.style.color = "";
                }, 2000);
            }
        });
    });

    // Overlay Minimize Button
    const minimizeOverlayBtn = document.getElementById('minimize-overlay-btn');
    if (minimizeOverlayBtn) {
        minimizeOverlayBtn.addEventListener('click', () => {
            ipcRenderer.send('minimize-app');
        });
    }

    // Start Recording with Countdown
    startBtn.addEventListener('click', () => {
        console.log('Click Start');
        setupScreen.classList.add('hidden');
        recordingScreen.classList.remove('hidden');

        const countdownOverlay = document.getElementById('countdown-overlay');
        const countdownNumber = document.getElementById('countdown-number');
        countdownOverlay.classList.remove('hidden');

        let count = 3;
        countdownNumber.innerText = count;

        const countdownInterval = setInterval(async () => {
            count--;
            if (count > 0) {
                countdownNumber.innerText = count;
            } else {
                clearInterval(countdownInterval);
                countdownOverlay.classList.add('hidden');

                // TRIGGER OVERLAY MODE
                ipcRenderer.send('resize-to-overlay');
                document.body.classList.add('overlay-mode');

                // Enable Dragging
                enableDragging();

                await startRecording();
            }
        }, 1000);
    });

    stopBtn.addEventListener('click', stopRecording);

    // Pause/Resume Listeners
    pauseBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.remove('hidden');
            pauseTimer();
        }
    });

    resumeBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
            resumeBtn.classList.add('hidden');
            pauseBtn.classList.remove('hidden');
            resumeTimer();
        }
    });

    // Profile Modal Logic
    const profileTrigger = document.getElementById('profile-trigger');
    const profileModal = document.getElementById('profile-modal');
    const closeProfile = document.getElementById('close-profile');

    if (profileTrigger && profileModal && closeProfile) {
        profileTrigger.addEventListener('click', () => profileModal.classList.add('active'));
        closeProfile.addEventListener('click', () => profileModal.classList.remove('active'));
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) profileModal.classList.remove('active');
        });
    }

    // Initialize UI
    selectMode('screen');
    selectAudio('none');

    // Detect Browsers
    loadBrowsers();

    // Init License Check
    checkLicense();
});

async function loadBrowsers() {
    const browserList = document.getElementById('browser-list');
    try {
        const browsers = await ipcRenderer.invoke('detect-browsers');

        browserList.innerHTML = '';

        if (browsers.length === 0) {
            browserList.innerHTML = '<div style="color: #666;">No supported browsers found.</div>';
            return;
        }

        browsers.forEach(b => {
            const btn = document.createElement('button');
            btn.className = 'audio-btn';
            btn.style.borderColor = '#ff3333';
            btn.style.color = '#ff3333';
            btn.style.fontWeight = 'bold';

            let icon = '';
            const name = b.name.toLowerCase();

            if (name === 'chrome' || name === 'chrome_canary' || name === 'chromium' || name === 'cent')
                icon = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="21.17" y1="8" x2="12" y2="8"></line><line x1="3.95" y1="6.06" x2="8.54" y2="14"></line><line x1="10.88" y1="21.94" x2="15.46" y2="14"></line></svg>';
            else if (name === 'edge')
                icon = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>';
            else if (name === 'opera' || name === 'opera_gx')
                icon = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6c-2.2 0-4 2.7-4 6s1.8 6 4 6 4-2.7 4-6-1.8-6-4-6z"></path></svg>';
            else if (name === 'brave')
                icon = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 10 10v10H2V12a10 10 0 0 1 10-10z"></path></svg>';
            else if (name === 'firefox' || name === 'librewolf' || name === 'waterfox')
                icon = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path><path d="M12 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4z"></path></svg>';
            else if (name === 'arc')
                icon = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>';
            else
                icon = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line></svg>';

            let displayName = b.name.replace(/_/g, ' ');
            displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

            btn.innerHTML = `${icon} Launch ${displayName}`;

            btn.addEventListener('click', () => {
                ipcRenderer.send('launch-browser', b.path);
            });

            browserList.appendChild(btn);
        });

    } catch (e) {
        console.error("Failed to load browsers", e);
    }
}

// --- Helper Functions ---

function selectMode(mode) {
    selectedMode = mode;
    btnScreen.classList.toggle('active', mode === 'screen');
    btnCamera.classList.toggle('active', mode === 'camera');
}

function selectAudio(type) {
    selectedAudio = type;
    btnAudioNone.classList.toggle('active', type === 'none');
    btnAudioMic.classList.toggle('active', type === 'mic');
    btnAudioSystem.classList.toggle('active', type === 'system');
}

async function startRecording() {
    try {
        let finalStream;
        const videoConstraints = {
            mandatory: {
                chromeMediaSource: 'desktop',
            }
        };

        if (selectedMode === 'camera') {
            finalStream = await navigator.mediaDevices.getUserMedia({
                audio: selectedAudio !== 'none',
                video: true
            });
        } else {
            const inputSources = await ipcRenderer.invoke('get-sources');
            const source = inputSources[0];

            videoConstraints.mandatory.chromeMediaSourceId = source.id;

            if (selectedAudio === 'mic') {
                const screenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: source.id,
                            maxWidth: 1920,
                            maxHeight: 1080,
                            minWidth: 1280,
                            minHeight: 720,
                            minFrameRate: 30,
                            maxFrameRate: 60
                        }
                    }
                });
                const micStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false
                });
                finalStream = new MediaStream([
                    ...screenStream.getVideoTracks(),
                    ...micStream.getAudioTracks()
                ]);
            } else if (selectedAudio === 'system') {
                finalStream = await navigator.mediaDevices.getUserMedia({
                    audio: { mandatory: { chromeMediaSource: 'desktop' } },
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: source.id,
                            maxWidth: 1920,
                            maxHeight: 1080,
                            minWidth: 1280,
                            minHeight: 720,
                            minFrameRate: 30,
                            maxFrameRate: 60
                        }
                    }
                });
            } else {
                finalStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: source.id,
                            maxWidth: 1920,
                            maxHeight: 1080,
                            minWidth: 1280,
                            minHeight: 720,
                            minFrameRate: 30,
                            maxFrameRate: 60
                        }
                    }
                });
            }
        }

        stream = finalStream;
        videoElement.srcObject = stream;

        const options = {
            mimeType: 'video/webm; codecs=vp9',
            videoBitsPerSecond: 8000000
        };
        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = handleStop;

        mediaRecorder.start();
        startTimer();

    } catch (e) {
        console.error("Recording error:", e);
        alert("Failed to start recording: " + e.message);

        // RESET UI ON ERROR
        ipcRenderer.send('resize-to-main');
        document.body.classList.remove('overlay-mode');

        setupScreen.classList.remove('hidden');
        recordingScreen.classList.add('hidden');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

async function handleStop() {
    ipcRenderer.send('resize-to-main');
    document.body.classList.remove('overlay-mode');

    const blob = new Blob(recordedChunks, { type: 'video/webm; codecs=vp9' });
    const buffer = Buffer.from(await blob.arrayBuffer());
    const filename = `wello-recording-${Date.now()}.webm`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        if (stream) stream.getTracks().forEach(track => track.stop());
        recordedChunks = [];

        setupScreen.classList.remove('hidden');
        recordingScreen.classList.add('hidden');
        if (timerInterval) clearInterval(timerInterval);
        timerElement.innerText = "00:00";
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
    }, 500);
}

// --- Timer Functions ---

function startTimer() {
    startTime = Date.now();
    pausedTime = 0;
    timerPaused = false;
    if (timerInterval) clearInterval(timerInterval);

    let lastLicenseCheck = Date.now();

    timerInterval = setInterval(async () => {
        if (!timerPaused) {
            const now = Date.now();
            const diff = now - startTime - pausedTime;
            const s = Math.floor((diff / 1000) % 60);
            const m = Math.floor((diff / 1000 / 60) % 60);
            timerElement.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

            // Consume license every 10 seconds
            if (now - lastLicenseCheck >= 10000) {
                const elapsedSec = (now - lastLicenseCheck) / 1000;
                lastLicenseCheck = now;

                // Deduct hours
                const consumed = await ipcRenderer.invoke('consume-license', elapsedSec / 3600);

                if (consumed === false) { // FALSE means expired
                    console.warn("License expired during recording!");
                    stopRecording();
                    alert("⚠️ License Expired! Recording has been stopped and saved.");
                    checkLicense();
                } else {
                    // Update badge quietly
                    checkLicense();
                }
            }
        }
    }, 1000);
}

function pauseTimer() {
    timerPaused = true;
    lastPauseStart = Date.now();
    const indicator = document.querySelector('.recording-indicator');
    if (indicator) {
        indicator.style.animation = 'none';
        indicator.style.opacity = '0.5';
    }
}

function resumeTimer() {
    pausedTime += (Date.now() - lastPauseStart);
    timerPaused = false;
    const indicator = document.querySelector('.recording-indicator');
    if (indicator) indicator.style.animation = 'blink 1s infinite';
}

// --- Dragging ---

function enableDragging() {
    const overlay = document.getElementById('controls-overlay');
    if (!overlay) return;

    overlay.style.cursor = 'grab';

    overlay.addEventListener('mousedown', (e) => {
        // Don't drag if clicking buttons
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

        isDragging = true;
        lastMouseX = e.screenX;
        lastMouseY = e.screenY;
        overlay.style.cursor = 'grabbing';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        overlay.style.cursor = 'grab';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.screenX - lastMouseX;
        const deltaY = e.screenY - lastMouseY;

        ipcRenderer.send('move-window', deltaX, deltaY);

        lastMouseX = e.screenX;
        lastMouseY = e.screenY;
    });
}

// --- License System Logic ---

async function checkLicense() {
    try {
        const status = await ipcRenderer.invoke('get-license-status');
        const licenseStatusEl = document.getElementById('license-status');
        const licenseRemainingEl = document.getElementById('license-remaining');
        const licenseModal = document.getElementById('license-modal');
        const licenseError = document.getElementById('license-error');

        if (!status.valid) {
            // Show Block Modal
            if (licenseModal) licenseModal.classList.add('active');
            if (status.reason === 'expired' && licenseError) {
                licenseError.innerText = "License Expired! Please purchase more hours.";
                licenseError.style.display = 'block';
            }
        } else {
            // Hide Modal
            if (licenseModal) licenseModal.classList.remove('active');

            // Update Badge
            if (licenseStatusEl && licenseRemainingEl) {
                licenseStatusEl.classList.remove('hidden');
                licenseRemainingEl.innerText = status.remaining.toFixed(2);

                // Styles
                licenseStatusEl.className = 'license-badge';
                if (status.remaining < 0.5) licenseStatusEl.classList.add('critical');
                else if (status.remaining < 2) licenseStatusEl.classList.add('warning');
            }
        }
    } catch (e) {
        console.error("License check error:", e);
    }
}

// Bind Activate Button (Global)
const activateBtn = document.getElementById('activate-btn');
const licenseInput = document.getElementById('license-input');
const licenseError = document.getElementById('license-error');

if (activateBtn) {
    activateBtn.addEventListener('click', async () => handleActivation(licenseInput, activateBtn, licenseError));
}

// Profile License Update
const profileInput = document.getElementById('profile-license-input');
const profileBtn = document.getElementById('profile-update-btn');
const profileMsg = document.getElementById('profile-license-msg');

if (profileBtn) {
    profileBtn.addEventListener('click', async () => {
        const key = profileInput.value.trim();
        if (!key) return;

        profileBtn.disabled = true;
        profileBtn.innerText = "...";

        try {
            const result = await ipcRenderer.invoke('activate-license', key);

            if (result.success) {
                profileMsg.style.display = 'block';
                profileMsg.style.color = '#00ff88';
                profileMsg.innerText = "Check updated!";
                profileInput.value = "";

                await checkLicense();

                setTimeout(() => {
                    profileMsg.style.display = 'none';
                    profileBtn.disabled = false;
                    profileBtn.innerText = "ADD";
                }, 2000);
            } else {
                profileMsg.style.display = 'block';
                profileMsg.style.color = '#ff4444';
                profileMsg.innerText = "Invalid Key";

                setTimeout(() => {
                    profileMsg.style.display = 'none';
                    profileBtn.disabled = false;
                    profileBtn.innerText = "ADD";
                }, 2000);
            }
        } catch (e) {
            console.error(e);
            profileBtn.disabled = false;
            profileBtn.innerText = "ADD";
        }
    });
}

async function handleActivation(inputEl, btnEl, errorEl) {
    const key = inputEl.value.trim();
    if (!key) return;

    btnEl.innerText = "Verifying...";
    btnEl.disabled = true;

    try {
        const result = await ipcRenderer.invoke('activate-license', key);

        if (result.success) {
            if (errorEl) errorEl.style.display = 'none';
            inputEl.value = "";

            await checkLicense();

            alert(`Success! ${result.message}`);
            btnEl.innerText = "Activated";
            setTimeout(() => {
                btnEl.innerText = "Activate License";
                btnEl.disabled = false;
            }, 2000);
        } else {
            if (errorEl) {
                errorEl.innerText = result.message || "Invalid Key";
                errorEl.style.display = 'block';
            }
            btnEl.innerText = "Activate License";
            btnEl.disabled = false;
        }
    } catch (e) {
        if (errorEl) {
            errorEl.innerText = "Error contacting license system";
            errorEl.style.display = 'block';
        }
        btnEl.innerText = "Activate License";
        btnEl.disabled = false;
    }
}
