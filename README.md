# Anime Wallpapers

This gallery is intentionally private: only one Firebase Authentication user can read or modify `photos`.

## One-time secure setup

1. In **Firebase Authentication**, enable **Email/Password** and create your account. Do not enable public registration in the app.
2. Copy that account's UID into `firestore.rules`, then publish those rules in Firebase Console > Firestore Database > Rules.
3. Copy `.env.example` into Vercel Project Settings > Environment Variables and fill in the real values. `CLOUDINARY_API_SECRET` must never appear in browser code.
4. Redeploy Vercel. Sign in at the homepage or `/admin` using your Firebase email and password.

The Vercel endpoints verify the Firebase ID token and the exact `ADMIN_UID` before issuing a Cloudinary upload signature or deleting an asset.

## Backups and retention

Cloudinary, Firebase, and Vercel are third-party services; none should be treated as a permanent-storage guarantee. Keep original files in at least one separate backup location (external drive plus another cloud provider is a practical minimum). The admin page can export its Firestore metadata as JSON, but that export does not replace copies of the media files.
