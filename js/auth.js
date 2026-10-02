// ============================================
// Firebase Authentication (Google Sign-In)
// Automatically registers user email for alerts
// ============================================

/**
 * Sign in the user with Google popup
 */
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

            // Redirect to dashboard after successful login
            window.location.href = "dashboard.html";
        })
        .catch((error) => {
            console.error("Sign-in error:", error.message);
            alert("Sign-in failed: " + error.message);
        });
}

/**
 * Sign out the current user
 */
function signOutUser() {
    auth.signOut()
        .then(() => {
            console.log("Signed out successfully");
            window.location.href = "index.html";
        })
        .catch((error) => {
            console.error("Sign-out error:", error.message);
        });
}

/**
 * Monitor authentication state changes
 */
auth.onAuthStateChanged((user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.endsWith("index.html") || currentPage.endsWith("/");
    const isDashboardPage = currentPage.endsWith("dashboard.html");

    if (user) {
        console.log("User authenticated:", user.email);

        // Ensure current logged-in customer's email is set as active alert recipient
        database.ref('alert_settings').update({
            recipient_email: user.email,
            recipient_name: user.displayName || "Customer"
        });

        if (isLoginPage) {
            window.location.href = "dashboard.html";
        }

        if (isDashboardPage) {
            // Update user info in navbar
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
