// ============================================
// Dashboard - Real-time Gauge Updates & Emergency System
// Integrated with Web3Forms Direct Email Dispatch
// ============================================

// Total SVG arc length for the semicircle gauges (r=80, 180 degrees)
const ARC_LENGTH = 251.33;

// Sensor ranges
const TEMP_MIN = 0, TEMP_MAX = 50;       // DHT11 range: 0-50°C
const HUMID_MIN = 0, HUMID_MAX = 100;    // DHT11 range: 0-100%
const GAS_MIN = 0, GAS_MAX = 4095;      // MQ-135 ADC range: 0-4095 (12-bit ESP32)

// ============================================
// EMERGENCY THRESHOLDS
// ============================================
const EMERGENCY_THRESHOLDS = {
    gas: 1800,        // MQ-135 raw reading above 1800 is considered hazardous smoke/gas
    tempHigh: 40.0,   // High temperature alert (°C)
    humidHigh: 85.0   // Extreme humidity level (%)
};

// Emergency System State
let isEmergencyActive = false;
let isAudioMuted = false;
let audioContext = null;
let sirenInterval = null;
let lastEmailSentTimestamp = 0;
const EMAIL_COOLDOWN_MS = 60 * 1000; // 1-minute cooldown between emergency emails for testing
let isSimulationActive = false;

// ============================================
// WEB3FORMS MASTER ACCESS KEY
// ============================================
const WEB3FORMS_ACCESS_KEY = "6082d8ac-4c0f-4434-969f-e0e7c1974d91";

/**
 * Update a speedometer gauge with a new value
 * @param {string} id     - Gauge identifier: 'temp', 'humid', or 'gas'
 * @param {number} value  - The current sensor value
 * @param {number} min    - Minimum of the gauge range
 * @param {number} max    - Maximum of the gauge range
 */
function updateGauge(id, value, min, max) {
    // Clamp value within range
    value = Math.max(min, Math.min(max, value));
    
    // Calculate percentage (0 to 1)
    const percent = (value - min) / (max - min);
    
    // Update the filled arc (stroke-dashoffset)
    const fillEl = document.getElementById(id + 'Fill');
    if (fillEl) {
        const offset = ARC_LENGTH * (1 - percent);
        fillEl.style.strokeDashoffset = offset;
        
        // Change color based on severity
        fillEl.style.stroke = getGaugeColor(id, percent);
    }
    
    // Rotate the needle (-90deg = left, +90deg = right)
    const needleEl = document.getElementById(id + 'Needle');
    if (needleEl) {
        const angle = -90 + (percent * 180);
        needleEl.style.transform = `rotate(${angle}deg)`;
    }
    
    // Update the numeric display
    const valueEl = document.getElementById(id + 'Value');
    if (valueEl) {
        if (id === 'temp' || id === 'humid') {
            valueEl.textContent = value.toFixed(1);
        } else {
            valueEl.textContent = Math.round(value);
        }
    }
    
    // Update status badge
    updateStatus(id, percent);
}

/**
 * Dynamic gauge color based on type and percentage
 */
function getGaugeColor(id, percent) {
    if (id === 'temp') {
        if (percent < 0.3) return '#3b82f6';       // Cold - Blue
        if (percent < 0.5) return '#22c55e';        // Comfortable - Green
        if (percent < 0.7) return '#eab308';        // Warm - Yellow
        if (percent < 0.85) return '#f97316';       // Hot - Orange
        return '#ef4444';                            // Danger - Red
    }
    
    if (id === 'humid') {
        if (percent < 0.2) return '#f97316';        // Too Dry - Orange
        if (percent < 0.4) return '#22c55e';        // Comfortable - Green
        if (percent < 0.7) return '#3b82f6';        // Normal - Blue
        if (percent < 0.85) return '#eab308';       // Humid - Yellow
        return '#ef4444';                            // High - Red
    }
    
    if (id === 'gas') {
        if (percent < 0.25) return '#22c55e';       // Clean Air - Green
        if (percent < 0.45) return '#eab308';       // Moderate - Yellow
        if (percent < 0.65) return '#f97316';       // Poor - Orange
        return '#ef4444';                            // Hazardous - Red
    }
    
    return '#3b82f6';
}

