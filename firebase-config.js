import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { browserSessionPersistence, initializeAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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


// Session storage is isolated per browser tab. Using one Firebase app means an
// admin can open the library in the same tab without signing in again, while a
// client account open in another tab is never overwritten.
const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getFirestore(app);
