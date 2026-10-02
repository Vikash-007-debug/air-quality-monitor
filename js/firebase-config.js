// ============================================
// Firebase Configuration
// ============================================
// IMPORTANT: Replace the values below with YOUR Firebase project config.
// Get these from: Firebase Console > Project Settings > Your apps > Web app

const firebaseConfig = {
    apiKey: "AIzaSyDMKU--Mqbn9eRkmVdgbf2dz9BE0J19_CA",
    authDomain: "air-quality-monitor-50d6c.firebaseapp.com",
    databaseURL: "https://air-quality-monitor-50d6c-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "air-quality-monitor-50d6c",
    storageBucket: "air-quality-monitor-50d6c.firebasestorage.app",
    messagingSenderId: "139708424555",
    appId: "1:139708424555:web:cc3bca6a61e32035f56c2e"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Firebase service references
const auth = firebase.auth();
const database = firebase.database();
