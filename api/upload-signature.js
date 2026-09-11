const crypto = require("crypto");
const { requireAdmin, sendError } = require("./_auth");

function cloudinarySignature(params, secret) {
    const source = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&");
    return crypto.createHash("sha1").update(`${source}${secret}`).digest("hex");
}

module.exports = async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
        await requireAdmin(req);
        const resourceType = req.body?.resourceType;
        if (resourceType !== "image" && resourceType !== "video") {
            return res.status(400).json({ error: "Loại tệp không hợp lệ." });
        }

        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        if (!cloudName || !apiKey || !apiSecret) throw new Error("Missing Cloudinary configuration");

        const timestamp = Math.floor(Date.now() / 1000);
        const folder = process.env.CLOUDINARY_FOLDER || "anime-wallpapers";
        const signature = cloudinarySignature({ folder, timestamp }, apiSecret);

        res.status(200).json({ cloudName, apiKey, timestamp, folder, signature });
    } catch (error) {
        sendError(res, error);
    }
};
