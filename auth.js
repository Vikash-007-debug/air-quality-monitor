// ============================================
// Firebase Authentication (Google Sign-In)
// ============================================

/**
 * Sign in the user with Google popup
 */
function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    
    auth.signInWithPopup(provider)
        .then((result) => {
            console.log("Signed in as:", result.user.displayName);
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
 * - On login page: if already signed in, redirect to dashboard
 * - On dashboard page: if not signed in, redirect to login
 */
auth.onAuthStateChanged((user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.endsWith("index.html") || currentPage.endsWith("/");
    const isDashboardPage = currentPage.endsWith("dashboard.html");

    if (user) {
        // User is signed in
        console.log("User authenticated:", user.email);

        if (isLoginPage) {
            // Already logged in, redirect to dashboard
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
        // User is NOT signed in
        if (isDashboardPage) {
            // Redirect to login page
            window.location.href = "index.html";
        }
    }
});
