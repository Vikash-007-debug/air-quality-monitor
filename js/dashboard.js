// ==========================================================================
// AEROMONITOR ENTERPRISE - DASHBOARD CONTROLLER & TELEMETRY ENGINE
// Dual Theme: Obsidian Black & Metallic Silver (Normal)
//             Blood Red & Crimson Strobe (Emergency Hazard)
// ==========================================================================

// Exact Arc Length for r=75 Semicircle: pi * 75 = 235.619
const ARC_LENGTH = 235.62;

// Sensor Operating Ranges
const TEMP_MIN = 0, TEMP_MAX = 50;       // DHT11 range: 0-50°C
const HUMID_MIN = 0, HUMID_MAX = 100;    // DHT11 range: 0-100%
const GAS_MIN = 0, GAS_MAX = 4095;      // MQ-135 12-Bit ADC range: 0-4095

// ==========================================================================
// REAL-TIME SAFETY & EMERGENCY THRESHOLDS
// ==========================================================================
const EMERGENCY_THRESHOLDS = {
    gas: 1600,        // MQ-135 reading >= 1600 indicates toxic VOC, smoke, or LPG leak
    tempHigh: 40.0,   // DHT11 reading >= 40.0°C indicates extreme heat or fire hazard
    humidHigh: 88.0   // DHT11 reading >= 88.0% indicates critical condensation hazard
};

// Emergency & Alert State Variables
let isEmergencyActive = false;
let isAudioMuted = false;
let audioContext = null;
let sirenInterval = null;
let lastEmailSentTimestamp = 0;
const EMAIL_COOLDOWN_MS = 60 * 1000; // 60-second cooldown between auto-emails
let isSimulationActive = false;
let incidentLedger = [];
let emergencyIncidentCount = 0;

// ==========================================================================
// EMAILJS CONFIGURATION (Direct Gmail Delivery to Customer)
// ==========================================================================
const EMAILJS_CONFIG = {
    serviceId: "service_cid42oc",
    templateId: "template_q4x7j0f",
    publicKey: "CHDhlqEzhQaT7cvVX"
};

if (window.emailjs) {
    try {
        emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    } catch (e) {
        console.warn("EmailJS init note:", e);
    }
}

// ==========================================================================
// TELEMETRY HISTORY & STATISTICAL BUFFER
// ==========================================================================
const MAX_LIVE_POINTS = 30;
const MAX_HISTORY_POINTS = 500;

const telemetryBuffer = {
    timestamps: [],
    gas: [],
    temp: [],
    humid: []
};

// Active historical filter range: '1h', '6h', '24h'
let currentHistoryFilter = '1h';

// Chart.js Instances
let liveChartInstance = null;
let historicalChartInstance = null;

// ==========================================================================
// SPEEDOMETER GAUGES CONTROLLER
// ==========================================================================

/**
 * Update a speedometer gauge with a new value
 * @param {string} id     - Gauge identifier: 'temp', 'humid', or 'gas'
 * @param {number} value  - The current sensor value
 * @param {number} min    - Minimum of the gauge range
 * @param {number} max    - Maximum of the gauge range
 */
function updateGauge(id, value, min, max) {
    // Clamp value strictly within range
    value = Math.max(min, Math.min(max, value));

    // Calculate percentage (0.0 to 1.0)
    const percent = (value - min) / (max - min);

    // 1. Update filled arc (stroke-dashoffset)
    const fillEl = document.getElementById(id + 'Fill');
    if (fillEl) {
        const offset = ARC_LENGTH * (1 - percent);
        fillEl.style.strokeDashoffset = offset;
        fillEl.style.stroke = getGaugeColor(id, percent);
    }

    // 2. Rotate speedometer needle around pivot (100px, 105px)
    // -90deg = 0% (horizontal left) | 0deg = 50% (vertical up) | +90deg = 100% (horizontal right)
    const needleEl = document.getElementById(id + 'Needle');
    if (needleEl) {
        const angle = -90 + (percent * 180);
        needleEl.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    }

    // 3. Update mathematically centered digital display plate
    const valueEl = document.getElementById(id + 'Value');
    if (valueEl) {
        if (id === 'temp' || id === 'humid') {
            valueEl.textContent = value.toFixed(1);
        } else {
            valueEl.textContent = Math.round(value);
        }
    }

    // 4. Update status pill badge below gauge
    updateStatus(id, percent);
}

/**
 * Calculate dynamic gauge gradient color based on percentage
 */
function getGaugeColor(id, percent) {
    if (isEmergencyActive) {
        return '#ff1744';
    }

    if (id === 'temp') {
        if (percent < 0.30) return '#38bdf8';       // Cold - Light Blue
        if (percent < 0.55) return '#10b981';       // Comfortable - Emerald
        if (percent < 0.75) return '#f59e0b';       // Warm - Amber
        return '#ef4444';                           // Danger - Red
    }

    if (id === 'humid') {
        if (percent < 0.25) return '#f59e0b';       // Dry - Amber
        if (percent < 0.65) return '#06b6d4';       // Optimal - Cyan
        if (percent < 0.85) return '#3b82f6';       // High - Blue
        return '#ef4444';                           // Excessive - Red
    }

    if (id === 'gas') {
        if (percent < 0.25) return '#10b981';       // Clean - Emerald
        if (percent < 0.40) return '#f59e0b';       // Moderate - Amber
        if (percent < 0.60) return '#f97316';       // Poor - Orange
        return '#ef4444';                           // Hazardous - Crimson
    }

    return '#94a3b8';
}

