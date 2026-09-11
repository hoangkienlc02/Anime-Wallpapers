import { auth } from "./firebase-config.js";
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Both pages stay hidden until Firebase has restored a valid signed-in user.
export function protectPage(onReady) {
    const gate = document.getElementById("authGate");
    const appShell = document.getElementById("appShell");
    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const error = document.getElementById("loginError");
    const signOutButton = document.getElementById("signOutButton");
    const accountLabel = document.getElementById("accountLabel");
    let hasStarted = false;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        try {
            await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
            passwordInput.value = "";
        } catch (err) {
            console.error("Firebase sign-in failed:", err.code, err.message);
            const messages = {
                "auth/invalid-credential": "Email hoặc mật khẩu Firebase Authentication không đúng.",
                "auth/user-not-found": "Không tìm thấy user này trong Firebase Authentication.",
                "auth/wrong-password": "Mật khẩu Firebase Authentication không đúng.",
                "auth/operation-not-allowed": "Email/Password chưa được bật trong Firebase Authentication.",
                "auth/unauthorized-domain": "Domain hiện tại chưa được cho phép trong Firebase Authentication.",
                "auth/network-request-failed": "Không kết nối được tới Firebase. Hãy kiểm tra mạng hoặc tiện ích chặn quảng cáo.",
                "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Chờ vài phút rồi thử lại."
            };
            error.textContent = messages[err.code] || `Không thể đăng nhập (${err.code || "lỗi không xác định"}).`;
        }
    });

    signOutButton.addEventListener("click", () => signOut(auth));

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            appShell.hidden = true;
            gate.hidden = false;
            return;
        }

        gate.hidden = true;
        appShell.hidden = false;
        accountLabel.textContent = user.email || "Đã đăng nhập";

        if (!hasStarted) {
            hasStarted = true;
            await onReady(user);
        }
    });
}

export async function getIdToken() {
    if (!auth.currentUser) throw new Error("Bạn cần đăng nhập trước.");
    return auth.currentUser.getIdToken();
}
