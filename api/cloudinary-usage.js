const { requireAdmin, sendError } = require("./_auth");

function metric(source) {
    const usage = Number(source?.usage);
    const limit = Number(source?.limit);
    return {
        usage: Number.isFinite(usage) ? usage : null,
        limit: Number.isFinite(limit) && limit > 0 ? limit : null
    };
}

module.exports = async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
        await requireAdmin(req);
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        if (!cloudName || !apiKey || !apiSecret) throw new Error("Missing Cloudinary configuration");

        const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
            headers: { Authorization: `Basic ${authorization}` }
        });
        const data = await response.json();
        if (!response.ok) {
            const error = new Error("Cloudinary usage request failed");
            error.statusCode = 502;
            throw error;
        }

        // Return only display-safe usage totals. Never expose API keys, secrets, or raw account data.
        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).json({
            plan: typeof data.plan === "string" ? data.plan : "Cloudinary",
            updatedAt: typeof data.last_updated === "string" ? data.last_updated : null,
            credits: metric(data.credits),
            storage: metric(data.storage),
            bandwidth: metric(data.bandwidth),
            transformations: metric(data.transformations),
            resources: Number.isFinite(Number(data.resources?.usage ?? data.resources))
                ? Number(data.resources?.usage ?? data.resources)
                : null
        });
    } catch (error) {
        sendError(res, error);
    }
};
