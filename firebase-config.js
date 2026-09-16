import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { browserSessionPersistence, getAuth, initializeAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// These values identify the Firebase project; they are not server secrets.
// Access is protected by Firebase Authentication and Firestore Rules.
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAKYazmv5LhCsRUlgRoYm5RSHKuV5nT24A",
  authDomain: "images-web-8e8a0.firebaseapp.com",
  projectId: "images-web-8e8a0",
  storageBucket: "images-web-8e8a0.firebasestorage.app",
  messagingSenderId: "962206114668",
  appId: "1:962206114668:web:2178cd8a304abaddce8949",
  measurementId: "G-Q0XZ0TXTWM"
};


// The admin page uses a distinct Firebase app name and tab-only persistence.
// It therefore cannot overwrite the client session open in another tab.
const adminSurface = location.pathname.replace(/\/+$/, "") === "/admin";
const app = adminSurface
  ? initializeApp(firebaseConfig, "anime-wallpapers-admin")
  : initializeApp(firebaseConfig);

export const auth = adminSurface
  ? initializeAuth(app, { persistence: browserSessionPersistence })
  : getAuth(app);
export const db = getFirestore(app);