/**
 * Update the status badge text below each gauge
 */
function updateStatus(id, percent) {
    const statusEl = document.getElementById(id + 'Status');
    if (!statusEl) return;
    
    let text = '', cssClass = '';
    
    if (id === 'temp') {
        if (percent < 0.3) { text = 'Cold'; cssClass = 'moderate'; }
        else if (percent < 0.5) { text = 'Comfortable'; cssClass = 'good'; }
        else if (percent < 0.7) { text = 'Warm'; cssClass = 'moderate'; }
        else if (percent < 0.8) { text = 'Hot'; cssClass = 'poor'; }
        else { text = 'Extreme Heat!'; cssClass = 'danger'; }
    }
    
    if (id === 'humid') {
        if (percent < 0.2) { text = 'Too Dry'; cssClass = 'poor'; }
        else if (percent < 0.4) { text = 'Comfortable'; cssClass = 'good'; }
        else if (percent < 0.7) { text = 'Normal'; cssClass = 'good'; }
        else if (percent < 0.85) { text = 'Humid'; cssClass = 'moderate'; }
        else { text = 'Excessive Humidity!'; cssClass = 'danger'; }
    }
    
    if (id === 'gas') {
        if (percent < 0.25) { text = 'Clean Air'; cssClass = 'good'; }
        else if (percent < 0.45) { text = 'Moderate'; cssClass = 'moderate'; }
        else if (percent < 0.65) { text = 'Poor Air Quality'; cssClass = 'poor'; }
        else { text = 'Hazardous Gas Detected!'; cssClass = 'danger'; }
    }
    
    statusEl.textContent = text;
    statusEl.className = 'gauge-status ' + cssClass;
}

/**
 * ============================================
 * EMERGENCY SYSTEM LOGIC
 * ============================================
 */
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

    if (state.active) {
        isEmergencyActive = true;
        body.classList.add('emergency-mode');

        // Blink the specific sensor cards that breached the threshold
        if (state.gasAbnormal) {
            gasCard.classList.add('emergency-blink');
        } else {
            gasCard.classList.remove('emergency-blink');
        }

        if (state.tempAbnormal) {
            tempCard.classList.add('emergency-blink');
        } else {
            tempCard.classList.remove('emergency-blink');
        }

        if (state.humidAbnormal) {
            humidCard.classList.add('emergency-blink');
        } else {
            humidCard.classList.remove('emergency-blink');
        }

        const reasons = [];
        if (state.gasAbnormal) reasons.push(`Hazardous Gas (${Math.round(state.gasVal)} PPM)`);
        if (state.tempAbnormal) reasons.push(`Extreme Temp (${state.tempVal.toFixed(1)}°C)`);
        if (state.humidAbnormal) reasons.push(`Extreme Humidity (${state.humidVal.toFixed(1)}%)`);

        banner.className = 'status-banner danger';
        bannerMsg.innerHTML = `<strong>⚠️ EMERGENCY ALERT:</strong> ${reasons.join(' & ')} detected! Notification dispatched.`;

        // Start audible siren
        startAudioAlert();

        // Dispatch Real Email via Web3Forms
        triggerEmergencyEmailNotification(reasons.join(', '));

    } else {
        isEmergencyActive = false;
        body.classList.remove('emergency-mode');
        gasCard.classList.remove('emergency-blink');
        tempCard.classList.remove('emergency-blink');
        humidCard.classList.remove('emergency-blink');

        stopAudioAlert();

        banner.className = 'status-banner success';
        bannerMsg.textContent = 'ESP32 is connected and sensor readings are safe.';
    }
}