/**
 * Update the status badge text below each gauge
 */
function updateStatus(id, percent) {
    const statusEl = document.getElementById(id + 'Status');
    if (!statusEl) return;

    let text = '', cssClass = '';

    if (id === 'temp') {
        if (percent < 0.30) { text = 'Cool'; cssClass = 'moderate'; }
        else if (percent < 0.55) { text = 'Comfortable'; cssClass = 'good'; }
        else if (percent < 0.75) { text = 'Warm'; cssClass = 'moderate'; }
        else { text = 'Extreme Heat!'; cssClass = 'danger'; }
    }

    if (id === 'humid') {
        if (percent < 0.25) { text = 'Low Moisture'; cssClass = 'moderate'; }
        else if (percent < 0.65) { text = 'Optimal Humidity'; cssClass = 'good'; }
        else if (percent < 0.85) { text = 'Elevated'; cssClass = 'moderate'; }
        else { text = 'Excessive Humidity!'; cssClass = 'danger'; }
    }

    if (id === 'gas') {
        if (percent < 0.25) { text = 'Clean Air'; cssClass = 'good'; }
        else if (percent < 0.40) { text = 'Acceptable'; cssClass = 'good'; }
        else if (percent < 0.60) { text = 'Moderate VOCs'; cssClass = 'moderate'; }
        else { text = 'Hazardous Smoke/Gas!'; cssClass = 'danger'; }
    }

    statusEl.textContent = text;
    statusEl.className = 'gauge-status ' + cssClass;
}

// ==========================================================================
// BATTERY & SYSTEM DIAGNOSTICS
// ==========================================================================
function updateBattery(percent) {
    percent = Math.max(0, Math.min(100, percent));

    const bar = document.getElementById('batteryBar');
    const valueEl = document.getElementById('batteryValue');
    const voltageEl = document.getElementById('batteryVoltage');
    const iconEl = document.getElementById('batteryIcon');

    // Approximate Li-ion cell voltage: 3.2V (0%) to 4.2V (100%)
    const estimatedVoltage = (3.20 + (percent / 100) * 1.00).toFixed(2);
    if (voltageEl) voltageEl.textContent = `${estimatedVoltage}V`;

    if (bar) {
        bar.style.width = percent + '%';
        if (percent > 60) {
            bar.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
        } else if (percent > 25) {
            bar.style.background = 'linear-gradient(90deg, #f59e0b, #f97316)';
        } else {
            bar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
        }
    }

    if (valueEl) valueEl.textContent = Math.round(percent) + '%';

    if (iconEl) {
        iconEl.className = 'fas ';
        if (percent > 80) iconEl.className += 'fa-battery-full';
        else if (percent > 55) iconEl.className += 'fa-battery-three-quarters';
        else if (percent > 30) iconEl.className += 'fa-battery-half';
        else if (percent > 10) iconEl.className += 'fa-battery-quarter';
        else iconEl.className += 'fa-battery-empty';
    }
}

function setConnectionStatus(isOnline, customMsg) {
    const dot = document.getElementById('mainStatusDot');
    const text = document.getElementById('mainStatusText');
    const banner = document.getElementById('statusBanner');
    const bannerMsg = document.getElementById('statusMessage');
    const bannerHeadline = document.getElementById('bannerHeadline');
    const bannerIcon = document.getElementById('bannerIcon');

    const instDot = document.getElementById('instructionStatusDot');
    const instTitle = document.getElementById('instructionStatusTitle');
    const instDesc = document.getElementById('instructionStatusDesc');

    const streamPill = document.querySelector('.stream-status-pill');

    if (dot && text) {
        if (isOnline) {
            dot.className = 'status-dot online';
            text.textContent = 'Live';
            if (!isEmergencyActive && banner && bannerMsg) {
                banner.className = 'status-banner success';
                if (bannerHeadline) bannerHeadline.textContent = 'Telemetry Stream Active';
                if (bannerIcon) bannerIcon.className = 'fas fa-circle-check';
                bannerMsg.textContent = customMsg || 'ESP32 is connected and actively streaming live sensor data.';
            }
            if (instDot && instTitle && instDesc) {
                instDot.className = 'status-dot online';
                instTitle.textContent = 'Device Linked & Actively Transmitting';
                instDesc.textContent = 'ESP32 is sending sensor telemetry every 3 seconds.';
            }
            if (streamPill) {
                streamPill.className = 'stream-status-pill';
                streamPill.innerHTML = '<span class="pulse-ring"></span> <span>Live Stream Active</span>';
            }
        } else {
            dot.className = 'status-dot offline';
            text.textContent = 'Offline';
            if (!isEmergencyActive && banner && bannerMsg) {
                banner.className = 'status-banner warning';
                if (bannerHeadline) bannerHeadline.textContent = 'Device Offline';
                if (bannerIcon) bannerIcon.className = 'fas fa-power-off';
                bannerMsg.textContent = customMsg || 'ESP32 is powered off or disconnected. Showing last recorded state.';
            }
            if (instDot && instTitle && instDesc) {
                instDot.className = 'status-dot offline';
                instTitle.textContent = 'Device Offline / Not Transmitting';
                instDesc.textContent = 'The ESP32 is powered off. Slide the power switch to ON to resume telemetry.';
            }
            if (streamPill) {
                streamPill.className = 'stream-status-pill stream-offline';
                streamPill.innerHTML = '<span class="status-dot offline"></span> <span>Stream Paused (Device Offline)</span>';
            }
        }
    }
}

