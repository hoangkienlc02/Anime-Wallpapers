import { auth } from "./firebase-config.js";
import { createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const OWNER_UID = "aVIhWxMYfRNciqRmuNselJyi1MP2";
const MIN_PASSWORD_LENGTH = 12;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const VERIFICATION_COOLDOWN_MS = 60 * 1000;
const MIN_SESSION_LOADER_MS = 420;

function passwordError(password) {
    if (password.length < MIN_PASSWORD_LENGTH) return `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return "Mật khẩu cần có chữ hoa, chữ thường, số và ký tự đặc biệt.";
    return "";
}

function loginGuardKey(email) { return `anime-wallpaper-login-guard:${email.trim().toLowerCase()}`; }
function getLoginBlock(email) {
    try {
        const record = JSON.parse(localStorage.getItem(loginGuardKey(email)) || "null");
        if (!record) return 0;
        if (record.blockedUntil > Date.now()) return record.blockedUntil - Date.now();
        if (Date.now() - record.firstAttemptAt > LOGIN_WINDOW_MS) localStorage.removeItem(loginGuardKey(email));
    } catch { /* Firebase server protections remain available. */ }
    return 0;
}
function recordFailedLogin(email) {
    try {
        const key = loginGuardKey(email), now = Date.now(), previous = JSON.parse(localStorage.getItem(key) || "null");
        const record = previous && now - previous.firstAttemptAt <= LOGIN_WINDOW_MS ? previous : { count: 0, firstAttemptAt: now };
        record.count += 1;
        if (record.count >= LOGIN_LIMIT) record.blockedUntil = now + LOGIN_WINDOW_MS;
        localStorage.setItem(key, JSON.stringify(record));
    } catch { /* no-op */ }
}
function clearLoginGuard(email) { try { localStorage.removeItem(loginGuardKey(email)); } catch { /* no-op */ } }
function formatRemaining(milliseconds) { return `${Math.max(1, Math.ceil(milliseconds / 60000))} phút`; }

// The app remains unavailable until Firebase restores a verified user session.
export function protectPage(onReady) {
    const gate = document.getElementById("authGate");
    const appShell = document.getElementById("appShell");
    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const confirmPasswordField = document.getElementById("confirmPasswordField");
    const passwordHint = document.getElementById("passwordHint");
    const submitButton = document.getElementById("authSubmitButton");
    const intro = document.getElementById("authIntro");
    const modeButtons = [...document.querySelectorAll("[data-auth-mode]")];
    const switchButton = document.getElementById("authSwitchButton");
    const forgotPasswordButton = document.getElementById("forgotPasswordButton");
    const verifyNotice = document.getElementById("verifyNotice");
    const resendVerificationButton = document.getElementById("resendVerificationButton");
    const error = document.getElementById("loginError");
    const signOutButton = document.getElementById("signOutButton");
    const accountLabel = document.getElementById("accountLabel");
    const registrationAllowed = !document.body.classList.contains("admin-page");
    let authMode = "login", hasStarted = false, authSubmissionInFlight = false, registrationInFlight = false, verificationLastSentAt = 0, revealInFlight = null;

    const setError = (message = "") => { error.textContent = message; };
    function setAuthMode(mode) {
        if (mode === "register" && !registrationAllowed) return;
        authMode = mode;
        const registering = mode === "register";
        if (confirmPasswordField) confirmPasswordField.hidden = !registering;
        if (passwordHint) passwordHint.hidden = !registering;
        if (confirmPasswordInput) confirmPasswordInput.required = registering;
        passwordInput.autocomplete = registering ? "new-password" : "current-password";
        passwordInput.minLength = registering ? MIN_PASSWORD_LENGTH : 6;
        intro.textContent = registering ? "Tạo tài khoản, xác minh email rồi mới mở được kho hình nền." : "Đăng nhập để mở bộ sưu tập hình nền riêng của bạn.";
        submitButton.innerHTML = registering ? 'TẠO TÀI KHOẢN <span class="material-icons-outlined">person_add</span>' : 'MỞ KHO LƯU TRỮ <span class="material-icons-outlined">arrow_forward</span>';
        modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
        if (switchButton) switchButton.textContent = registering ? "ĐĂNG NHẬP" : "ĐĂNG KÝ NGAY";
        if (verifyNotice) verifyNotice.hidden = true;
        setError();
    }
    let sessionLoaderStartedAt = performance.now();
    function startSessionCheck() {
        sessionLoaderStartedAt = performance.now();
        document.body.classList.add("auth-pending");
    }
    async function finishSessionCheck() {
        const remaining = MIN_SESSION_LOADER_MS - (performance.now() - sessionLoaderStartedAt);
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
        document.body.classList.remove("auth-pending");
    }
    function resetToLibraryRoute({ redirect = false } = {}) {
        // Keep /admin stable so its dedicated login page continues to work.
        if (!registrationAllowed) return;
        if (location.pathname !== "/" || location.search || location.hash) {
            if (redirect) {
                location.replace("/");
                return;
            }
            history.replaceState({}, "", "/");
        }
    }
    async function showUnverifiedAccount(user) {
        appShell.hidden = true;
        gate.hidden = false;
        emailInput.value = user.email || emailInput.value;
        if (verifyNotice) verifyNotice.hidden = false;
        setError("Email này chưa được xác minh nên chưa thể truy cập thư viện.");
        await finishSessionCheck();
    }
    async function revealApp(user) {
        if (registrationInFlight) return;
        // Firebase emits onAuthStateChanged while signInWithEmailAndPassword
        // is still resolving. Reuse the same check so two racing callbacks
        // cannot alternately show and hide the app.
        if (revealInFlight) return revealInFlight;
        revealInFlight = (async () => {
            await reload(user);
            const currentUser = auth.currentUser;
            if (!currentUser || currentUser.uid !== user.uid) return;
            // Firestore Rules reads this JWT claim, rather than the cached
            // User profile. Forcing a token renewal makes both checks agree.
            const token = await currentUser.getIdTokenResult(true);
            if (token.claims.email_verified !== true) return showUnverifiedAccount(currentUser);
            if (!registrationAllowed && currentUser.uid !== OWNER_UID) {
                setError("Tài khoản này không có quyền truy cập khu vực Quản trị.");
                try { await signOut(auth); } finally { await finishSessionCheck(); }
                return;
            }
            if (verifyNotice) verifyNotice.hidden = true;
            resetToLibraryRoute();
            gate.hidden = true;
            appShell.hidden = false;
            appShell.dataset.userRole = currentUser.uid === OWNER_UID ? "admin" : "client";
            accountLabel.textContent = currentUser.email || "Đã đăng nhập";
            await finishSessionCheck();
            if (!hasStarted) { hasStarted = true; await onReady(currentUser); }
        })().catch(async (err) => {
            console.warn("Could not refresh the verified session:", err.code || err.message);
            appShell.hidden = true;
            gate.hidden = false;
            setError("Không thể xác minh phiên đăng nhập. Hãy đăng xuất rồi thử lại.");
            await finishSessionCheck();
        }).finally(() => { revealInFlight = null; });
        return revealInFlight;
    }
    async function sendVerification(user) {
        const elapsed = Date.now() - verificationLastSentAt;
        if (elapsed < VERIFICATION_COOLDOWN_MS) throw new Error(`Hãy chờ ${formatRemaining(VERIFICATION_COOLDOWN_MS - elapsed)} trước khi gửi lại.`);
        await sendEmailVerification(user, { url: `${location.origin}/`, handleCodeInApp: false });
        verificationLastSentAt = Date.now();
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (authSubmissionInFlight) return;
        setError();
        const email = emailInput.value.trim(), password = passwordInput.value;
        if (authMode === "login") {
            const blockedFor = getLoginBlock(email);
            if (blockedFor) { setError(`Bạn đã thử quá nhiều lần. Hãy chờ ${formatRemaining(blockedFor)} rồi thử lại.`); return; }
        }
        if (authMode === "register") {
            const issue = passwordError(password);
            if (issue) { setError(issue); return; }
            if (password !== confirmPasswordInput?.value) { setError("Mật khẩu nhập lại chưa khớp."); return; }
        }
        authSubmissionInFlight = true;
        submitButton.disabled = true;
        startSessionCheck();
        try {
            if (authMode === "register") {
                registrationInFlight = true;
                const credential = await createUserWithEmailAndPassword(auth, email, password);
                await sendVerification(credential.user);
                await signOut(auth);
                registrationInFlight = false;
                setAuthMode("login");
                emailInput.value = email;
                setError("Tài khoản đã tạo. Hãy xác minh email trước khi đăng nhập.");
            } else {
                const credential = await signInWithEmailAndPassword(auth, email, password);
                clearLoginGuard(email);
                await revealApp(credential.user);
            }
            passwordInput.value = "";
            if (confirmPasswordInput) confirmPasswordInput.value = "";
        } catch (err) {
            console.warn("Firebase authentication failed:", err.code);
            if (authMode === "login" && ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(err.code)) {
                recordFailedLogin(email);
                setError("Không thể đăng nhập bằng thông tin này.");
            } else {
                const messages = { "auth/operation-not-allowed": "Email/Password chưa được bật trong Firebase Authentication.", "auth/unauthorized-domain": "Domain hiện tại chưa được cho phép trong Firebase Authentication.", "auth/network-request-failed": "Không kết nối được tới Firebase. Hãy kiểm tra mạng.", "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Hãy chờ vài phút rồi thử lại.", "auth/email-already-in-use": "Không thể tạo tài khoản với email này.", "auth/invalid-email": "Email chưa đúng định dạng." };
                setError(messages[err.code] || "Không thể hoàn tất yêu cầu. Hãy thử lại sau.");
            }
            await finishSessionCheck();
        } finally {
            registrationInFlight = false;
            authSubmissionInFlight = false;
            submitButton.disabled = false;
        }
    });

    forgotPasswordButton?.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        if (!email) { setError("Nhập email trước, rồi chọn Quên mật khẩu."); emailInput.focus(); return; }
        forgotPasswordButton.disabled = true;
        try { await sendPasswordResetEmail(auth, email, { url: `${location.origin}/`, handleCodeInApp: false }); setError("Nếu email có tài khoản, hướng dẫn đặt lại mật khẩu đã được gửi."); }
        catch (err) { console.warn("Password-reset request failed:", err.code); setError("Không thể gửi email đặt lại mật khẩu. Hãy thử lại sau."); }
        finally { forgotPasswordButton.disabled = false; }
    });
    resendVerificationButton?.addEventListener("click", async () => {
        if (!auth.currentUser) { setError("Hãy đăng nhập lại để gửi email xác minh."); return; }
        try { await sendVerification(auth.currentUser); setError("Đã gửi email xác minh. Mở email, bấm xác minh, rồi quay lại đăng nhập."); }
        catch (err) { console.warn("Verification email failed:", err.code); setError(err.message || "Không thể gửi email xác minh. Hãy thử lại sau."); }
    });
    signOutButton.addEventListener("click", async () => {
        startSessionCheck();
        try { await signOut(auth); }
        catch (err) { console.error("Firebase sign-out failed:", err); document.body.classList.remove("auth-pending"); setError("Không thể đăng xuất. Hãy kiểm tra kết nối rồi thử lại."); }
    });
    modeButtons.forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
    switchButton?.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
    if (registrationAllowed) setAuthMode("login");
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            // Replace the current history entry after a sign-out. Pressing
            // Back cannot restore a protected tag/detail route for login.
            resetToLibraryRoute({ redirect: true });
            appShell.hidden = true;
            gate.hidden = false;
            await finishSessionCheck();
            return;
        }
        await revealApp(user);
    });
}

export async function getIdToken() {
    const user = auth.currentUser;
    if (!user || !user.emailVerified) throw new Error("Bạn cần xác minh email trước.");
    return user.getIdToken(true);
}
