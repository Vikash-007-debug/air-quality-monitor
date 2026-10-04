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
let alertAudio = null;
let fallbackAudioContext = null;
let fallbackSirenInterval = null;
let fallbackMasterGain = null;
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
const MAX_HISTORY_POINTS = 2880; // Retains up to 24 hours of telemetry archive

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

/**
 * Fully reset and purge the emergency state, audio sirens, strobe classes, and reset UI to safe baseline
 */
function resetEmergencyState() {
    isEmergencyActive = false;
    stopAudioAlert();

    const body = document.getElementById('dashboardBody');
    if (body) body.classList.remove('emergency-mode');

    ['gasCard', 'tempCard', 'humidCard'].forEach(id => {
        const card = document.getElementById(id);
        if (card) card.classList.remove('emergency-blink', 'emergency-card');
    });

    const tempAlert = document.getElementById('tempAlertIndicator');
    const humidAlert = document.getElementById('humidAlertIndicator');
    const gasAlert = document.getElementById('gasAlertIndicator');
    if (tempAlert) tempAlert.classList.remove('active');
    if (humidAlert) humidAlert.classList.remove('active');
    if (gasAlert) gasAlert.classList.remove('active');

    const dispatchIcon = document.getElementById('dispatchIconBox');
    if (dispatchIcon) dispatchIcon.classList.remove('active-alert');

    const emailStatus = document.getElementById('emailDispatchStatus');
    if (emailStatus && (emailStatus.textContent.includes('Dispatched') || emailStatus.textContent.includes('Dispatching'))) {
        emailStatus.textContent = 'Ready & Listening';
    }

    const safetyStateEl = document.getElementById('statSafetyState');
    if (safetyStateEl) {
        safetyStateEl.textContent = 'OPTIMAL';
        safetyStateEl.style.color = '#10b981';
    }

    const banner = document.getElementById('statusBanner');
    const bannerMsg = document.getElementById('statusMessage');
    const bannerHeadline = document.getElementById('bannerHeadline');
    const bannerIcon = document.getElementById('bannerIcon');
    if (banner && bannerMsg) {
        if (isDeviceOnline) {
            banner.className = 'status-banner success';
            if (bannerHeadline) bannerHeadline.textContent = 'Telemetry Stream Active';
            if (bannerIcon) bannerIcon.className = 'fas fa-circle-check';
            bannerMsg.textContent = 'ESP32 is connected and actively streaming live sensor data.';
        } else {
            banner.className = 'status-banner warning';
            if (bannerHeadline) bannerHeadline.textContent = 'Device Offline';
            if (bannerIcon) bannerIcon.className = 'fas fa-power-off';
            bannerMsg.textContent = 'ESP32 is powered off or disconnected. Gauges zeroed until device reconnects.';
        }
    }
}

/**
 * Reset all speedometer gauges, values boxes, and status badges to ZERO when ESP32 is offline
 */
