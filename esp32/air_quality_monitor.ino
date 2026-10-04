/*
 * ============================================
 * ESP32 Air Quality Monitor (Multi-User Ready)
 * - Sends sensor data to Firebase Realtime Database
 * - DYNAMICALLY fetches the logged-in customer's email from Firebase
 * - Dispatches 24/7 Emergency Alerts to ANY customer's Gmail
 *   (Customer just logs in with Google on the website - zero setup for customer!)
 * ============================================
 * 
 * WIRING:
 *   DHT11 DATA   -> GPIO 4
 *   MQ-135 AO    -> GPIO 34 (via voltage divider)
 *   Battery ADC  -> GPIO 35 (via 100k/100k divider)
 */

#include <WiFi.h>
#include <WiFiManager.h> // WiFiManager by tzapu (Install via Arduino Library Manager)
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Firebase_ESP_Client.h>
#include <DHT.h>

#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ============================================
// SYSTEM & CLOUD CONFIGURATION (Setup by Creator ONCE)
// ============================================
// Note: WiFi is now automatically configured via "AirQuality-Setup" Captive Portal!
// No hardcoded passwords needed!

// Firebase Project Config
#define API_KEY         "AIzaSyDMKU--Mqbn9eRkmVdgbf2dz9BE0J19_CA"
#define DATABASE_URL    "https://air-quality-monitor-50d6c-default-rtdb.asia-southeast1.firebasedatabase.app"

// Firebase Authentication for ESP32
#define USER_EMAIL      "esp32device@gmail.com"
#define USER_PASSWORD   "esp32pass123"

// Google Apps Script Webhook URL (Processes 24/7 emergency emails for any customer)
// Setup: Paste your deployed Google Apps Script Web App URL here
#define GOOGLE_SCRIPT_WEBHOOK_URL "https://script.google.com/macros/s/AKfycbx5ejwP3ws6pUvstoxEI5PJd7yKA26wlXqTAxPROqf7V8u1VtVDr9XN6gYraY-p-rLOsA/exec"

// Emergency Hazard Thresholds
#define EMERGENCY_GAS_THRESHOLD   1600   // MQ-135 reading above 1600 = Hazardous Gas/Smoke
#define EMERGENCY_TEMP_THRESHOLD  40.0   // DHT11 Temp above 40°C = Fire/Extreme Heat
#define EMERGENCY_HUMID_THRESHOLD 88.0   // DHT11 Humidity above 88% = Critical Condensation

// 5-minute cooldown between emails to prevent inbox spam
#define ALERT_COOLDOWN_MS        300000

// ============================================
// PIN DEFINITIONS
// ============================================

#define DHT_PIN         4       // DHT11 DATA pin
#define DHT_TYPE        DHT11   // Sensor type
#define MQ135_PIN       34      // MQ-135 Analog Output (ADC1_CH6)
#define BATTERY_PIN     35      // Battery voltage divider (ADC1_CH7)

#define SEND_INTERVAL   3000    // Send data every 3 seconds

// ============================================
// OBJECTS & VARIABLES
// ============================================

DHT dht(DHT_PIN, DHT_TYPE);

FirebaseData fbdo;
FirebaseAuth fbAuth;
FirebaseConfig fbConfig;

unsigned long lastSendTime = 0;
unsigned long lastAlertSentTime = 0;
bool firebaseReady = false;

// Dynamically holds the currently logged-in customer's email from Firebase
String currentCustomerEmail = "";

const float BATTERY_FULL = 4.2;
const float BATTERY_EMPTY = 3.0;

// Function Declarations
void connectWiFi();
void sendToFirebase(float temperature, float humidity, int gas, float battery);
void updateCustomerEmailFromFirebase();
void checkEmergencyAndSendEmail(float temperature, float humidity, int gas);
void dispatchEmailToCustomer(String targetEmail, String subject, String emailBody);

// ============================================
// SETUP
// ============================================