function updateTimestamp() {
    const el = document.getElementById('lastUpdated');
    if (el) {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    }
}

// ==========================================================================
// REAL-TIME EMERGENCY ENGINE (BLACK & RED DUAL STATE)
// ==========================================================================
function evaluateEmergencyConditions(temp, humid, gas) {
    if (isSimulationActive) return;

    const gasAbnormal = gas >= EMERGENCY_THRESHOLDS.gas;
    const tempAbnormal = temp >= EMERGENCY_THRESHOLDS.tempHigh;
    const humidAbnormal = humid >= EMERGENCY_THRESHOLDS.humidHigh;

    const isEmergency = gasAbnormal || tempAbnormal || humidAbnormal;

    applyEmergencyState({
        active: isEmergency,
        gasAbnormal: gasAbnormal,
        tempAbnormal: tempAbnormal,
        humidAbnormal: humidAbnormal,
        tempVal: temp,
        humidVal: humid,
        gasVal: gas
    });
}

function applyEmergencyState(state) {
    const body = document.getElementById('dashboardBody');
    const gasCard = document.getElementById('gasCard');
    const tempCard = document.getElementById('tempCard');
    const humidCard = document.getElementById('humidCard');
    const banner = document.getElementById('statusBanner');
    const bannerMsg = document.getElementById('statusMessage');
    const safetyStateEl = document.getElementById('statSafetyState');

    if (state.active) {
        isEmergencyActive = true;
        body.classList.add('emergency-mode');

        // Blink specific cards that breached thresholds
        if (gasCard) gasCard.classList.toggle('emergency-blink', state.gasAbnormal);
        if (tempCard) tempCard.classList.toggle('emergency-blink', state.tempAbnormal);
        if (humidCard) humidCard.classList.toggle('emergency-blink', state.humidAbnormal);

        const reasons = [];
        if (state.gasAbnormal) reasons.push(`Hazardous Gas (${Math.round(state.gasVal)} PPM)`);
        if (state.tempAbnormal) reasons.push(`Critical Temp (${state.tempVal.toFixed(1)}°C)`);
        if (state.humidAbnormal) reasons.push(`Excessive Humidity (${state.humidVal.toFixed(1)}%)`);

        if (banner && bannerMsg) {
            banner.className = 'status-banner danger';
            bannerMsg.innerHTML = `<strong>⚠️ EMERGENCY HAZARD:</strong> ${reasons.join(' & ')} detected!`;
        }

        if (safetyStateEl) {
            safetyStateEl.textContent = 'CRITICAL';
            safetyStateEl.style.color = '#ff1744';
        }

        // Update Emergency Alert Dispatch Box Icon to strobe red
        const dispatchIcon = document.getElementById('dispatchIconBox');
        if (dispatchIcon) dispatchIcon.classList.add('active-alert');

        // Start Web Audio Siren
        startAudioAlert();

        // Dispatch Real Email Alert
        triggerEmergencyEmailNotification(reasons.join(', '));

        // Add to Incident Audit Ledger (if newly triggered)
        recordIncidentEvent("EMERGENCY BREACH", reasons.join(', '), state.gasVal, state.tempVal, state.humidVal);

    } else {
        isEmergencyActive = false;
        body.classList.remove('emergency-mode');

        if (gasCard) gasCard.classList.remove('emergency-blink');
        if (tempCard) tempCard.classList.remove('emergency-blink');
        if (humidCard) humidCard.classList.remove('emergency-blink');

        const dispatchIcon = document.getElementById('dispatchIconBox');
        if (dispatchIcon) dispatchIcon.classList.remove('active-alert');

        const emailStatus = document.getElementById('emailDispatchStatus');
        if (emailStatus && emailStatus.textContent.includes('Dispatched')) {
            emailStatus.textContent = 'Ready & Listening';
        }

        stopAudioAlert();

        if (banner && bannerMsg) {
            banner.className = 'status-banner success';
            bannerMsg.textContent = 'ESP32 telemetry stream is active and within safe thresholds.';
        }

        if (safetyStateEl) {
            safetyStateEl.textContent = 'OPTIMAL';
            safetyStateEl.style.color = '#10b981';
        }
    }
}

