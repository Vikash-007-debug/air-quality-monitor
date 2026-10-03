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
    const isDedicatedLoginPage = currentPage.endsWith("login.html");
    const isDashboardPage = currentPage.endsWith("dashboard.html");
    const isHomePage = currentPage.endsWith("index.html") || currentPage.endsWith("/") || currentPage.endsWith("home.html");

    if (user) {
        console.log("User authenticated:", user.email);

        // Ensure current logged-in customer's email is set as active alert recipient
        database.ref('alert_settings').update({
            recipient_email: user.email,
            recipient_name: user.displayName || "Customer",
            last_active: new Date().toISOString()
        });

        // Dedicated login page redirects straight to dashboard
        if (isDedicatedLoginPage) {
            window.location.href = "dashboard.html";
        }

        // On Home page: update navbar to show authenticated status & Dashboard CTA
        if (isHomePage) {
            const homeAuthBtn = document.getElementById("homeAuthBtn");
            const mobileAuthBtn = document.getElementById("mobileAuthBtn");
            const avatarHtml = `
                <img src="${user.photoURL || 'https://ui-avatars.com/api/?name=User'}" class="user-avatar" style="width: 22px; height: 22px; margin-right: 6px;" alt="Avatar">
                <span>Dashboard (${user.displayName ? user.displayName.split(' ')[0] : 'User'})</span>
            `;

            if (homeAuthBtn) {
                homeAuthBtn.innerHTML = avatarHtml;
                homeAuthBtn.onclick = () => { window.location.href = "dashboard.html"; };
                homeAuthBtn.className = "btn-matte-primary";
            }
            if (mobileAuthBtn) {
                mobileAuthBtn.innerHTML = avatarHtml;
                mobileAuthBtn.onclick = () => { window.location.href = "dashboard.html"; };
                mobileAuthBtn.className = "btn-matte-primary mobile-btn-full";
            }
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

            // Warm up recipient inbox with polite Welcome email
            if (typeof checkAndSendWelcomeEmail === 'function') {
                checkAndSendWelcomeEmail(user);
            }
        }
    } else {
        if (isDashboardPage) {
            window.location.href = "login.html";
        }
    }
});