void setup() {
    Serial.begin(115200);
    Serial.println("\n==========================================");
    Serial.println(" ESP32 Air Monitor (Multi-Customer Mode)");
    Serial.println("==========================================\n");

    dht.begin();
    Serial.println("[OK] DHT11 sensor initialized.");

    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);
    Serial.println("[OK] ADC configured (12-bit, 0-3.3V).");

    connectWiFi();

    fbConfig.api_key = API_KEY;
    fbConfig.database_url = DATABASE_URL;
    fbAuth.user.email = USER_EMAIL;
    fbAuth.user.password = USER_PASSWORD;
    fbConfig.token_status_callback = tokenStatusCallback;

    Firebase.begin(&fbConfig, &fbAuth);
    Firebase.reconnectWiFi(true);

    Serial.println("[...] Connecting to Firebase Realtime Database...");

    unsigned long startWait = millis();
    while (!Firebase.ready() && (millis() - startWait) < 15000) {
        delay(100);
    }

    if (Firebase.ready()) {
        firebaseReady = true;
        Serial.println("[OK] Firebase connected successfully!");
        updateCustomerEmailFromFirebase();
    }

    Serial.println("\n--- Live monitoring started ---\n");
}

// ============================================
// MAIN LOOP
// ============================================

void loop() {
    if (millis() - lastSendTime >= SEND_INTERVAL) {
        lastSendTime = millis();

        float temperature = dht.readTemperature();
        float humidity = dht.readHumidity();

        if (isnan(temperature) || isnan(humidity)) {
            temperature = 0;
            humidity = 0;
        }

        int gasRaw = analogRead(MQ135_PIN);

        int batteryRaw = analogRead(BATTERY_PIN);
        float batteryVoltage = (batteryRaw / 4095.0) * 3.3 * 2.0;
        float batteryPercent = ((batteryVoltage - BATTERY_EMPTY) / (BATTERY_FULL - BATTERY_EMPTY)) * 100.0;
        batteryPercent = constrain(batteryPercent, 0, 100);

        Serial.printf("Temp: %.1f C | Humid: %.1f %% | Gas: %d | Batt: %.1f %% | Customer: %s\n",
                       temperature, humidity, gasRaw, batteryPercent, 
                       currentCustomerEmail.length() > 0 ? currentCustomerEmail.c_str() : "No user logged in yet");

        if (Firebase.ready()) {
            sendToFirebase(temperature, humidity, gasRaw, batteryPercent);
            
            // Check every 30 seconds if a new customer logged in
            static unsigned long lastEmailCheck = 0;
            if (millis() - lastEmailCheck > 30000 || currentCustomerEmail == "") {
                lastEmailCheck = millis();
                updateCustomerEmailFromFirebase();
            }
        }

        // Emergency Hazard Detection
        checkEmergencyAndSendEmail(temperature, humidity, gasRaw);
    }
}

// ============================================
// DYNAMIC CUSTOMER EMAIL SYNCHRONIZATION
// ============================================

void updateCustomerEmailFromFirebase() {
    if (Firebase.RTDB.getString(&fbdo, "/alert_settings/recipient_email")) {
        String fetchedEmail = fbdo.stringData();
        if (fetchedEmail.length() > 0 && fetchedEmail != currentCustomerEmail) {
            currentCustomerEmail = fetchedEmail;
            Serial.printf("[USER SYNC] Active customer email updated to: %s\n", currentCustomerEmail.c_str());
        }
    }
}

// ============================================
// EMERGENCY DETECTION & EMAIL DISPATCH
// ============================================

void checkEmergencyAndSendEmail(float temperature, float humidity, int gas) {
    bool gasHazard = (gas >= EMERGENCY_GAS_THRESHOLD);
    bool tempHazard = (temperature >= EMERGENCY_TEMP_THRESHOLD);
    bool humidHazard = (humidity >= EMERGENCY_HUMID_THRESHOLD);

    if (gasHazard || tempHazard || humidHazard) {
        unsigned long currentMillis = millis();

        if (currentMillis - lastAlertSentTime >= ALERT_COOLDOWN_MS || lastAlertSentTime == 0) {
            lastAlertSentTime = currentMillis;

            String subject = "🚨 CRITICAL AIR QUALITY ALERT: Emergency Hazard Detected";
            String body = "Hello,\n\nYour ESP32 Air Quality Monitor has detected dangerous environmental readings:\n\n";

            if (gasHazard) {
                body += "- Hazardous Gas/Smoke Reading: " + String(gas) + " PPM (Threshold: " + String(EMERGENCY_GAS_THRESHOLD) + ")\n";
            }
            if (tempHazard) {
                body += "- Extreme Temperature: " + String(temperature, 1) + " °C (Threshold: " + String(EMERGENCY_TEMP_THRESHOLD, 1) + " °C)\n";
            }
            if (humidHazard) {
                body += "- Critical Condensation/Humidity: " + String(humidity, 1) + " % (Threshold: " + String(EMERGENCY_HUMID_THRESHOLD, 1) + " %)\n";
            }
            body += "\nIMMEDIATE ACTION REQUIRED:\n";
            body += "Please inspect the area for gas leaks, smoke, or fire hazards, and ensure proper ventilation immediately!\n\n";
            body += "Live Website Dashboard: https://air-quality-monitor-delta.vercel.app\n";

            // If we have a customer email from Firebase, send directly to them!
            if (currentCustomerEmail.length() > 0) {
                Serial.printf("\n[EMERGENCY TRIGGERED] Dispatching 24/7 email to customer: %s\n", currentCustomerEmail.c_str());
                dispatchEmailToCustomer(currentCustomerEmail, subject, body);
            } else {
                Serial.println("\n[WARN] Emergency detected, but no customer email is registered in Firebase yet.");
            }
        }
    }
}

