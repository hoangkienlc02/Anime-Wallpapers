import { auth } from "./firebase-config.js";
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const OWNER_UID = "aVIhWxMYfRNciqRmuNselJyi1MP2";

// Both pages stay hidden until Firebase has restored a valid signed-in user.
export function protectPage(onReady) {
    const gate = document.getElementById("authGate");
    const appShell = document.getElementById("appShell");
    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const confirmPasswordField = document.getElementById("confirmPasswordField");
    const submitButton = document.getElementById("authSubmitButton");
    const intro = document.getElementById("authIntro");
    const modeButtons = [...document.querySelectorAll("[data-auth-mode]")];
    const switchButton = document.getElementById("authSwitchButton");
    const error = document.getElementById("loginError");
    const signOutButton = document.getElementById("signOutButton");
    const accountLabel = document.getElementById("accountLabel");
    const registrationAllowed = !document.body.classList.contains("admin-page");
    let authMode = "login";
    let hasStarted = false;

    function setAuthMode(mode) {
        if (mode === "register" && !registrationAllowed) return;
        authMode = mode;
        const registering = mode === "register";
        if (confirmPasswordField) confirmPasswordField.hidden = !registering;
        if (confirmPasswordInput) confirmPasswordInput.required = registering;
        passwordInput.autocomplete = registering ? "new-password" : "current-password";
        intro.textContent = registering
            ? "Tạo tài khoản để lưu bộ sưu tập và mở kho hình nền của bạn."
            : "Đăng nhập để mở bộ sưu tập hình nền riêng của bạn.";
        submitButton.innerHTML = registering
            ? 'TẠO TÀI KHOẢN <span class="material-icons-outlined">person_add</span>'
            : 'MỞ KHO LƯU TRỮ <span class="material-icons-outlined">arrow_forward</span>';
        modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
        if (switchButton) switchButton.textContent = registering ? "ĐĂNG NHẬP" : "ĐĂNG KÝ NGAY";
        error.textContent = "";
    }

    function finishSessionCheck() {
        document.body.classList.remove("auth-pending");
    }

    async function revealApp(user) {
        if (!registrationAllowed && user.uid !== OWNER_UID) {
            error.textContent = "Tài khoản này không có quyền truy cập khu vực Quản trị.";
            await signOut(auth);
            finishSessionCheck();
            return;
        }
        gate.hidden = true;
        appShell.hidden = false;
        appShell.dataset.userRole = user.uid === OWNER_UID ? "admin" : "client";
        accountLabel.textContent = user.email || "Đã đăng nhập";
        finishSessionCheck();

        if (!hasStarted) {
            hasStarted = true;
            await onReady(user);
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        try {
            if (authMode === "register" && passwordInput.value !== confirmPasswordInput?.value) {
                error.textContent = "Mật khẩu nhập lại chưa khớp.";
                return;
            }
            const credential = authMode === "register"
                ? await createUserWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value)
                : await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
            passwordInput.value = "";
            if (confirmPasswordInput) confirmPasswordInput.value = "";
            // Reveal immediately; onAuthStateChanged below also handles restored sessions.
            await revealApp(credential.user);
        } catch (err) {
            console.error("Firebase sign-in failed:", err.code, err.message);
            const messages = {
                "auth/invalid-credential": "Email hoặc mật khẩu Firebase Authentication không đúng.",
                "auth/user-not-found": "Không tìm thấy user này trong Firebase Authentication.",
                "auth/wrong-password": "Mật khẩu Firebase Authentication không đúng.",
                "auth/operation-not-allowed": "Email/Password chưa được bật trong Firebase Authentication.",
                "auth/unauthorized-domain": "Domain hiện tại chưa được cho phép trong Firebase Authentication.",
                "auth/network-request-failed": "Không kết nối được tới Firebase. Hãy kiểm tra mạng hoặc tiện ích chặn quảng cáo.",
                "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Chờ vài phút rồi thử lại.",
                "auth/email-already-in-use": "Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.",
                "auth/weak-password": "Mật khẩu cần có tối thiểu 6 ký tự.",
                "auth/invalid-email": "Email chưa đúng định dạng."
            };
            error.textContent = messages[err.code] || `Không thể đăng nhập (${err.code || "lỗi không xác định"}).`;
        }
    });

    signOutButton.addEventListener("click", () => {
        document.body.classList.add("auth-pending");
        signOut(auth);
    });

    modeButtons.forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
    switchButton?.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
    if (registrationAllowed) setAuthMode("login");

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            appShell.hidden = true;
            gate.hidden = false;
            finishSessionCheck();
            return;
        }

        await revealApp(user);
    });
}

export async function getIdToken() {
    if (!auth.currentUser) throw new Error("Bạn cần đăng nhập trước.");
    return auth.currentUser.getIdToken();
}