// ==========================================================================
// WEB AUDIO API EMERGENCY SIREN & MUTE TOGGLE
// ==========================================================================
function startAudioAlert() {
    if (isAudioMuted || sirenInterval) return;

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioContext) audioContext = new AudioContext();

        function playBeep() {
            if (isAudioMuted || !isEmergencyActive) return;
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, audioContext.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.35);

            gain.gain.setValueAtTime(0.18, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            osc.start();
            osc.stop(audioContext.currentTime + 0.35);
        }

        playBeep();
        sirenInterval = setInterval(playBeep, 1200);
    } catch (e) {
        console.warn("Audio Context init note:", e);
    }
}

function stopAudioAlert() {
    if (sirenInterval) {
        clearInterval(sirenInterval);
        sirenInterval = null;
    }
}

function toggleMuteAudio() {
    isAudioMuted = !isAudioMuted;
    const muteIcon = document.getElementById('muteIcon');
    const muteText = document.getElementById('muteText');

    if (isAudioMuted) {
        stopAudioAlert();
        if (muteIcon) muteIcon.className = 'fas fa-volume-xmark';
        if (muteText) muteText.textContent = 'Unmute';
    } else {
        if (muteIcon) muteIcon.className = 'fas fa-volume-high';
        if (muteText) muteText.textContent = 'Mute';
        if (isEmergencyActive) startAudioAlert();
    }
}

// ==========================================================================
// SIMULATION TOGGLE (Allows User to Preview Black & Red Emergency Mode)
// ==========================================================================
function toggleEmergencySimulation() {
    const simBtn = document.getElementById('simEmergencyBtn');
    isSimulationActive = !isSimulationActive;

    if (isSimulationActive) {
        if (simBtn) {
            simBtn.classList.add('active');
            simBtn.innerHTML = '<i class="fas fa-stop"></i> <span>Stop Simulation</span>';
        }

        // Push test hazardous sensor levels
        updateGauge('gas', 2450, GAS_MIN, GAS_MAX);
        updateGauge('temp', 42.5, TEMP_MIN, TEMP_MAX);
        updateGauge('humid', 60.0, HUMID_MIN, HUMID_MAX);

        applyEmergencyState({
            active: true,
            gasAbnormal: true,
            tempAbnormal: true,
            humidAbnormal: false,
            gasVal: 2450,
            tempVal: 42.5,
            humidVal: 60.0
        });

    } else {
        if (simBtn) {
            simBtn.classList.remove('active');
            simBtn.innerHTML = '<i class="fas fa-bolt"></i> <span>Test Alert</span>';
        }

        // Return to baseline normal values
        updateGauge('gas', 420, GAS_MIN, GAS_MAX);
        updateGauge('temp', 26.5, TEMP_MIN, TEMP_MAX);
        updateGauge('humid', 54.0, HUMID_MIN, HUMID_MAX);

        applyEmergencyState({
            active: false,
            gasAbnormal: false,
            tempAbnormal: false,
            humidAbnormal: false,
            gasVal: 420,
            tempVal: 26.5,
            humidVal: 54.0
        });
    }
}

// ==========================================================================
// EMAILJS EMERGENCY ALERT DISPATCH
// ==========================================================================
function triggerEmergencyEmailNotification(incidentDetails) {
    const user = auth.currentUser;
    const targetEmail = user && user.email ? user.email : "fafnir007vk@gmail.com";
    const targetName = user && user.displayName ? user.displayName : "Customer";

    const now = Date.now();
    if (now - lastEmailSentTimestamp < EMAIL_COOLDOWN_MS) {
        return; // Respect cooldown during ongoing emergency
    }

    lastEmailSentTimestamp = now;

    const statusEl = document.getElementById('emailDispatchStatus');
    if (statusEl) statusEl.textContent = `Dispatching to ${targetEmail}...`;

    showEmailToast(targetEmail);

    const templateParams = {
        to_email: targetEmail,
        to_name: targetName,
        email: targetEmail,
        recipient_email: targetEmail,
        alert_details: incidentDetails,
        time: new Date().toLocaleString(),
        dashboard_url: "https://air-quality-monitor-delta.vercel.app"
    };

    if (window.emailjs) {
        emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, templateParams)
            .then((response) => {
                console.log("✅ [EMAIL DELIVERED VIA EMAILJS]:", response.status);
                if (statusEl) statusEl.textContent = `Sent to ${targetEmail} (Delivered)`;
            })
            .catch((error) => {
                console.error("❌ [EMAILJS DISPATCH ERROR]:", error);
                if (statusEl) statusEl.textContent = `Delivery failed: ${error.text || error.message}`;
            });
    }

    // System Desktop Notification (if enabled)
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification("AEROMONITOR CRITICAL ALERT", {
                body: `Environmental Hazard: ${incidentDetails}. Evacuate or ventilate immediately.`,
                icon: "https://img.icons8.com/color/96/wind.png"
            });
        } catch (e) {}
    }
}

