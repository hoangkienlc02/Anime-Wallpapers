import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// These values identify the Firebase project; they are not server secrets.
// Access is protected by Firebase Authentication and Firestore Rules.
const firebaseConfig = {
    apiKey: "AIzaSyAKYazmv5LhCsRUlGRoYm5RSHKuV5nT24A",
    authDomain: "images-web-8e8a0.firebaseapp.com",
    projectId: "images-web-8e8a0",
    storageBucket: "images-web-8e8a0.firebasestorage.app",
    messagingSenderId: "962206114668",
    appId: "1:962206114668:web:2178cd8a304abaddce8949"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
