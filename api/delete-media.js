const crypto = require("crypto");
const { requireAdmin, sendError } = require("./_auth");

function sign(params, secret) {
    const source = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
    return crypto.createHash("sha1").update(`${source}${secret}`).digest("hex");
}

module.exports = async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
        await requireAdmin(req);
        const { publicId, resourceType } = req.body || {};
        if (typeof publicId !== "string" || !publicId || publicId.length > 255 || !["image", "video"].includes(resourceType)) {
            return res.status(400).json({ error: "Thông tin file không hợp lệ." });
        }

        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        if (!cloudName || !apiKey || !apiSecret) throw new Error("Missing Cloudinary configuration");

        const timestamp = Math.floor(Date.now() / 1000);
        const params = { invalidate: true, public_id: publicId, timestamp };
        const body = new URLSearchParams({ ...params, api_key: apiKey, signature: sign(params, apiSecret) });
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body
        });
        const data = await response.json();

        if (!response.ok || !["ok", "not found"].includes(data.result)) {
            const error = new Error("Cloudinary delete failed");
            error.statusCode = 502;
            throw error;
        }
        res.status(200).json({ result: data.result });
    } catch (error) {
        sendError(res, error);
    }
};
