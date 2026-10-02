// ============================================
// Firebase Authentication (Google Sign-In)
// Automatically registers customer email for alerts
// ============================================

function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    
    auth.signInWithPopup(provider)
        .then((result) => {
            console.log("Signed in as:", result.user.displayName);
            
            // Automatically register customer's email in Firebase for alerts
            if (result.user && result.user.email) {
                database.ref('alert_settings').update({
                    recipient_email: result.user.email,
                    recipient_name: result.user.displayName || "Customer",
                    last_login: new Date().toISOString()
                });
            }

            window.location.href = "dashboard.html";
        })
        .catch((error) => {
            console.error("Sign-in error:", error.message);
            alert("Sign-in failed: " + error.message);
        });
}

function signOutUser() {
    auth.signOut()
        .then(() => {
            window.location.href = "index.html";
        })
        .catch((error) => {
            console.error("Sign-out error:", error.message);
        });
}

auth.onAuthStateChanged((user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.endsWith("index.html") || currentPage.endsWith("/");
    const isDashboardPage = currentPage.endsWith("dashboard.html");

    if (user) {
        // Automatically sync logged-in customer's email to Firebase
        database.ref('alert_settings').update({
            recipient_email: user.email,
            recipient_name: user.displayName || "Customer"
        });

        if (isLoginPage) {
            window.location.href = "dashboard.html";
        }

        if (isDashboardPage) {
            const userPhoto = document.getElementById("userPhoto");
            const userName = document.getElementById("userName");
            
            if (userPhoto && user.photoURL) {
                userPhoto.src = user.photoURL;
            }
            if (userName) {
                userName.textContent = user.displayName || user.email;
            }
        }
    } else {
        if (isDashboardPage) {
            window.location.href = "index.html";
        }
    }
});