function showEmailToast(recipientEmail) {
    const toast = document.getElementById('emailToast');
    const emailAddr = document.getElementById('emailToastAddress');
    if (toast && emailAddr) {
        emailAddr.textContent = `Emergency alert dispatched to ${recipientEmail}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 6000);
    }
}

/**
 * Send First-Time Welcome Email to Warm Up Gmail Inbox
 */
function checkAndSendWelcomeEmail(user) {
    if (!user || !user.email) return;

    const storageKey = 'welcome_sent_' + user.uid;
    if (localStorage.getItem(storageKey)) return;

    localStorage.setItem(storageKey, 'true');

    const welcomeParams = {
        to_email: user.email,
        to_name: user.displayName || "Customer",
        email: user.email,
        recipient_email: user.email,
        alert_details: "System successfully linked. Your monitor is actively reporting live sensor telemetry.",
        time: new Date().toLocaleString(),
        dashboard_url: "https://air-quality-monitor-delta.vercel.app"
    };

    if (window.emailjs) {
        emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, welcomeParams)
            .then((res) => console.log("✅ [WELCOME EMAIL DELIVERED]:", res.status))
            .catch((err) => console.warn("Welcome email note:", err));
    }
}

// Request Notification Permission
if ("Notification" in window && Notification.permission === "default") {
    setTimeout(() => {
        Notification.requestPermission().catch(() => {});
    }, 2500);
}

// ==========================================================================
// CHART.JS INITIALIZATION (LIVE STREAMING & HISTORICAL)
// ==========================================================================
function initCharts() {
    // 1. Live Streaming Chart (Rolling 30 Data Points)
    const liveCtx = document.getElementById('liveStreamingChart');
    if (liveCtx && !liveChartInstance) {
        liveChartInstance = new Chart(liveCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Temperature (°C)',
                        data: [],
                        borderColor: '#f97316',
                        backgroundColor: 'rgba(249, 115, 22, 0.08)',
                        borderWidth: 2,
                        tension: 0.35,
                        fill: true,
                        yAxisID: 'yTempHumid',
                        pointRadius: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Humidity (%)',
                        data: [],
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.08)',
                        borderWidth: 2,
                        tension: 0.35,
                        fill: true,
                        yAxisID: 'yTempHumid',
                        pointRadius: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Gas (PPM)',
                        data: [],
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        borderWidth: 2,
                        tension: 0.35,
                        fill: false,
                        yAxisID: 'yGas',
                        pointRadius: 2,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 22, 0.95)',
                        titleColor: '#ffffff',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                        borderWidth: 1,
                        padding: 10,
                        bodyFont: { family: 'JetBrains Mono' }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 0 }
                    },
                    yTempHumid: {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
                    },
                    yGas: {
                        type: 'linear',
                        position: 'right',
                        min: 0,
                        max: 4095,
                        grid: { display: false },
                        ticks: { color: '#10b981', font: { family: 'JetBrains Mono', size: 10 } }
                    }
                }
            }
        });
    }

    // 2. Historical Trend Chart
    const histCtx = document.getElementById('historicalChart');
    if (histCtx && !historicalChartInstance) {
        historicalChartInstance = new Chart(histCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Temperature (°C)',
                        data: [],
                        borderColor: '#f97316',
                        backgroundColor: 'rgba(249, 115, 22, 0.05)',
                        borderWidth: 2,
                        tension: 0.3,
                        fill: true,
                        yAxisID: 'yTempHumid'
                    },
                    {
                        label: 'Humidity (%)',
                        data: [],
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.05)',
                        borderWidth: 2,
                        tension: 0.3,
                        fill: true,
                        yAxisID: 'yTempHumid'
                    },
                    {
                        label: 'Gas (PPM)',
                        data: [],
                        borderColor: '#10b981',
                        borderWidth: 2,
                        tension: 0.3,
                        fill: false,
                        yAxisID: 'yGas'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 600 },
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { family: 'Poppins' } } },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 22, 0.95)',
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                        borderWidth: 1,
                        bodyFont: { family: 'JetBrains Mono' }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }
                    },
                    yTempHumid: {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }
                    },
                    yGas: {
                        type: 'linear',
                        position: 'right',
                        min: 0,
                        max: 4095,
                        grid: { display: false },
                        ticks: { color: '#10b981', font: { family: 'JetBrains Mono', size: 10 } }
                    }
                }
            }
        });
    }
}

/**
 * Push fresh telemetry point into charts and buffer
 */
function recordTelemetryPoint(temp, humid, gas) {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    // Append to continuous buffer
    telemetryBuffer.timestamps.push(timeLabel);
    telemetryBuffer.temp.push(temp);
    telemetryBuffer.humid.push(humid);
    telemetryBuffer.gas.push(gas);

    if (telemetryBuffer.timestamps.length > MAX_HISTORY_POINTS) {
        telemetryBuffer.timestamps.shift();
        telemetryBuffer.temp.shift();
        telemetryBuffer.humid.shift();
        telemetryBuffer.gas.shift();
    }

    // 1. Update Live Streaming Chart (Last 30 Points)
    if (liveChartInstance) {
        const liveLabels = telemetryBuffer.timestamps.slice(-MAX_LIVE_POINTS);
        const liveTemp = telemetryBuffer.temp.slice(-MAX_LIVE_POINTS);
        const liveHumid = telemetryBuffer.humid.slice(-MAX_LIVE_POINTS);
        const liveGas = telemetryBuffer.gas.slice(-MAX_LIVE_POINTS);

        liveChartInstance.data.labels = liveLabels;
        liveChartInstance.data.datasets[0].data = liveTemp;
        liveChartInstance.data.datasets[1].data = liveHumid;
        liveChartInstance.data.datasets[2].data = liveGas;
        liveChartInstance.update('none'); // Update smoothly without lag
    }

    // 2. Update Live Analytics Statistical Cards (Min, Max, Avg, Current)
    updateStatisticalSummary(temp, humid, gas);

    // 3. Update Historical Chart if active
    updateHistoricalChartDisplay();
}

/**
 * Calculate Min, Max, and Average for all sensors
 */
function updateStatisticalSummary(currentTemp, currentHumid, currentGas) {
    const gasArr = telemetryBuffer.gas;
    const tempArr = telemetryBuffer.temp;
    const humidArr = telemetryBuffer.humid;

    if (gasArr.length === 0) return;

    // Calculations
    const minGas = Math.min(...gasArr);
    const maxGas = Math.max(...gasArr);
    const avgGas = Math.round(gasArr.reduce((a, b) => a + b, 0) / gasArr.length);

    const minTemp = Math.min(...tempArr).toFixed(1);
    const maxTemp = Math.max(...tempArr).toFixed(1);
    const avgTemp = (tempArr.reduce((a, b) => a + b, 0) / tempArr.length).toFixed(1);

    const minHumid = Math.min(...humidArr).toFixed(1);
    const maxHumid = Math.max(...humidArr).toFixed(1);
    const avgHumid = (humidArr.reduce((a, b) => a + b, 0) / humidArr.length).toFixed(1);

    // Update DOM
    const statCurrentGas = document.getElementById('statCurrentGas');
    const statMinGas = document.getElementById('statMinGas');
    const statMaxGas = document.getElementById('statMaxGas');
    const statAvgGas = document.getElementById('statAvgGas');

    if (statCurrentGas) statCurrentGas.innerHTML = `${Math.round(currentGas)} <small>PPM</small>`;
    if (statMinGas) statMinGas.textContent = `${minGas} PPM`;
    if (statMaxGas) statMaxGas.textContent = `${maxGas} PPM`;
    if (statAvgGas) statAvgGas.textContent = `${avgGas} PPM`;

    const statCurrentTemp = document.getElementById('statCurrentTemp');
    const statMinTemp = document.getElementById('statMinTemp');
    const statMaxTemp = document.getElementById('statMaxTemp');
    const statAvgTemp = document.getElementById('statAvgTemp');

    if (statCurrentTemp) statCurrentTemp.innerHTML = `${currentTemp.toFixed(1)} <small>°C</small>`;
    if (statMinTemp) statMinTemp.textContent = `${minTemp}°C`;
    if (statMaxTemp) statMaxTemp.textContent = `${maxTemp}°C`;
    if (statAvgTemp) statAvgTemp.textContent = `${avgTemp}°C`;

    const statCurrentHumid = document.getElementById('statCurrentHumid');
    const statMinHumid = document.getElementById('statMinHumid');
    const statMaxHumid = document.getElementById('statMaxHumid');
    const statAvgHumid = document.getElementById('statAvgHumid');

    if (statCurrentHumid) statCurrentHumid.innerHTML = `${currentHumid.toFixed(1)} <small>%</small>`;
    if (statMinHumid) statMinHumid.textContent = `${minHumid}%`;
    if (statMaxHumid) statMaxHumid.textContent = `${maxHumid}%`;
    if (statAvgHumid) statAvgHumid.textContent = `${avgHumid}%`;
}

/**
 * Filter Historical Data by selected Range ('1h', '6h', '24h')
 */
function setHistoryRange(range) {
    currentHistoryFilter = range;

    // Update filter pill UI buttons
    const filterPills = document.querySelectorAll('.time-filter-group .filter-pill');
    filterPills.forEach(btn => {
        if (btn.textContent.toLowerCase().includes(range)) {
            btn.classList.add('active');
        } else if (!btn.textContent.toLowerCase().includes('clear')) {
            btn.classList.remove('active');
        }
    });

    const label = document.getElementById('historyRangeLabel');
    if (label) {
        if (range === '1h') label.textContent = 'Showing Last 1 Hour Window';
        else if (range === '6h') label.textContent = 'Showing Last 6 Hours Window';
        else label.textContent = 'Showing Full 24 Hours Archive';
    }

    updateHistoricalChartDisplay();
}

function updateHistoricalChartDisplay() {
    if (!historicalChartInstance) return;

    let pointsToShow = 60; // Default: ~60 points (~3 mins to 1 hour depending on frequency)
    if (currentHistoryFilter === '6h') pointsToShow = 200;
    if (currentHistoryFilter === '24h') pointsToShow = MAX_HISTORY_POINTS;

    historicalChartInstance.data.labels = telemetryBuffer.timestamps.slice(-pointsToShow);
    historicalChartInstance.data.datasets[0].data = telemetryBuffer.temp.slice(-pointsToShow);
    historicalChartInstance.data.datasets[1].data = telemetryBuffer.humid.slice(-pointsToShow);
    historicalChartInstance.data.datasets[2].data = telemetryBuffer.gas.slice(-pointsToShow);
    historicalChartInstance.update();
}

function clearHistoryLog() {
    telemetryBuffer.timestamps = [];
    telemetryBuffer.gas = [];
    telemetryBuffer.temp = [];
    telemetryBuffer.humid = [];
    incidentLedger = [];
    emergencyIncidentCount = 0;

    const statCount = document.getElementById('statEmergencyCount');
    if (statCount) statCount.innerHTML = `Incidents Today: <b>0</b>`;

    const logTbody = document.getElementById('incidentLogTbody');
    if (logTbody) {
        logTbody.innerHTML = `
            <tr class="log-empty-row">
                <td colspan="7">No emergency incidents registered. System operating within safe baseline parameters.</td>
            </tr>
        `;
    }

    const logCounter = document.getElementById('logRecordCount');
    if (logCounter) logCounter.textContent = '0 Records Recorded';

    if (liveChartInstance) {
        liveChartInstance.data.labels = [];
        liveChartInstance.data.datasets.forEach(d => d.data = []);
        liveChartInstance.update();
    }

    if (historicalChartInstance) {
        historicalChartInstance.data.labels = [];
        historicalChartInstance.data.datasets.forEach(d => d.data = []);
        historicalChartInstance.update();
    }
}

// ==========================================================================
// INCIDENT AUDIT LEDGER (TAB 3 DATA TABLE)
// ==========================================================================
function recordIncidentEvent(eventType, detailMsg, gas, temp, humid) {
    emergencyIncidentCount++;
    const statCount = document.getElementById('statEmergencyCount');
    if (statCount) statCount.innerHTML = `Incidents Today: <b>${emergencyIncidentCount}</b>`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    const user = auth.currentUser;
    const recipient = user && user.email ? user.email : "Customer";

    const record = {
        time: timeStr,
        event: eventType,
        gas: Math.round(gas),
        temp: temp.toFixed(1),
        humid: humid.toFixed(1),
        battery: document.getElementById('batteryValue') ? document.getElementById('batteryValue').textContent : '92%',
        action: `Email alert dispatched to ${recipient}`
    };

    incidentLedger.unshift(record);
    if (incidentLedger.length > 50) incidentLedger.pop();

    renderIncidentTable();
}

function renderIncidentTable() {
    const tbody = document.getElementById('incidentLogTbody');
    const counter = document.getElementById('logRecordCount');
    if (!tbody) return;

    if (incidentLedger.length === 0) {
        tbody.innerHTML = `
            <tr class="log-empty-row">
                <td colspan="7">No emergency incidents registered. System operating within safe baseline parameters.</td>
            </tr>
        `;
        if (counter) counter.textContent = '0 Records Recorded';
        return;
    }

    let rowsHtml = '';
    incidentLedger.forEach(row => {
        rowsHtml += `
            <tr>
                <td class="font-mono">${row.time}</td>
                <td><span class="log-badge danger">${row.event}</span></td>
                <td class="font-mono"><b>${row.gas} PPM</b></td>
                <td class="font-mono">${row.temp}°C</td>
                <td class="font-mono">${row.humid}%</td>
                <td class="font-mono">${row.battery}</td>
                <td><small style="color: var(--text-silver);">${row.action}</small></td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
    if (counter) counter.textContent = `${incidentLedger.length} Records Recorded`;
}

// ==========================================================================
// FOUR-TAB DASHBOARD NAVIGATION SWITCHER
// ==========================================================================
function switchDashboardTab(tabName) {
    const tabDashboardBtn = document.getElementById('tabDashboardBtn');
    const tabLiveStatsBtn = document.getElementById('tabLiveStatsBtn');
    const tabHistoryBtn = document.getElementById('tabHistoryBtn');
    const tabInstructionsBtn = document.getElementById('tabInstructionsBtn');

    const viewDashboard = document.getElementById('viewDashboard');
    const viewLiveStats = document.getElementById('viewLiveStats');
    const viewHistory = document.getElementById('viewHistory');
    const viewInstructions = document.getElementById('viewInstructions');

    // Remove active class from all buttons
    [tabDashboardBtn, tabLiveStatsBtn, tabHistoryBtn, tabInstructionsBtn].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });

    // Hide all view panes
    [viewDashboard, viewLiveStats, viewHistory, viewInstructions].forEach(pane => {
        if (pane) pane.style.display = 'none';
    });

    // Activate selected tab
    if (tabName === 'dashboard') {
        if (tabDashboardBtn) tabDashboardBtn.classList.add('active');
        if (viewDashboard) viewDashboard.style.display = 'block';
    } else if (tabName === 'liveStats') {
        if (tabLiveStatsBtn) tabLiveStatsBtn.classList.add('active');
        if (viewLiveStats) {
            viewLiveStats.style.display = 'block';
            if (liveChartInstance) {
                liveChartInstance.resize();
                liveChartInstance.update();
            }
        }
    } else if (tabName === 'history') {
        if (tabHistoryBtn) tabHistoryBtn.classList.add('active');
        if (viewHistory) {
            viewHistory.style.display = 'block';
            if (historicalChartInstance) {
                historicalChartInstance.resize();
                updateHistoricalChartDisplay();
            }
        }
    } else if (tabName === 'instructions') {
        if (tabInstructionsBtn) tabInstructionsBtn.classList.add('active');
        if (viewInstructions) viewInstructions.style.display = 'block';
    }

    // Auto-scroll active tab into center view on mobile tab bar
    const activeBtn = tabName === 'dashboard' ? tabDashboardBtn :
                     tabName === 'liveStats' ? tabLiveStatsBtn :
                     tabName === 'history' ? tabHistoryBtn :
                     tabName === 'instructions' ? tabInstructionsBtn : null;

    if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

