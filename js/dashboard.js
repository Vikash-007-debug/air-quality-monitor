// ============================================
// Dashboard - Real-time Gauge Updates
// ============================================

// Total SVG arc length for the semicircle gauges (r=80, 180 degrees)
const ARC_LENGTH = 251.33;

// Sensor ranges
const TEMP_MIN = 0, TEMP_MAX = 50;       // DHT11 range: 0-50°C
const HUMID_MIN = 0, HUMID_MAX = 100;    // DHT11 range: 0-100%
const GAS_MIN = 0, GAS_MAX = 4095;      // MQ-135 ADC range: 0-4095 (12-bit ESP32)

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
        if (id === 'temp') {
            valueEl.textContent = value.toFixed(1);
        } else if (id === 'humid') {
            valueEl.textContent = value.toFixed(1);
        } else {
            valueEl.textContent = Math.round(value);
        }
    }
    
    // Update status badge
    updateStatus(id, percent);
}

/**
 * Get dynamic gauge color based on type and percentage
 */
function getGaugeColor(id, percent) {
    if (id === 'temp') {
        if (percent < 0.3) return '#3b82f6';       // Cold - Blue
        if (percent < 0.5) return '#22c55e';        // Comfortable - Green
        if (percent < 0.7) return '#eab308';        // Warm - Yellow
        if (percent < 0.85) return '#f97316';       // Hot - Orange
        return '#ef4444';                            // Very Hot - Red
    }
    
    if (id === 'humid') {
        if (percent < 0.2) return '#f97316';        // Too Dry - Orange
        if (percent < 0.4) return '#22c55e';        // Comfortable - Green
        if (percent < 0.7) return '#3b82f6';        // Normal - Blue
        if (percent < 0.85) return '#eab308';       // Humid - Yellow
        return '#ef4444';                            // Very Humid - Red
    }
    
    if (id === 'gas') {
        if (percent < 0.25) return '#22c55e';       // Clean Air - Green
        if (percent < 0.5) return '#eab308';        // Moderate - Yellow
        if (percent < 0.75) return '#f97316';       // Poor - Orange
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
        else if (percent < 0.85) { text = 'Hot'; cssClass = 'poor'; }
        else { text = 'Very Hot!'; cssClass = 'danger'; }
    }
    
    if (id === 'humid') {
        if (percent < 0.2) { text = 'Too Dry'; cssClass = 'poor'; }
        else if (percent < 0.4) { text = 'Comfortable'; cssClass = 'good'; }
        else if (percent < 0.7) { text = 'Normal'; cssClass = 'good'; }
        else if (percent < 0.85) { text = 'Humid'; cssClass = 'moderate'; }
        else { text = 'Very Humid!'; cssClass = 'danger'; }
    }
    
    if (id === 'gas') {
        if (percent < 0.25) { text = 'Clean Air'; cssClass = 'good'; }
        else if (percent < 0.5) { text = 'Moderate'; cssClass = 'moderate'; }
        else if (percent < 0.75) { text = 'Poor Air'; cssClass = 'poor'; }
        else { text = 'Hazardous!'; cssClass = 'danger'; }
    }
    
    statusEl.textContent = text;
    statusEl.className = 'gauge-status ' + cssClass;
}

/**
 * Update the battery level display
 */
function updateBattery(percent) {
    percent = Math.max(0, Math.min(100, percent));
    
    const bar = document.getElementById('batteryBar');
    const valueEl = document.getElementById('batteryValue');
    const iconEl = document.getElementById('batteryIcon');
    
    if (bar) {
        bar.style.width = percent + '%';
        
        // Change color based on battery level
        if (percent > 60) {
            bar.style.background = 'linear-gradient(90deg, #22c55e, #06b6d4)';
        } else if (percent > 30) {
            bar.style.background = 'linear-gradient(90deg, #eab308, #f97316)';
        } else {
            bar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
        }
    }
    
    if (valueEl) {
        valueEl.textContent = Math.round(percent) + '%';
    }
    
    if (iconEl) {
        // Change battery icon based on level
        iconEl.className = 'fas ';
        if (percent > 75) iconEl.className += 'fa-battery-full';
        else if (percent > 50) iconEl.className += 'fa-battery-three-quarters';
        else if (percent > 25) iconEl.className += 'fa-battery-half';
        else if (percent > 10) iconEl.className += 'fa-battery-quarter';
        else iconEl.className += 'fa-battery-empty';
    }
}

/**
 * Update connection status indicator
 */
function setConnectionStatus(isOnline) {
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    const banner = document.getElementById('statusBanner');
    const bannerMsg = document.getElementById('statusMessage');
    
    if (isOnline) {
        dot.className = 'status-dot online';
        text.textContent = 'Live';
        banner.className = 'status-banner success';
        bannerMsg.textContent = 'ESP32 is connected and sending live sensor data.';
    } else {
        dot.className = 'status-dot offline';
        text.textContent = 'Disconnected';
        banner.className = 'status-banner warning';
        bannerMsg.textContent = 'Waiting for ESP32 sensor data...';
    }
}

/**
 * Update the "Last Updated" timestamp
 */
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

// Listen for real-time sensor data from ESP32
// Expected Firebase path: /sensor_data
// Expected data format:
// {
//   temperature: 28.5,
//   humidity: 65.2,
//   gas: 312,
//   battery: 78.5
// }

const sensorRef = database.ref('sensor_data');
let hasReceivedData = false;

sensorRef.on('value', (snapshot) => {
    const data = snapshot.val();
    
    if (data) {
        hasReceivedData = true;
        setConnectionStatus(true);
        
        // Update Temperature Gauge
        if (data.temperature !== undefined) {
            updateGauge('temp', data.temperature, TEMP_MIN, TEMP_MAX);
        }
        
        // Update Humidity Gauge
        if (data.humidity !== undefined) {
            updateGauge('humid', data.humidity, HUMID_MIN, HUMID_MAX);
        }
        
        // Update Gas / Air Quality Gauge
        if (data.gas !== undefined) {
            updateGauge('gas', data.gas, GAS_MIN, GAS_MAX);
        }
        
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
        if (hasReceivedData) {
            setConnectionStatus(false);
        }
    }
});