function resetGaugesToZero() {
    // If user is actively running the Test Alert simulation, do NOT reset gauges or cancel emergency mode!
    if (isSimulationActive) return;

    // 1. Reset Needle Positions to 0 (-90deg calibration)
    const tempNeedle = document.getElementById('tempNeedle');
    const humidNeedle = document.getElementById('humidNeedle');
    const gasNeedle = document.getElementById('gasNeedle');
    if (tempNeedle) tempNeedle.style.transform = 'rotate(-90deg)';
    if (humidNeedle) humidNeedle.style.transform = 'rotate(-90deg)';
    if (gasNeedle) gasNeedle.style.transform = 'rotate(-90deg)';

    // 2. Reset Filled Arcs to 0 (strokeDashoffset = ARC_LENGTH means empty arc)
    const tempFill = document.getElementById('tempFill');
    const humidFill = document.getElementById('humidFill');
    const gasFill = document.getElementById('gasFill');
    if (tempFill) {
        tempFill.style.strokeDashoffset = ARC_LENGTH;
        tempFill.style.stroke = '#475569';
    }
    if (humidFill) {
        humidFill.style.strokeDashoffset = ARC_LENGTH;
        humidFill.style.stroke = '#475569';
    }
    if (gasFill) {
        gasFill.style.strokeDashoffset = ARC_LENGTH;
        gasFill.style.stroke = '#475569';
    }

    // 3. Reset Speedometer Values Box to ZERO
    const tempVal = document.getElementById('tempValue');
    const humidVal = document.getElementById('humidValue');
    const gasVal = document.getElementById('gasValue');
    if (tempVal) tempVal.textContent = '0.0';
    if (humidVal) humidVal.textContent = '0.0';
    if (gasVal) gasVal.textContent = '0';

    // 4. Update Status Badges to indicate offline at zero
    const tempStatus = document.getElementById('tempStatus');
    const humidStatus = document.getElementById('humidStatus');
    const gasStatus = document.getElementById('gasStatus');
    if (tempStatus) {
        tempStatus.textContent = 'Offline (0.0°C)';
        tempStatus.className = 'gauge-status';
    }
    if (humidStatus) {
        humidStatus.textContent = 'Offline (0.0%)';
        humidStatus.className = 'gauge-status';
    }
    if (gasStatus) {
        gasStatus.textContent = 'Offline (0 PPM)';
        gasStatus.className = 'gauge-status';
    }

    // 5. Reset Alert Indicators and Hazard Highlights
    const tempAlert = document.getElementById('tempAlertIndicator');
    const humidAlert = document.getElementById('humidAlertIndicator');
    const gasAlert = document.getElementById('gasAlertIndicator');
    if (tempAlert) tempAlert.classList.remove('active');
    if (humidAlert) humidAlert.classList.remove('active');
    if (gasAlert) gasAlert.classList.remove('active');

    ['tempCard', 'humidCard', 'gasCard'].forEach(cardId => {
        const card = document.getElementById(cardId);
        if (card) {
            card.classList.remove('emergency-blink', 'emergency-card');
        }
    });

    // 6. Reset Emergency State if active
    if (isEmergencyActive) {
        resetEmergencyState();
    }

    // 7. Reset Battery Diagnostics to 0
    const batteryVal = document.getElementById('batteryValue');
    const batteryVolt = document.getElementById('batteryVoltage');
    const batteryBar = document.getElementById('batteryBar');
    const batteryIcon = document.getElementById('batteryIcon');
    if (batteryVal) batteryVal.textContent = '0%';
    if (batteryVolt) batteryVolt.textContent = '0.00V';
    if (batteryBar) {
        batteryBar.style.width = '0%';
        batteryBar.style.background = '#475569';
    }
    if (batteryIcon) batteryIcon.className = 'fas fa-battery-empty';

    // 8. Reset Live Stat Cards (Tab 2) current values to zero
    const statGas = document.getElementById('statCurrentGas');
    const statTemp = document.getElementById('statCurrentTemp');
    const statHumid = document.getElementById('statCurrentHumid');
    if (statGas) statGas.innerHTML = `0 <small>PPM</small>`;
    if (statTemp) statTemp.innerHTML = `0.0 <small>°C</small>`;
    if (statHumid) statHumid.innerHTML = `0.0 <small>%</small>`;

    if (telemetryBuffer.timestamps.length === 0) {
        ['Gas', 'Temp', 'Humid'].forEach(s => {
            const minEl = document.getElementById(`statMin${s}`);
            const maxEl = document.getElementById(`statMax${s}`);
            const avgEl = document.getElementById(`statAvg${s}`);
            if (minEl) minEl.textContent = '--';
            if (maxEl) maxEl.textContent = '--';
            if (avgEl) avgEl.textContent = '--';
        });
        const label = document.getElementById('historyRangeLabel');
        if (label) label.textContent = 'Device Offline — No Telemetry Logged';
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
                bannerMsg.textContent = customMsg || 'ESP32 is powered off or disconnected. Gauges zeroed until device reconnects.';
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

let lastTransmissionTimestamp = null;

/**
 * Format and display last transmission time clearly (Today, Yesterday, or exact date/time)
 */
function displayLastTransmission(ts) {
    const el = document.getElementById('lastUpdated');
    if (!el || !ts) return;

    let timeNum = Number(ts);
    let date = null;
    if (!isNaN(timeNum) && timeNum > 1000000000) {
        date = new Date(timeNum);
    } else if (typeof ts === 'string') {
        date = new Date(ts);
    }

    if (!date || isNaN(date.getTime())) {
        el.textContent = String(ts);
        return;
    }

    lastTransmissionTimestamp = date.getTime();

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    if (isToday) {
        el.textContent = `Today, ${timeStr}`;
    } else if (isYesterday) {
        el.textContent = `Yesterday, ${timeStr}`;
    } else {
        const dateStr = date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        el.textContent = `${dateStr}, ${timeStr}`;
    }
}

function updateTimestamp() {
    const now = Date.now();
    displayLastTransmission(now);
    try {
        localStorage.setItem('aero_last_transmission', String(now));
        const user = auth.currentUser;
        if (user && user.uid) {
            localStorage.setItem(`aero_last_transmission_${user.uid}`, String(now));
            database.ref(`users/${user.uid}/last_transmission`).set(now).catch(() => {});
        }
    } catch (e) {}
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
    const bannerHeadline = document.getElementById('bannerHeadline');
    const bannerIcon = document.getElementById('bannerIcon');
    const safetyStateEl = document.getElementById('statSafetyState');

    const wasAlreadyEmergency = isEmergencyActive;

    if (state.active) {
        isEmergencyActive = true;
        if (body) body.classList.add('emergency-mode');

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
            if (bannerHeadline) bannerHeadline.textContent = 'Hazard Alert Active';
            if (bannerIcon) bannerIcon.className = 'fas fa-triangle-exclamation';
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

        // Dispatch Real Email Alert and record Audit Event on initial emergency transition
        if (!wasAlreadyEmergency) {
            triggerEmergencyEmailNotification(reasons.join(', '));
            const eventType = isSimulationActive ? "SIMULATION TEST" : "EMERGENCY BREACH";
            recordIncidentEvent(eventType, reasons.join(', '), state.gasVal, state.tempVal, state.humidVal);
        }

    } else {
        resetEmergencyState();
    }
}

// ==========================================================================
// ==========================================================================
// EMERGENCY AUDIO ALARM & MUTE TOGGLE (Synchronized with alert.mp3)
// Exact measured loop period: 2.0049s (4 repeats in 8.0196s file)
// Triple beep envelope peaks at: +0.32s, +0.40s, +0.48s
// ==========================================================================
const ALERT_CYCLE_SECONDS = 2.0049;
let alertAudioBound = false;

function getAlertAudio() {
    if (!alertAudio) {
        const domAudio = document.getElementById('emergencyAudio');
        if (domAudio) {
            alertAudio = domAudio;
        } else {
            alertAudio = new Audio('audio/alert.mp3');
        }
        alertAudio.loop = true;
    }
    if (!alertAudioBound && alertAudio) {
        alertAudioBound = true;
        const handleSync = () => {
            if (isEmergencyActive) {
                syncEmergencyAnimationPhase(alertAudio);
            }
        };
        alertAudio.addEventListener('playing', handleSync);
        alertAudio.addEventListener('timeupdate', handleSync);
        alertAudio.addEventListener('seeked', handleSync);
    }
    return alertAudio;
}

function syncEmergencyAnimationPhase(audioEl) {
    if (!audioEl) return;
    const curTime = audioEl.currentTime || 0;
    // Calculate negative offset so CSS animation phase matches audio.currentTime exactly
    const phaseOffset = -(curTime % ALERT_CYCLE_SECONDS);
    document.documentElement.style.setProperty('--alert-phase-offset', `${phaseOffset.toFixed(3)}s`);
}

function startAudioAlert() {
    if (isAudioMuted) return;

    try {
        const audio = getAlertAudio();
        if (audio) {
            audio.loop = true;
            audio.muted = false;

            // If audio is paused or just starting, rewind to 0 to align with initial visual flash
            if (audio.paused || audio.currentTime === 0 || audio.ended) {
                audio.currentTime = 0;
                document.documentElement.style.setProperty('--alert-phase-offset', '0s');
            }

            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    stopFallbackWebAudioSiren();
                    syncEmergencyAnimationPhase(audio);
                }).catch(err => {
                    console.warn("Audio autoplay blocked by browser policy, using fallback siren:", err);
                    playFallbackWebAudioSiren();
                });
            }
        } else {
            playFallbackWebAudioSiren();
        }
    } catch (e) {
        console.warn("Audio alert start warning:", e);
        playFallbackWebAudioSiren();
    }
}

