// ============================================================================
// Login Page
// ============================================================================

const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('errorMessage');

// ============================================================================
// Event Listeners
// ============================================================================

loginForm.addEventListener('submit', handleLogin);

// ============================================================================
// Login Handler
// ============================================================================

async function handleLogin(e) {
    e.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        showError('Please enter both username and password');
        return;
    }

    // Disable form while submitting
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    hideError();

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (result.success) {
            // Check if first-time setup and redirect to settings
            if (result.first_time_setup || result.redirect === '/settings') {
                window.location.href = '/settings';
            } else {
                // Redirect to main page
                window.location.href = '/';
            }
        } else {
            if (result.needs_config) {
                showError('Database not configured. Use admin/admin to access settings.');
            } else {
                showError(result.message || 'Login failed');
            }
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Connection error. Please try again.');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function hideError() {
    errorMessage.style.display = 'none';
}