/**
 * Toggle Test Emergency Simulation
 */
function toggleEmergencySimulation() {
    const simBtn = document.getElementById('simEmergencyBtn');
    isSimulationActive = !isSimulationActive;

    if (isSimulationActive) {
        simBtn.classList.add('active');
        simBtn.innerHTML = '<i class="fas fa-stop"></i> <span>Stop Simulation</span>';

        // Simulate dangerous levels
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
        simBtn.classList.remove('active');
        simBtn.innerHTML = '<i class="fas fa-bolt"></i> <span>Test Emergency UI</span>';

        // Reset to normal values
        updateGauge('gas', 420, GAS_MIN, GAS_MAX);
        updateGauge('temp', 27.2, TEMP_MIN, TEMP_MAX);
        updateGauge('humid', 54.0, HUMID_MIN, HUMID_MAX);

        applyEmergencyState({
            active: false,
            gasAbnormal: false,
            tempAbnormal: false,
            humidAbnormal: false,
            gasVal: 420,
            tempVal: 27.2,
            humidVal: 54.0
        });
    }
}

/**
 * Web Audio API Siren
 */
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
            osc.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.3);

            gain.gain.setValueAtTime(0.15, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            osc.start();
            osc.stop(audioContext.currentTime + 0.3);
        }

        playBeep();
        sirenInterval = setInterval(playBeep, 1200);
    } catch (e) {
        console.warn("Audio Context init waiting for user gesture:", e);
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
        muteIcon.className = 'fas fa-volume-xmark';
        muteText.textContent = 'Unmute';
    } else {
        muteIcon.className = 'fas fa-volume-high';
        muteText.textContent = 'Mute';
        if (isEmergencyActive) startAudioAlert();
    }
}

/**
 * ============================================
 * EMAIL DISPATCH VIA WEB3FORMS (Real Gmail delivery)
 * ============================================
 */
function triggerEmergencyEmailNotification(incidentDetails) {
    const user = auth.currentUser;
    const targetEmail = user ? user.email : "fafnir007vk@gmail.com";

    const now = Date.now();
    // Cooldown check (60s during testing)
    if (now - lastEmailSentTimestamp < EMAIL_COOLDOWN_MS) {
        const remainingSec = Math.round((EMAIL_COOLDOWN_MS - (now - lastEmailSentTimestamp)) / 1000);
        console.log(`[Email Cooldown] Next email alert allowed in ${remainingSec}s`);
        return;
    }

    lastEmailSentTimestamp = now;

    // Update dispatch status in card
    const statusEl = document.getElementById('emailDispatchStatus');
    if (statusEl) {
        statusEl.textContent = `Sending to ${targetEmail}...`;
    }

    // Show floating toast
    showEmailToast(targetEmail);

    console.log(`🚨 [DISPATCHING REAL EMAIL via Web3Forms] Recipient: ${targetEmail}`);

    const emailPayload = {
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: "Air Quality Alert: High Sensor Reading Detected",
        from_name: "ESP32 Monitor Notification",
        to_email: targetEmail,
        reply_to: targetEmail,
        message: `Hello,\n\n` +
            `Your ESP32 Air Quality Monitor has detected an abnormal environmental reading:\n\n` +
            `Condition: ${incidentDetails}\n` +
            `Time: ${new Date().toLocaleString()}\n\n` +
            `Please check room ventilation and safety.\n` +
            `Live Dashboard: https://air-quality-monitor-delta.vercel.app`
    };

    fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify(emailPayload)
    })
    .then(async (response) => {
        const result = await response.json();
        if (response.status === 200) {
            console.log("✅ [EMAIL DELIVERED SUCCESSFULLY]:", result);
            if (statusEl) {
                statusEl.textContent = `Dispatched to ${targetEmail} (Delivered)`;
            }
        } else {
            console.error("❌ [EMAIL DISPATCH ERROR]:", result);
            if (statusEl) {
                statusEl.textContent = `Delivery failed: ${result.message}`;
            }
        }
    })
    .catch((error) => {
        console.error("❌ [NETWORK ERROR]:", error);
        if (statusEl) {
            statusEl.textContent = `Error connecting to email service`;
        }
    });
}

