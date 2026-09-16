# Anime Wallpapers

This is a private, authenticated wallpaper gallery. Any user who registers through the client login can view the library; the designated Firebase administrator is the only account allowed to upload, edit, delete, and manage albums.

## One-time secure setup

1. In **Firebase Authentication**, enable **Email/Password**. The client login provides account registration; keep the administrator account separate.
2. Copy the administrator account's UID into `firestore.rules` and Vercel's `ADMIN_UID`, then publish the rules in Firebase Console > Firestore Database > Rules. This is required before client accounts can load the library.
3. Copy `.env.example` into Vercel Project Settings > Environment Variables and fill in the real values. `CLOUDINARY_API_SECRET` must never appear in browser code.
4. Redeploy Vercel. Sign in at the homepage or `/admin` using your Firebase email and password.

The Vercel endpoints verify the Firebase ID token and the exact `ADMIN_UID` before issuing a Cloudinary upload signature or deleting an asset.

## Account security setup

The client now requires a verified email address before it can read the library. Publish the updated `firestore.rules` in **Firebase Console → Firestore Database → Rules**; editing this file alone does not change the live database rules.

In **Firebase Console → Authentication**:

1. Add the Vercel domain (and any local development domain) under **Settings → Authorized domains**, otherwise verification and password-reset links will fail.
2. In **Templates**, customize the email-verification and password-reset messages so users recognize them.
3. Enable email-enumeration protection if it is available on the project. The browser requires passwords to have at least 8 characters.

Unverified accounts cannot read the `photos` or `collections` data. Existing users, including the administrator, need to verify their email once before they can use the updated site.

## Profiles, favorites, and user management

After this update, the first successful verified login creates a `users/{uid}` profile. Favorites and download history are stored below that profile, so they follow the account across browsers. The administrator can view these profiles and block or unblock access from **Admin → User**. Blocking does not delete Firebase Authentication accounts or personal history; it only prevents the account from opening the library.

Before deploying this version, publish the new `firestore.rules`. Without that step, the profile, favorite/history synchronization, and admin user list will be denied by Firebase.

When an administrator deletes a user from the Admin page, the site deletes that person's profile, favorites, and download history, then stores a protected deletion record so the same Firebase UID cannot reopen the website. The Firebase Authentication identity itself is retained because deleting another Firebase Auth account requires server-side service-account credentials, which are intentionally not stored in this browser application.

## Backups and retention

Cloudinary, Firebase, and Vercel are third-party services; none should be treated as a permanent-storage guarantee. Keep original files in at least one separate backup location (external drive plus another cloud provider is a practical minimum). The admin page can export its Firestore metadata as JSON, but that export does not replace copies of the media files.

## Library pagination and Firestore cost

The default client view opens at **Mới nhất** and listens only to the newest 20 documents. Selecting the next page reads one more 20-document batch with a Firestore cursor, so a visitor who sees page one does not read the entire archive.

Global features that must search or order every document—search, game/anime tags, advanced filters, albums, saved items, and the non-default sort modes—load the full metadata list only when the visitor explicitly chooses that feature. This preserves accurate results without paying for a full-library realtime listener on every visit. The admin archive still loads the complete list deliberately because its dashboard and bulk-management tools require it.
