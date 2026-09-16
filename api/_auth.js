async function requireAdmin(req) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    const adminUid = process.env.ADMIN_UID;

    if (!token || !apiKey || !adminUid) {
        const error = new Error("Unauthorized");
        error.statusCode = 401;
        throw error;
    }

    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: token })
        }
    );
    const data = await response.json();
    const authenticatedUser = data.users?.[0];
    const uid = authenticatedUser?.localId;

    if (!response.ok || uid !== adminUid || authenticatedUser?.emailVerified !== true) {
        const error = new Error("Forbidden");
        error.statusCode = 403;
        throw error;
    }

    return uid;
}

function sendError(res, error) {
    res.status(error.statusCode || 500).json({ error: "Yêu cầu không hợp lệ hoặc máy chủ chưa được cấu hình." });
}

module.exports = { requireAdmin, sendError };