// ==========================================================================
// ==========================================================================
// FIREBASE REALTIME DATABASE LISTENER & HARDWARE HEARTBEAT WATCHDOG
// ==========================================================================
const sensorRef = database.ref('sensor_data');
const HEARTBEAT_TIMEOUT_MS = 8000; // 8 seconds (ESP32 transmits every 3s)
let heartbeatWatchdogTimer = null;
let initialStreamCheckTimer = null;
let initialSnapshotHandled = false;

function processTelemetryPayload(data) {
    const temp = data.temperature !== undefined ? Number(data.temperature) : 25.0;
    const humid = data.humidity !== undefined ? Number(data.humidity) : 50.0;
    const gas = data.gas !== undefined ? Number(data.gas) : 400;

    // 1. Update Speedometer Gauges
    updateGauge('temp', temp, TEMP_MIN, TEMP_MAX);
    updateGauge('humid', humid, HUMID_MIN, HUMID_MAX);
    updateGauge('gas', gas, GAS_MIN, GAS_MAX);

    // 2. Evaluate Emergency Hazard Thresholds
    evaluateEmergencyConditions(temp, humid, gas);

    // 3. Update Li-ion Battery
    if (data.battery !== undefined) {
        updateBattery(data.battery);
    }

    // 4. Record Telemetry in Waveform Charts & Stats
    recordTelemetryPoint(temp, humid, gas);

    // 5. Update Timestamp
    updateTimestamp();
}