function showEmailToast(recipientEmail) {
    const toast = document.getElementById('emailToast');
    const emailAddr = document.getElementById('emailToastAddress');
    if (toast && emailAddr) {
        emailAddr.textContent = `Alert dispatched to ${recipientEmail}`;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 6000);
    }
}

/**
 * Update Battery Level
 */
function updateBattery(percent) {
    percent = Math.max(0, Math.min(100, percent));
    
    const bar = document.getElementById('batteryBar');
    const valueEl = document.getElementById('batteryValue');
    const iconEl = document.getElementById('batteryIcon');
    
    if (bar) {
        bar.style.width = percent + '%';
        if (percent > 60) {
            bar.style.background = 'linear-gradient(90deg, #22c55e, #06b6d4)';
        } else if (percent > 30) {
            bar.style.background = 'linear-gradient(90deg, #eab308, #f97316)';
        } else {
            bar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
        }
    }
    
    if (valueEl) valueEl.textContent = Math.round(percent) + '%';
    
    if (iconEl) {
        iconEl.className = 'fas ';
        if (percent > 75) iconEl.className += 'fa-battery-full';
        else if (percent > 50) iconEl.className += 'fa-battery-three-quarters';
        else if (percent > 25) iconEl.className += 'fa-battery-half';
        else if (percent > 10) iconEl.className += 'fa-battery-quarter';
        else iconEl.className += 'fa-battery-empty';
    }
}

function setConnectionStatus(isOnline) {
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    const banner = document.getElementById('statusBanner');
    const bannerMsg = document.getElementById('statusMessage');
    
    if (isOnline) {
        dot.className = 'status-dot online';
        text.textContent = 'Live';
        if (!isEmergencyActive) {
            banner.className = 'status-banner success';
            bannerMsg.textContent = 'ESP32 is connected and sending live sensor data.';
        }
    } else {
        dot.className = 'status-dot offline';
        text.textContent = 'Disconnected';
        if (!isEmergencyActive) {
            banner.className = 'status-banner warning';
            bannerMsg.textContent = 'Waiting for ESP32 sensor data...';
        }
    }
}

function updateTimestamp() {
    const el = document.getElementById('lastUpdated');
    if (el) {
        const now = new Date();
        el.textContent = now.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    }
}

// ============================================
// Firebase Realtime Database Listener
// ============================================
const sensorRef = database.ref('sensor_data');
let hasReceivedData = false;

sensorRef.on('value', (snapshot) => {
    const data = snapshot.val();
    
    if (data) {
        hasReceivedData = true;
        setConnectionStatus(true);
        
        const temp = data.temperature !== undefined ? data.temperature : 0;
        const humid = data.humidity !== undefined ? data.humidity : 0;
        const gas = data.gas !== undefined ? data.gas : 0;

        // Update gauges
        updateGauge('temp', temp, TEMP_MIN, TEMP_MAX);
        updateGauge('humid', humid, HUMID_MIN, HUMID_MAX);
        updateGauge('gas', gas, GAS_MIN, GAS_MAX);

        // Evaluate whether any sensor is in the Emergency Danger Zone
        evaluateEmergencyConditions(temp, humid, gas);
        
        // Update Battery Level
        if (data.battery !== undefined) {
            updateBattery(data.battery);
        }
        
        // Update timestamp
        updateTimestamp();
    }
});

// Monitor Firebase connection state
const connectedRef = database.ref('.info/connected');
connectedRef.on('value', (snap) => {
    if (snap.val() === true) {
        console.log("Connected to Firebase Realtime Database");
    } else {
        if (hasReceivedData && !isSimulationActive) {
            setConnectionStatus(false);
        }
    }
});