function stopAudioAlert() {
    try {
        const audio = getAlertAudio();
        if (audio) {
            audio.pause();
            audio.currentTime = 0; // Rewind cleanly to beginning
        }
    } catch (e) {
        // ignore
    }
    document.documentElement.style.setProperty('--alert-phase-offset', '0s');
    stopFallbackWebAudioSiren();
}

function toggleMuteAudio() {
    isAudioMuted = !isAudioMuted;
    const muteIcon = document.getElementById('muteIcon');
    const muteText = document.getElementById('muteText');
    const audio = getAlertAudio();

    if (audio) {
        audio.muted = isAudioMuted;
    }

    if (isAudioMuted) {
        if (audio) {
            audio.pause();
        }
        stopFallbackWebAudioSiren();
        if (muteIcon) muteIcon.className = 'fas fa-volume-xmark';
        if (muteText) muteText.textContent = 'Unmute';
    } else {
        if (muteIcon) muteIcon.className = 'fas fa-volume-high';
        if (muteText) muteText.textContent = 'Mute';
        if (isEmergencyActive) {
            startAudioAlert();
        }
    }
}

function playFallbackWebAudioSiren() {
    if (isAudioMuted || fallbackSirenInterval) return;

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!fallbackAudioContext) fallbackAudioContext = new AudioContext();

        if (fallbackAudioContext.state === 'suspended') {
            fallbackAudioContext.resume().catch(() => {});
        }

        if (!fallbackMasterGain) {
            fallbackMasterGain = fallbackAudioContext.createGain();
            fallbackMasterGain.connect(fallbackAudioContext.destination);
        }
        fallbackMasterGain.gain.setValueAtTime(0.25, fallbackAudioContext.currentTime);

        function playTripleBeep() {
            if (isAudioMuted || !isEmergencyActive) return;
            if (fallbackAudioContext && fallbackAudioContext.state === 'suspended') {
                fallbackAudioContext.resume().catch(() => {});
            }

            const now = fallbackAudioContext.currentTime;
            // 3 synchronized beeps matching alert.mp3 at +0.32s, +0.40s, +0.48s with ~1300Hz tone
            const beepOffsets = [0.32, 0.40, 0.48];
            beepOffsets.forEach(offset => {
                const osc = fallbackAudioContext.createOscillator();
                const gain = fallbackAudioContext.createGain();

                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(1300, now + offset);
                osc.frequency.exponentialRampToValueAtTime(1200, now + offset + 0.06);

                gain.gain.setValueAtTime(0.001, now + offset);
                gain.gain.linearRampToValueAtTime(0.22, now + offset + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.065);

                osc.connect(gain);
                gain.connect(fallbackMasterGain);

                osc.start(now + offset);
                osc.stop(now + offset + 0.07);
            });
        }

        playTripleBeep();
        fallbackSirenInterval = setInterval(playTripleBeep, 2005);
    } catch (e) {
        console.warn("Audio Context init note:", e);
    }
}