sensorRef.on('value', (snapshot) => {
    const data = snapshot.val();

    if (!data) {
        setConnectionStatus(false, 'No sensor data found in database.');
        return;
    }

    // CASE A: Payload contains server timestamp (e.g. data.last_seen)
    if (data.last_seen) {
        const timeSinceLastPacket = Date.now() - Number(data.last_seen);
        if (timeSinceLastPacket > HEARTBEAT_TIMEOUT_MS) {
            // Last packet was received more than 8 seconds ago -> Device is OFF!
            console.log(`[WATCHDOG] ESP32 is offline. Last seen ${Math.round(timeSinceLastPacket / 1000)}s ago.`);
            setConnectionStatus(false, 'ESP32 device is offline / powered off. Showing last recorded state.');
            processTelemetryPayload(data);
            return;
        } else {
            // Live active stream
            clearTimeout(heartbeatWatchdogTimer);
            setConnectionStatus(true);
            processTelemetryPayload(data);

            heartbeatWatchdogTimer = setTimeout(() => {
                console.warn("[WATCHDOG] ESP32 telemetry stopped for 8s. Marking device offline.");
                setConnectionStatus(false, 'ESP32 device powered off or disconnected.');
            }, HEARTBEAT_TIMEOUT_MS);
            return;
        }
    }

    // CASE B: Fallback heartbeat verification (works even if firmware doesn't write last_seen)
    if (!initialSnapshotHandled) {
        initialSnapshotHandled = true;

        // Render last known readings onto gauges immediately
        processTelemetryPayload(data);

        // Start in offline/verifying state so we don't falsely claim a dead device is active
        setConnectionStatus(false, 'Verifying live device stream...');

        // ESP32 sends every 3s. If it is genuinely alive, a new live packet will arrive within 4.5s.
        initialStreamCheckTimer = setTimeout(() => {
            console.log("[WATCHDOG] No incoming live stream detected on startup. ESP32 is OFF.");
            setConnectionStatus(false, 'ESP32 device is offline / powered off. Showing last recorded state.');
        }, 4500);
    } else {
        // Subsequent live packet arrived! Device is definitely ON and transmitting!
        clearTimeout(initialStreamCheckTimer);
        clearTimeout(heartbeatWatchdogTimer);

        setConnectionStatus(true);
        processTelemetryPayload(data);

        // Re-arm 8-second watchdog: if user powers off ESP32, mark offline in 8 seconds
        heartbeatWatchdogTimer = setTimeout(() => {
            console.warn("[WATCHDOG] ESP32 telemetry stopped for 8s. Marking device offline.");
            setConnectionStatus(false, 'ESP32 device powered off or disconnected.');
        }, HEARTBEAT_TIMEOUT_MS);
    }
});

// Firebase Connection Status Watchdog
const connectedRef = database.ref('.info/connected');
connectedRef.on('value', (snap) => {
    if (snap.val() === true) {
        console.log("Connected to Firebase Realtime Database cloud");
    } else {
        if (!isSimulationActive) {
            setConnectionStatus(false, 'Network connection to cloud lost.');
        }
    }
});

// Initialize Chart.js when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
});