/**
 * Dispatch Email to Customer via Google Apps Script Webhook Gateway
 * - Direct Gmail delivery to ANY customer email
 * - Works 24/7 even when website / laptop is completely closed!
 */
void dispatchEmailToCustomer(String targetEmail, String subject, String emailBody) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[ERROR] WiFi disconnected.");
        return;
    }

    if (String(GOOGLE_SCRIPT_WEBHOOK_URL).indexOf("script.google.com") == -1) {
        Serial.println("[CONFIG NEEDED] Please set your deployed Google Apps Script Webhook URL!");
        return;
    }

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(12000);
    http.begin(client, GOOGLE_SCRIPT_WEBHOOK_URL);
    http.addHeader("Content-Type", "application/json");

    FirebaseJson json;
    json.set("to", targetEmail);
    json.set("subject", subject);
    json.set("message", emailBody);

    String payload;
    json.toString(payload, false);

    int httpResponseCode = http.POST(payload);

    if (httpResponseCode == 200 || httpResponseCode == 302) {
        Serial.printf("[OK] Emergency alert email sent to %s! (HTTP Code: %d)\n", targetEmail.c_str(), httpResponseCode);
    } else {
        Serial.printf("[ERROR] Failed to send email. Code: %d\n", httpResponseCode);
        String response = http.getString();
        if (response.length() > 0) {
            Serial.printf("Response: %s\n", response.c_str());
        }
    }

    http.end();
}

// ============================================
// HELPER FUNCTIONS
// ============================================

void connectWiFi() {
    // Check if the built-in BOOT button (GPIO 0) is pressed on startup to force-reset WiFi
    pinMode(0, INPUT_PULLUP);
    if (digitalRead(0) == LOW) {
        Serial.println("\n[RESET TRIGGERED] BOOT button held! Erasing saved WiFi...");
        WiFiManager wm;
        wm.resetSettings();
        delay(1000);
    }

    WiFiManager wm;

    // Timeout: If unable to connect to the saved home WiFi within 20 seconds,
    // automatically open the "AirQuality-Setup" portal!
    wm.setConnectTimeout(20);
    wm.setConfigPortalTimeout(180); // Portal stays active for 3 minutes for user input

    Serial.println("\n[WIFI] Attempting connection to saved WiFi...");
    Serial.println("[WIFI] If connection fails or none is saved, hotspot 'AirQuality-Setup' will start.");

    // Starts hotspot "AirQuality-Setup" if connection fails
    bool connected = wm.autoConnect("AirQuality-Setup");

    if (!connected) {
        Serial.println("\n[WIFI] Failed to connect or portal timed out. Restarting ESP32...");
        delay(2000);
        ESP.restart();
    }

    Serial.println("\n[OK] WiFi connected successfully!");
    Serial.printf("     IP Address: %s\n", WiFi.localIP().toString().c_str());
}

void sendToFirebase(float temperature, float humidity, int gas, float battery) {
    FirebaseJson json;
    json.set("temperature", temperature);
    json.set("humidity", humidity);
    json.set("gas", gas);
    json.set("battery", battery);
    json.set("last_seen/.sv", "timestamp");

    if (Firebase.RTDB.setJSON(&fbdo, "/sensor_data", &json)) {
        // Success
    } else {
        Serial.printf("[ERROR] Firebase send failed: %s\n", fbdo.errorReason().c_str());
    }
}