function stopFallbackWebAudioSiren() {
    if (fallbackSirenInterval) {
        clearInterval(fallbackSirenInterval);
        fallbackSirenInterval = null;
    }
    if (fallbackMasterGain && fallbackAudioContext) {
        try {
            fallbackMasterGain.gain.setValueAtTime(0, fallbackAudioContext.currentTime);
        } catch (e) {
            // ignore
        }
    }
}

// User-interaction listener to unlock audio element immediately
function unlockEmergencyAudio() {
    const audio = getAlertAudio();
    if (audio) {
        audio.load();
    }
    window.removeEventListener('click', unlockEmergencyAudio);
    window.removeEventListener('keydown', unlockEmergencyAudio);
    window.removeEventListener('touchstart', unlockEmergencyAudio);
}
window.addEventListener('click', unlockEmergencyAudio, { once: true });
window.addEventListener('keydown', unlockEmergencyAudio, { once: true });
window.addEventListener('touchstart', unlockEmergencyAudio, { once: true });

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

        applyEmergencyState({
            active: true,
            gasAbnormal: true,
            tempAbnormal: true,
            humidAbnormal: false,
            gasVal: 2450,
            tempVal: 42.5,
            humidVal: 60.0
        });

        // Push test hazardous sensor levels to gauges
        updateGauge('gas', 2450, GAS_MIN, GAS_MAX);
        updateGauge('temp', 42.5, TEMP_MIN, TEMP_MAX);
        updateGauge('humid', 60.0, HUMID_MIN, HUMID_MAX);

    } else {
        if (simBtn) {
            simBtn.classList.remove('active');
            simBtn.innerHTML = '<i class="fas fa-bolt"></i> <span>Test Alert</span>';
        }

        // Instantly shut off siren and purge emergency red theme
        resetEmergencyState();

        // If ESP32 is online, resume live telemetry; otherwise zero all gauges
        if (isDeviceOnline && lastLivePayload) {
            processTelemetryPayload(lastLivePayload);
        } else {
            resetGaugesToZero();
        }
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

    // Update historical chart display with current session buffer (empty until ESP32 connects)
    updateHistoricalChartDisplay();
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

    // 4. Persist updated telemetry buffer for logged-in user
    persistTelemetryBuffer();
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

    // Update filter pill UI buttons with exact matching
    const filterPills = document.querySelectorAll('.time-filter-group .filter-pill');
    filterPills.forEach(btn => {
        const btnRange = btn.getAttribute('data-range');
        const text = btn.textContent.toLowerCase();
        
        const isMatch = (btnRange === range) ||
                        (range === '1h' && (text.includes('1 hour') || text.includes('1h'))) ||
                        (range === '6h' && (text.includes('6 hour') || text.includes('6h'))) ||
                        (range === '24h' && (text.includes('24 hour') || text.includes('24h')));

        if (isMatch) {
            btn.classList.add('active');
        } else if (!text.includes('clear')) {
            btn.classList.remove('active');
        }
    });

    if (historicalChartInstance) {
        historicalChartInstance.resize();
    }
    updateHistoricalChartDisplay();
}

function updateHistoricalChartDisplay() {
    if (!historicalChartInstance) return;

    const totalPts = telemetryBuffer.timestamps.length;
    let pointsToShow = 60; // 1 hour default
    if (currentHistoryFilter === '6h') pointsToShow = 360;
    if (currentHistoryFilter === '24h') pointsToShow = MAX_HISTORY_POINTS;

    const displayedPts = Math.min(pointsToShow, totalPts);

    historicalChartInstance.data.labels = telemetryBuffer.timestamps.slice(-pointsToShow);
    historicalChartInstance.data.datasets[0].data = telemetryBuffer.temp.slice(-pointsToShow);
    historicalChartInstance.data.datasets[1].data = telemetryBuffer.humid.slice(-pointsToShow);
    historicalChartInstance.data.datasets[2].data = telemetryBuffer.gas.slice(-pointsToShow);
    historicalChartInstance.update();

    const label = document.getElementById('historyRangeLabel');
    if (label) {
        if (totalPts === 0) {
            label.textContent = isDeviceOnline ? 'Waiting for incoming telemetry stream...' : 'Device Offline — No Telemetry Logged';
        } else {
            if (currentHistoryFilter === '1h') {
                label.textContent = `Showing Last 1 Hour Window (${displayedPts} pts)`;
            } else if (currentHistoryFilter === '6h') {
                label.textContent = `Showing Last 6 Hours Window (${displayedPts} pts)`;
            } else {
                label.textContent = `Showing Full 24 Hours Archive (${displayedPts} pts)`;
            }
        }
    }
}

