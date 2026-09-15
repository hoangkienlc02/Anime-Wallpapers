# Anime Wallpapers

This is a private, authenticated wallpaper gallery. Any user who registers through the client login can view the library; the designated Firebase administrator is the only account allowed to upload, edit, delete, and manage albums.

## One-time secure setup

1. In **Firebase Authentication**, enable **Email/Password**. The client login provides account registration; keep the administrator account separate.
2. Copy the administrator account's UID into `firestore.rules` and Vercel's `ADMIN_UID`, then publish the rules in Firebase Console > Firestore Database > Rules. This is required before client accounts can load the library.
3. Copy `.env.example` into Vercel Project Settings > Environment Variables and fill in the real values. `CLOUDINARY_API_SECRET` must never appear in browser code.
4. Redeploy Vercel. Sign in at the homepage or `/admin` using your Firebase email and password.

The Vercel endpoints verify the Firebase ID token and the exact `ADMIN_UID` before issuing a Cloudinary upload signature or deleting an asset.

## Backups and retention

Cloudinary, Firebase, and Vercel are third-party services; none should be treated as a permanent-storage guarantee. Keep original files in at least one separate backup location (external drive plus another cloud provider is a practical minimum). The admin page can export its Firestore metadata as JSON, but that export does not replace copies of the media files.