function clearHistoryLog() {
    if (!confirm("Are you sure you want to clear your local history and incident logs? This will reset the current session history.")) {
        return;
    }
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

    const label = document.getElementById('historyRangeLabel');
    if (label) {
        label.textContent = isDeviceOnline ? 'Waiting for incoming telemetry stream...' : 'Device Offline — No Telemetry Logged';
    }

    ['Gas', 'Temp', 'Humid'].forEach(s => {
        const minEl = document.getElementById(`statMin${s}`);
        const maxEl = document.getElementById(`statMax${s}`);
        const avgEl = document.getElementById(`statAvg${s}`);
        if (minEl) minEl.textContent = '--';
        if (maxEl) maxEl.textContent = '--';
        if (avgEl) avgEl.textContent = '--';
    });

    // Wipe persisted storage for the logged-in user so clear persists across reloads
    const user = auth.currentUser;
    if (user && user.uid) {
        try {
            localStorage.removeItem(`aero_telemetry_${user.uid}`);
            localStorage.removeItem(`aero_incidents_${user.uid}`);
            localStorage.removeItem(`aero_incident_count_${user.uid}`);
        } catch (e) {}
        database.ref(`users/${user.uid}/telemetry_history`).remove().catch(() => {});
        database.ref(`users/${user.uid}/incident_ledger`).remove().catch(() => {});
        database.ref(`users/${user.uid}/incident_count`).remove().catch(() => {});
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
        action: eventType === 'SIMULATION TEST' ? `Simulation test alert triggered for ${recipient}` : `Email alert dispatched to ${recipient}`
    };

    incidentLedger.unshift(record);
    if (incidentLedger.length > 50) incidentLedger.pop();

    renderIncidentTable();

    // Persist incident audit ledger for logged-in user
    persistIncidentLedger();
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
        const badgeClass = row.event === 'SIMULATION TEST' ? 'log-badge warning' : 'log-badge danger';
        rowsHtml += `
            <tr>
                <td class="font-mono">${row.time}</td>
                <td><span class="${badgeClass}">${row.event}</span></td>
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
// USER TELEMETRY & ALERT HISTORY PERSISTENCE (LocalStorage + Firebase Cloud)
// Ensures history graph and audit ledger persist across tab reloads & logins
// ==========================================================================
let firebaseTelemetrySyncTimer = null;

/**
 * Utility to convert Firebase array or object-with-indices to a clean Array
 */
function sanitizeArray(arrOrObj) {
    if (!arrOrObj) return [];
    if (Array.isArray(arrOrObj)) return arrOrObj;
    if (typeof arrOrObj === 'object') return Object.values(arrOrObj);
    return [];
}

/**
 * Save telemetry buffer to localStorage immediately and debounce sync to Firebase Realtime Database
 */
function persistTelemetryBuffer() {
    const user = auth.currentUser;
    if (!user || !user.uid) return;

    try {
        localStorage.setItem(`aero_telemetry_${user.uid}`, JSON.stringify(telemetryBuffer));
    } catch (e) {
        console.warn("Storage quota note:", e);
    }

    // Debounce cloud write to Firebase Realtime Database (sync every 3 seconds)
    if (!firebaseTelemetrySyncTimer) {
        firebaseTelemetrySyncTimer = setTimeout(() => {
            firebaseTelemetrySyncTimer = null;
            const currentUser = auth.currentUser;
            if (currentUser && currentUser.uid === user.uid) {
                database.ref(`users/${user.uid}/telemetry_history`).set(telemetryBuffer).catch(err => {
                    console.warn("Firebase telemetry sync note:", err);
                });
                database.ref('telemetry_history').set(telemetryBuffer).catch(() => {});
            }
        }, 3000);
    }
}

/**
 * Save incident ledger and emergency count to localStorage and Firebase Realtime Database
 */
function persistIncidentLedger() {
    const user = auth.currentUser;
    if (!user || !user.uid) return;

    try {
        localStorage.setItem(`aero_incidents_${user.uid}`, JSON.stringify(incidentLedger));
        localStorage.setItem(`aero_incident_count_${user.uid}`, String(emergencyIncidentCount));
    } catch (e) {
        console.warn("Storage quota note:", e);
    }

    database.ref(`users/${user.uid}/incident_ledger`).set(incidentLedger).catch(err => {
        console.warn("Firebase incident sync note:", err);
    });
    database.ref(`users/${user.uid}/incident_count`).set(emergencyIncidentCount).catch(err => {
        console.warn("Firebase incident count sync note:", err);
    });
}

/**
 * Immediate synchronous flush of all user data to cloud before signing out or unloading
 */
window.flushAllTelemetryToCloud = async function() {
    if (firebaseTelemetrySyncTimer) {
        clearTimeout(firebaseTelemetrySyncTimer);
        firebaseTelemetrySyncTimer = null;
    }
    const user = auth.currentUser;
    if (!user || !user.uid) return;

    try {
        if (telemetryBuffer.timestamps.length > 0) {
            localStorage.setItem(`aero_telemetry_${user.uid}`, JSON.stringify(telemetryBuffer));
        }
        localStorage.setItem(`aero_incidents_${user.uid}`, JSON.stringify(incidentLedger));
        localStorage.setItem(`aero_incident_count_${user.uid}`, String(emergencyIncidentCount));
        if (lastTransmissionTimestamp) {
            localStorage.setItem(`aero_last_transmission_${user.uid}`, String(lastTransmissionTimestamp));
        }
    } catch (e) {}

    const writes = [];
    if (telemetryBuffer.timestamps.length > 0) {
        writes.push(database.ref(`users/${user.uid}/telemetry_history`).set(telemetryBuffer).catch(() => {}));
        writes.push(database.ref('telemetry_history').set(telemetryBuffer).catch(() => {}));
    }
    if (incidentLedger.length > 0) {
        writes.push(database.ref(`users/${user.uid}/incident_ledger`).set(incidentLedger).catch(() => {}));
    }
    writes.push(database.ref(`users/${user.uid}/incident_count`).set(emergencyIncidentCount).catch(() => {}));
    if (lastTransmissionTimestamp) {
        writes.push(database.ref(`users/${user.uid}/last_transmission`).set(lastTransmissionTimestamp).catch(() => {}));
    }
    await Promise.all(writes);
};

/**
 * Load and restore persisted telemetry history, incident ledger, and last transmission
 */
function loadUserPersistedHistory(user) {
    if (!user || !user.uid) return;
    const uid = user.uid;

    // 1. Immediate restore from localStorage for instant, zero-latency tab reload
    try {
        const cachedTelemetry = localStorage.getItem(`aero_telemetry_${uid}`);
        if (cachedTelemetry) {
            const parsed = JSON.parse(cachedTelemetry);
            if (parsed) {
                const ts = sanitizeArray(parsed.timestamps);
                if (ts.length > 0) {
                    telemetryBuffer.timestamps = ts;
                    telemetryBuffer.gas = sanitizeArray(parsed.gas);
                    telemetryBuffer.temp = sanitizeArray(parsed.temp);
                    telemetryBuffer.humid = sanitizeArray(parsed.humid);
                }
            }
        }

        const cachedIncidents = localStorage.getItem(`aero_incidents_${uid}`);
        if (cachedIncidents) {
            const parsedIncidents = JSON.parse(cachedIncidents);
            const inc = sanitizeArray(parsedIncidents);
            if (inc.length > 0) {
                incidentLedger = inc;
            }
        }

        const cachedCount = localStorage.getItem(`aero_incident_count_${uid}`);
        if (cachedCount !== null) {
            emergencyIncidentCount = parseInt(cachedCount, 10) || 0;
        } else {
            emergencyIncidentCount = incidentLedger.length;
        }

        const cachedLastTx = localStorage.getItem(`aero_last_transmission_${uid}`) || localStorage.getItem('aero_last_transmission');
        if (cachedLastTx) {
            displayLastTransmission(cachedLastTx);
        }
    } catch (e) {
        console.warn("Local storage cache restore note:", e);
    }

    // Refresh UI components immediately with restored cache
    renderIncidentTable();
    const statCount = document.getElementById('statEmergencyCount');
    if (statCount) statCount.innerHTML = `Incidents Today: <b>${emergencyIncidentCount}</b>`;

    if (historicalChartInstance) {
        updateHistoricalChartDisplay();
    }
    if (liveChartInstance && telemetryBuffer.timestamps.length > 0) {
        liveChartInstance.data.labels = telemetryBuffer.timestamps.slice(-MAX_LIVE_POINTS);
        liveChartInstance.data.datasets[0].data = telemetryBuffer.temp.slice(-MAX_LIVE_POINTS);
        liveChartInstance.data.datasets[1].data = telemetryBuffer.humid.slice(-MAX_LIVE_POINTS);
        liveChartInstance.data.datasets[2].data = telemetryBuffer.gas.slice(-MAX_LIVE_POINTS);
        liveChartInstance.update();
    }
    if (telemetryBuffer.gas.length > 0) {
        const lastIdx = telemetryBuffer.gas.length - 1;
        updateStatisticalSummary(telemetryBuffer.temp[lastIdx], telemetryBuffer.humid[lastIdx], telemetryBuffer.gas[lastIdx]);
    }

    // 2. Cross-device Cloud synchronization via Firebase Realtime Database
    database.ref(`users/${uid}`).once('value').then(async (snapshot) => {
        const val = snapshot.val() || {};
        let shouldUpdate = false;

        // Restore last transmission timestamp from user cloud profile
        if (val.last_transmission) {
            displayLastTransmission(val.last_transmission);
            try {
                localStorage.setItem(`aero_last_transmission_${uid}`, String(val.last_transmission));
            } catch (e) {}
        }

        // Sync telemetry history from user cloud record, or fall back to master telemetry history
        let cloudHistory = val.telemetry_history;
        if (!cloudHistory || !cloudHistory.timestamps || sanitizeArray(cloudHistory.timestamps).length === 0) {
            try {
                const rootSnap = await database.ref('telemetry_history').once('value');
                if (rootSnap && rootSnap.val()) {
                    cloudHistory = rootSnap.val();
                }
            } catch (e) {
                console.warn("Root telemetry history fallback note:", e);
            }
        }

        if (cloudHistory && cloudHistory.timestamps) {
            const cloudTs = sanitizeArray(cloudHistory.timestamps);
            if (cloudTs.length > 0 && (telemetryBuffer.timestamps.length === 0 || cloudTs.length >= telemetryBuffer.timestamps.length)) {
                telemetryBuffer.timestamps = cloudTs;
                telemetryBuffer.gas = sanitizeArray(cloudHistory.gas);
                telemetryBuffer.temp = sanitizeArray(cloudHistory.temp);
                telemetryBuffer.humid = sanitizeArray(cloudHistory.humid);
                shouldUpdate = true;
                try {
                    localStorage.setItem(`aero_telemetry_${uid}`, JSON.stringify(telemetryBuffer));
                    database.ref(`users/${uid}/telemetry_history`).set(telemetryBuffer).catch(() => {});
                } catch (e) {}
            }
        }

        // Sync incident audit ledger from cloud
        if (val.incident_ledger) {
            const cloudIncidents = sanitizeArray(val.incident_ledger);
            if (incidentLedger.length === 0 || cloudIncidents.length >= incidentLedger.length) {
                incidentLedger = cloudIncidents;
                shouldUpdate = true;
                try {
                    localStorage.setItem(`aero_incidents_${uid}`, JSON.stringify(incidentLedger));
                } catch (e) {}
            }
        }

        if (val.incident_count !== undefined) {
            emergencyIncidentCount = Number(val.incident_count) || incidentLedger.length;
            try {
                localStorage.setItem(`aero_incident_count_${uid}`, String(emergencyIncidentCount));
            } catch (e) {}
            shouldUpdate = true;
        }

        if (shouldUpdate) {
            renderIncidentTable();
            const statCountEl = document.getElementById('statEmergencyCount');
            if (statCountEl) statCountEl.innerHTML = `Incidents Today: <b>${emergencyIncidentCount}</b>`;
            if (historicalChartInstance) {
                updateHistoricalChartDisplay();
            }
            if (liveChartInstance && telemetryBuffer.timestamps.length > 0) {
                liveChartInstance.data.labels = telemetryBuffer.timestamps.slice(-MAX_LIVE_POINTS);
                liveChartInstance.data.datasets[0].data = telemetryBuffer.temp.slice(-MAX_LIVE_POINTS);
                liveChartInstance.data.datasets[1].data = telemetryBuffer.humid.slice(-MAX_LIVE_POINTS);
                liveChartInstance.data.datasets[2].data = telemetryBuffer.gas.slice(-MAX_LIVE_POINTS);
                liveChartInstance.update();
            }
            if (telemetryBuffer.gas.length > 0) {
                const lastIdx = telemetryBuffer.gas.length - 1;
                updateStatisticalSummary(telemetryBuffer.temp[lastIdx], telemetryBuffer.humid[lastIdx], telemetryBuffer.gas[lastIdx]);
            }
        }
    }).catch(err => {
        console.warn("Cloud history sync note:", err);
    });
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
            setTimeout(() => {
                if (liveChartInstance) {
                    liveChartInstance.resize();
                    liveChartInstance.update();
                }
            }, 60);
        }
    } else if (tabName === 'history') {
        if (tabHistoryBtn) tabHistoryBtn.classList.add('active');
        if (viewHistory) {
            viewHistory.style.display = 'block';
            setTimeout(() => {
                if (!historicalChartInstance) {
                    initCharts();
                }
                if (historicalChartInstance) {
                    historicalChartInstance.resize();
                    updateHistoricalChartDisplay();
                }
            }, 60);
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
const HEARTBEAT_TIMEOUT_MS = 12000; // 12 seconds gives margin for Wi-Fi jitter if ESP32 sends every 3s
let heartbeatWatchdogTimer = null;
let initialStreamCheckTimer = null;
let initialSnapshotHandled = false;
let isDeviceOnline = false;
let lastLivePayload = null;

function processTelemetryPayload(data) {
    const temp = data.temperature !== undefined ? Number(data.temperature) : 25.0;
    const humid = data.humidity !== undefined ? Number(data.humidity) : 50.0;
    const gas = data.gas !== undefined ? Number(data.gas) : 400;

    // If user is actively running the Test Alert simulation, record telemetry in buffer/battery
    // but do NOT overwrite simulated emergency gauges or hazard mode on screen!
    if (isSimulationActive) {
        if (data.battery !== undefined) updateBattery(data.battery);
        recordTelemetryPoint(temp, humid, gas);
        updateTimestamp();
        return;
    }

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
        isDeviceOnline = false;
        setConnectionStatus(false, 'No sensor data found in database. Gauges zeroed.');
        resetGaugesToZero();
        return;
    }

    // Always display and persist last transmission timestamp whenever available
    if (data.last_seen) {
        displayLastTransmission(data.last_seen);
        try {
            localStorage.setItem('aero_last_transmission', String(data.last_seen));
            const user = auth.currentUser;
            if (user && user.uid) {
                localStorage.setItem(`aero_last_transmission_${user.uid}`, String(data.last_seen));
                database.ref(`users/${user.uid}/last_transmission`).set(data.last_seen).catch(() => {});
            }
        } catch (e) {}
    }

    // CASE A: Payload contains server timestamp (e.g. data.last_seen)
    if (data.last_seen) {
        const timeSinceLastPacket = Date.now() - Number(data.last_seen);
        if (timeSinceLastPacket > HEARTBEAT_TIMEOUT_MS) {
            // Last packet was received more than 12 seconds ago -> Device is OFF!
            console.log(`[WATCHDOG] ESP32 is offline. Last seen ${Math.round(timeSinceLastPacket / 1000)}s ago.`);
            isDeviceOnline = false;
            setConnectionStatus(false, 'ESP32 device is offline / powered off. Gauges zeroed.');
            resetGaugesToZero();
            return;
        } else {
            // Live active stream
            clearTimeout(heartbeatWatchdogTimer);
            isDeviceOnline = true;
            lastLivePayload = data;
            setConnectionStatus(true);
            processTelemetryPayload(data);

            heartbeatWatchdogTimer = setTimeout(() => {
                console.warn("[WATCHDOG] ESP32 telemetry stopped. Marking device offline.");
                isDeviceOnline = false;
                setConnectionStatus(false, 'ESP32 device powered off or disconnected. Gauges zeroed.');
                resetGaugesToZero();
                if (typeof window.flushAllTelemetryToCloud === 'function') {
                    window.flushAllTelemetryToCloud();
                }
            }, HEARTBEAT_TIMEOUT_MS);
            return;
        }
    }

    // CASE B: Fallback heartbeat verification (works even if firmware doesn't write last_seen)
    if (!initialSnapshotHandled) {
        initialSnapshotHandled = true;

        // Keep gauges and values at ZERO until live incoming stream is confirmed
        isDeviceOnline = false;
        resetGaugesToZero();
        setConnectionStatus(false, 'Verifying live device stream...');

        // ESP32 sends every 3s. If it is genuinely alive, a new live packet will arrive within 4.5s.
        initialStreamCheckTimer = setTimeout(() => {
            console.log("[WATCHDOG] No incoming live stream detected on startup. ESP32 is OFF.");
            isDeviceOnline = false;
            setConnectionStatus(false, 'ESP32 device is offline / powered off. Gauges zeroed.');
            resetGaugesToZero();
        }, 4500);
    } else {
        // Subsequent live packet arrived! Device is definitely ON and transmitting!
        clearTimeout(initialStreamCheckTimer);
        clearTimeout(heartbeatWatchdogTimer);

        isDeviceOnline = true;
        lastLivePayload = data;
        setConnectionStatus(true);
        processTelemetryPayload(data);

        // Re-arm watchdog: if user powers off ESP32, mark offline in 12s, zero gauges, and flush telemetry
        heartbeatWatchdogTimer = setTimeout(() => {
            console.warn("[WATCHDOG] ESP32 telemetry stopped. Marking device offline.");
            isDeviceOnline = false;
            setConnectionStatus(false, 'ESP32 device powered off or disconnected. Gauges zeroed.');
            resetGaugesToZero();
            if (typeof window.flushAllTelemetryToCloud === 'function') {
                window.flushAllTelemetryToCloud();
            }
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
            isDeviceOnline = false;
            setConnectionStatus(false, 'Network connection to cloud lost. Gauges zeroed.');
            resetGaugesToZero();
        }
    }
});

// Initialize Chart.js when DOM is ready and ensure gauges start at ZERO
document.addEventListener('DOMContentLoaded', () => {
    resetGaugesToZero();
    initCharts();
    if (auth.currentUser) {
        loadUserPersistedHistory(auth.currentUser);
    }
});

// Monitor authentication to load persistent history & alerts for the logged-in user
auth.onAuthStateChanged((user) => {
    if (user) {
        loadUserPersistedHistory(user);
    }
});

// Ensure any pending storage writes are flushed before page unloads
window.addEventListener('beforeunload', () => {
    const user = auth.currentUser;
    if (user && user.uid) {
        try {
            if (telemetryBuffer.timestamps.length > 0) {
                localStorage.setItem(`aero_telemetry_${user.uid}`, JSON.stringify(telemetryBuffer));
            }
            localStorage.setItem(`aero_incidents_${user.uid}`, JSON.stringify(incidentLedger));
            localStorage.setItem(`aero_incident_count_${user.uid}`, String(emergencyIncidentCount));
            if (lastTransmissionTimestamp) {
                localStorage.setItem(`aero_last_transmission_${user.uid}`, String(lastTransmissionTimestamp));
            }
        } catch (e) {}
    }
});