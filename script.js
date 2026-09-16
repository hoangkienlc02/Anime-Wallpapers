import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { getIdToken, protectPage } from "./auth-gate.js";

let allImages = [];
let filteredImages = [];
let currentPage = 1;
let selectedFiles = [];
let metadataDrafts = [];
let selectedPreviewIndex = 0;
let activeDetailItem = null;
const selectedAdminIds = new Set();
let adminCollections = [];
let activeCollectionPicker = null;
let collectionPickerIds = new Set();
let collectionPickerPage = 1;
const collectionPickerPerPage = 20;
const itemsPerPage = 20;
const PAGE_SKELETON_DURATION_MS = 240;
let paginationLoading = false;

const showToast = (message, type = "success") => {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = document.createElement("span");
    icon.className = "material-icons-outlined";
    icon.textContent = type === "success" ? "check_circle" : "error";
    toast.append(icon, document.createTextNode(message));
    document.getElementById("toast-container").appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 2700);
};

function getOptimizedUrl(url) {
    return url?.includes("cloudinary") ? url.replace("/upload/", "/upload/f_auto,q_auto,w_800/") : url;
}

function isVideo(item) {
    return item.type === "video" || /\.(mp4|mov)(\?|$)/i.test(item.url || "");
}

function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "Chưa có dữ liệu";
    const units = ["B", "KB", "MB", "GB"];
    const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function isMissingMetadata(item) {
    return !item.subName?.trim() || !item.seriesName?.trim() || !item.artistName?.trim();
}

function renderDashboard() {
    const images = allImages.filter((item) => !isVideo(item));
    const videos = allImages.length - images.length;
    const totalSize = allImages.reduce((sum, item) => sum + (Number(item.fileSizeBytes) || 0), 0);
    const top = (field) => [...allImages].sort((first, second) => (Number(second[field]) || 0) - (Number(first[field]) || 0))[0];
    const describeTop = (field, label) => {
        const item = top(field);
        return item && Number(item[field]) ? `${label}: ${item.subName || item.seriesName || item.theme || "Không tên"} (${item[field]})` : `${label}: —`;
    };
    document.getElementById("statTotal").textContent = allImages.length;
    document.getElementById("statMedia").textContent = `${images.length} ảnh · ${videos} video`;
    document.getElementById("statStorage").textContent = formatBytes(totalSize);
    document.getElementById("statMissing").textContent = allImages.filter(isMissingMetadata).length;
    document.getElementById("statTopViews").textContent = describeTop("views", "Xem");
    document.getElementById("statTopDownloads").textContent = describeTop("downloads", "Tải");
    document.getElementById("statTopLikes").textContent = describeTop("likes", "Thích");
}

function formatUsageValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

function usageDetail(metric, formatter = formatUsageValue) {
    if (metric?.usage == null) return "Cloudinary không trả về số liệu này";
    if (metric.limit == null) return `Đã dùng ${formatter(metric.usage)}`;
    return `Đã dùng ${formatter(metric.usage)} / ${formatter(metric.limit)}`;
}

function setUsageProgress(id, usage, limit) {
    const progress = document.getElementById(id);
    const used = Number(usage);
    const maximum = Number(limit);
    const percentage = Number.isFinite(used) && Number.isFinite(maximum) && maximum > 0
        ? Math.min(100, Math.max(0, (used / maximum) * 100))
        : 0;
    progress.querySelector("i").style.width = `${percentage}%`;
    progress.setAttribute("aria-valuenow", String(Math.round(percentage)));
    progress.classList.toggle("is-warning", percentage >= 75 && percentage < 90);
    progress.classList.toggle("is-critical", percentage >= 90);
}

async function loadCloudinaryUsage() {
    const refreshButton = document.getElementById("refreshCloudinaryUsage");
    refreshButton.disabled = true;
    try {
        const usage = await secureApi("/api/cloudinary-usage", {});
        const creditUsage = usage.credits?.usage;
        const creditLimit = usage.credits?.limit;
        const remainingCredits = creditUsage != null && creditLimit != null
            ? Math.max(0, creditLimit - creditUsage)
            : null;
        const creditEquivalentBytes = Number.isFinite(Number(creditLimit)) ? Number(creditLimit) * 1024 ** 3 : null;
        document.getElementById("cloudinaryPlan").textContent = `${usage.plan || "Cloudinary"} · QUOTA HIỆN TẠI`;
        document.getElementById("cloudinaryCredits").textContent = remainingCredits == null ? "—" : `${formatUsageValue(remainingCredits)} CREDITS`;
        document.getElementById("cloudinaryCreditsDetail").textContent = usageDetail(usage.credits);
        document.getElementById("cloudinaryStorage").textContent = usage.storage?.usage == null ? "—" : formatBytes(usage.storage.usage);
        document.getElementById("cloudinaryStorageDetail").textContent = usageDetail(usage.storage, formatBytes);
        document.getElementById("cloudinaryBandwidth").textContent = usage.bandwidth?.usage == null ? "—" : formatBytes(usage.bandwidth.usage);
        document.getElementById("cloudinaryBandwidthDetail").textContent = usageDetail(usage.bandwidth, formatBytes);
        document.getElementById("cloudinaryResources").textContent = usage.resources == null ? "—" : formatUsageValue(usage.resources);
        document.getElementById("cloudinaryUpdated").textContent = usage.updatedAt
            ? `Cập nhật: ${new Date(usage.updatedAt).toLocaleString("vi-VN")}`
            : "Số liệu Cloudinary cập nhật định kỳ";
        setUsageProgress("cloudinaryCreditsProgress", creditUsage, creditLimit);
        setUsageProgress("cloudinaryStorageProgress", usage.storage?.usage, usage.storage?.limit ?? creditEquivalentBytes);
        setUsageProgress("cloudinaryBandwidthProgress", usage.bandwidth?.usage, usage.bandwidth?.limit ?? creditEquivalentBytes);
    } catch (error) {
        console.error("Không thể tải Cloudinary usage:", error);
        document.getElementById("cloudinaryPlan").textContent = "KHÔNG THỂ TẢI CLOUDINARY USAGE";
        document.getElementById("cloudinaryCreditsDetail").textContent = "Kiểm tra Cloudinary API key/secret trên Vercel";
        ["cloudinaryCreditsProgress", "cloudinaryStorageProgress", "cloudinaryBandwidthProgress"].forEach((id) => setUsageProgress(id, 0, 1));
    } finally {
        refreshButton.disabled = false;
    }
}

function updateAdminSelectionControls() {
    const count = selectedAdminIds.size;
    document.getElementById("adminSelectionCount").textContent = count ? `${count} TỆP ĐÃ CHỌN` : "CHƯA CHỌN TỆP";
    document.getElementById("bulkEditButton").disabled = count === 0;
    document.getElementById("clearAdminSelection").hidden = count === 0;
}

async function loadAdminCollections() {
    try {
        const snapshot = await getDocs(collection(db, "collections"));
        adminCollections = snapshot.docs
            .map((document) => ({ id: document.id, ...document.data() }))
            .filter((item) => item.name)
            .sort((first, second) => String(first.name).localeCompare(String(second.name), "vi"));
    } catch (error) {
        adminCollections = [];
        console.warn("Không thể tải bộ sưu tập:", error);
    }
}

function makeCollectionAction(label, icon, handler, className = "secondary-action") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.innerHTML = `<span class="material-icons-outlined">${icon}</span> ${label}`;
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        handler(event);
    });
    return button;
}

function renderAdminCollections() {
    const list = document.getElementById("adminCollectionList");
    list.replaceChildren();
    if (!adminCollections.length) {
        const empty = document.createElement("p");
        empty.className = "collection-empty";
        empty.textContent = "Chưa có album. Tạo album đầu tiên để phân loại ảnh trong archive.";
        list.appendChild(empty);
        return;
    }
    adminCollections.forEach((collectionItem) => {
        const card = document.createElement("article");
        card.className = "admin-collection-card";
        const photoIds = (collectionItem.photoIds || []).filter((id) => allImages.some((item) => item.id === id));
        const coverItem = photoIds.map((id) => allImages.find((item) => item.id === id)).find(Boolean);
        const cover = document.createElement(coverItem && isVideo(coverItem) ? "video" : "img");
        cover.className = "admin-collection-cover";
        if (coverItem) {
            cover.src = isVideo(coverItem) ? coverItem.url : getOptimizedUrl(coverItem.url);
            if (cover instanceof HTMLVideoElement) { cover.muted = true; cover.playsInline = true; }
        } else {
            cover.src = "logo.jpg";
            cover.alt = "Album chưa có ảnh";
        }
        const info = document.createElement("div");
        info.className = "admin-collection-info";
        const title = document.createElement("h3");
        title.textContent = collectionItem.name;
        const description = document.createElement("p");
        description.textContent = collectionItem.description || "Chưa có mô tả.";
        const count = document.createElement("small");
        count.textContent = `${photoIds.length} ảnh`;
        info.append(title, description, count);
        const actions = document.createElement("div");
        actions.className = "admin-collection-actions";
        actions.append(
            makeCollectionAction("CHỌN ẢNH", "photo_library", () => openCollectionPicker(collectionItem)),
            makeCollectionAction("XÓA ALBUM", "delete_outline", () => deleteAdminCollection(collectionItem), "danger-action")
        );
        card.append(cover, info, actions);
        card.addEventListener("click", () => openCollectionPicker(collectionItem));
        list.appendChild(card);
    });
}

async function updateCollectionItems(collectionItem, shouldAdd) {
    if (!selectedAdminIds.size) return showToast("Hãy chọn ít nhất một ảnh trong Nội dung đã lưu trước.", "error");
    const selectedIds = [...selectedAdminIds];
    const existing = collectionItem.photoIds || [];
    const photoIds = shouldAdd ? [...new Set([...existing, ...selectedIds])] : existing.filter((id) => !selectedAdminIds.has(id));
    if (photoIds.length === existing.length && shouldAdd) return showToast("Các ảnh đã chọn đều có trong album này.", "error");
    try {
        await updateDoc(doc(db, "collections", collectionItem.id), { photoIds });
        collectionItem.photoIds = photoIds;
        renderAdminCollections();
        showToast(shouldAdd ? `Đã thêm ${selectedIds.length} ảnh vào “${collectionItem.name}”.` : `Đã gỡ ảnh đã chọn khỏi “${collectionItem.name}”.`);
    } catch (error) {
        console.error(error);
        showToast("Không thể cập nhật album. Hãy kiểm tra Firestore Rules.", "error");
    }
}

function itemMatchesCollectionSearch(item, term) {
    return [item.device, item.theme, item.subName, item.seriesName, item.artistName]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(term);
}

function renderCollectionPicker() {
    const grid = document.getElementById("collectionPickerGrid");
    const count = document.getElementById("collectionPickerCount");
    const queryText = document.getElementById("collectionPickerSearch").value.trim().toLocaleLowerCase("vi");
    grid.replaceChildren();
    document.getElementById("collectionPickerPagination").replaceChildren();
    if (!activeCollectionPicker) return;
    const matchingImages = allImages.filter((item) => !queryText || itemMatchesCollectionSearch(item, queryText));
    const totalPages = Math.max(1, Math.ceil(matchingImages.length / collectionPickerPerPage));
    collectionPickerPage = Math.min(collectionPickerPage, totalPages);
    const pageImages = matchingImages.slice((collectionPickerPage - 1) * collectionPickerPerPage, collectionPickerPage * collectionPickerPerPage);
    count.textContent = `${collectionPickerIds.size} ẢNH ĐÃ CHỌN`;
    if (!matchingImages.length) {
        const empty = document.createElement("p");
        empty.className = "collection-empty";
        empty.textContent = "Không tìm thấy ảnh phù hợp trong archive.";
        grid.appendChild(empty);
        return;
    }
    pageImages.forEach((item) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "collection-picker-tile";
        tile.classList.toggle("is-selected", collectionPickerIds.has(item.id));
        tile.title = item.subName || item.seriesName || item.theme || "Wallpaper";
        const media = document.createElement(isVideo(item) ? "video" : "img");
        media.src = isVideo(item) ? item.url : getOptimizedUrl(item.url);
        media.alt = tile.title;
        if (media instanceof HTMLVideoElement) { media.muted = true; media.playsInline = true; media.preload = "metadata"; }
        const check = document.createElement("span");
        check.className = "collection-picker-check material-icons-outlined";
        check.textContent = collectionPickerIds.has(item.id) ? "check_circle" : "add_circle_outline";
        tile.append(media, check);
        tile.addEventListener("click", () => {
            if (collectionPickerIds.has(item.id)) collectionPickerIds.delete(item.id);
            else collectionPickerIds.add(item.id);
            renderCollectionPicker();
        });
        grid.appendChild(tile);
    });
    renderCollectionPickerPagination(totalPages);
}

function renderCollectionPickerPagination(totalPages) {
    const container = document.getElementById("collectionPickerPagination");
    container.replaceChildren();
    if (totalPages <= 1) return;
    const addButton = (label, page, disabled = false, active = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `page-btn ${active ? "active" : ""}`;
        button.innerHTML = label;
        button.disabled = disabled;
        button.addEventListener("click", () => {
            collectionPickerPage = page;
            renderCollectionPicker();
        });
        container.appendChild(button);
    };
    addButton('<span class="material-icons-outlined">chevron_left</span>', collectionPickerPage - 1, collectionPickerPage === 1);
    const pages = [...new Set([1, collectionPickerPage - 1, collectionPickerPage, collectionPickerPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))]
        .sort((first, second) => first - second);
    pages.forEach((page, index) => {
        if (index && page - pages[index - 1] > 1) {
            const dots = document.createElement("span");
            dots.className = "pagination-dots";
            dots.textContent = "…";
            container.appendChild(dots);
        }
        addButton(String(page), page, false, page === collectionPickerPage);
    });
    addButton('<span class="material-icons-outlined">chevron_right</span>', collectionPickerPage + 1, collectionPickerPage === totalPages);
}

function openCollectionPicker(collectionItem) {
    activeCollectionPicker = collectionItem;
    collectionPickerIds = new Set((collectionItem.photoIds || []).filter((id) => allImages.some((item) => item.id === id)));
    collectionPickerPage = 1;
    document.getElementById("collectionPickerTitle").textContent = collectionItem.name;
    document.getElementById("collectionPickerSearch").value = "";
    document.getElementById("collectionPickerModal").style.display = "flex";
    renderCollectionPicker();
}

function closeCollectionPicker() {
    document.getElementById("collectionPickerModal").style.display = "none";
    activeCollectionPicker = null;
    collectionPickerIds.clear();
    collectionPickerPage = 1;
}
window.closeCollectionPicker = closeCollectionPicker;

async function saveCollectionPicker() {
    if (!activeCollectionPicker) return;
    const collectionName = activeCollectionPicker.name;
    const photoIds = [...collectionPickerIds];
    const saveButton = document.getElementById("collectionPickerSave");
    saveButton.disabled = true;
    try {
        await updateDoc(doc(db, "collections", activeCollectionPicker.id), { photoIds });
        activeCollectionPicker.photoIds = photoIds;
        renderAdminCollections();
        closeCollectionPicker();
        showToast(`Đã cập nhật album “${collectionName}”.`);
    } catch (error) {
        console.error(error);
        showToast("Không thể cập nhật album. Hãy kiểm tra Firestore Rules.", "error");
    } finally {
        saveButton.disabled = false;
    }
}

async function attachUploadedPhotoToCollection(photoId, collectionId) {
    if (!collectionId) return;
    const collectionItem = adminCollections.find((item) => item.id === collectionId);
    if (!collectionItem) return;
    const photoIds = [...new Set([...(collectionItem.photoIds || []), photoId])];
    await updateDoc(doc(db, "collections", collectionId), { photoIds });
    collectionItem.photoIds = photoIds;
}

async function createAdminCollection(event) {
    event.preventDefault();
    const nameInput = document.getElementById("adminCollectionName");
    const descriptionInput = document.getElementById("adminCollectionDescription");
    const name = nameInput.value.trim();
    const description = descriptionInput.value.trim();
    if (!name) return;
    if (adminCollections.some((item) => item.name.trim().toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
        return showToast("Album cùng tên đã tồn tại.", "error");
    }
    try {
        const reference = await addDoc(collection(db, "collections"), { name, description, photoIds: [], createdAt: new Date() });
        adminCollections.push({ id: reference.id, name, description, photoIds: [] });
        adminCollections.sort((first, second) => first.name.localeCompare(second.name, "vi"));
        nameInput.value = "";
        descriptionInput.value = "";
        renderAdminCollections();
        if (selectedFiles.length) {
            metadataDrafts = captureMetadataDrafts();
            renderFileMetadataFields(selectedFiles);
        }
        showToast(`Đã tạo album “${name}”.`);
    } catch (error) {
        console.error(error);
        showToast("Không thể tạo album. Hãy publish Firestore Rules cho collections.", "error");
    }
}

async function deleteAdminCollection(collectionItem) {
    if (!confirm(`Xóa album “${collectionItem.name}”? Ảnh trong archive sẽ không bị xóa.`)) return;
    try {
        await deleteDoc(doc(db, "collections", collectionItem.id));
        adminCollections = adminCollections.filter((item) => item.id !== collectionItem.id);
        renderAdminCollections();
        showToast("Đã xóa album. Ảnh gốc vẫn được giữ nguyên.");
    } catch (error) {
        console.error(error);
        showToast("Không thể xóa album.", "error");
    }
}

function refreshDetailPanel() {
    const item = activeDetailItem;
    if (!item) return;
    document.getElementById("detailTitle").textContent = item.subName || item.seriesName || item.theme || "WALLPAPER";
    document.getElementById("detailTags").textContent = [item.device, item.theme].filter(Boolean).join(" · ") || "PRIVATE ARCHIVE";
    document.getElementById("detailCharacter").textContent = item.subName || "Chưa có dữ liệu";
    document.getElementById("detailSeries").textContent = item.seriesName || "Chưa có dữ liệu";
    document.getElementById("detailArtist").textContent = item.artistName || "Chưa có dữ liệu";
    document.getElementById("detailResolution").textContent = item.width && item.height ? `${item.width} × ${item.height}` : "Chưa có dữ liệu";
    document.getElementById("detailSize").textContent = formatBytes(item.fileSizeBytes);
    document.getElementById("detailViews").textContent = Number(item.views) || 0;
    document.getElementById("detailDownloads").textContent = Number(item.downloads) || 0;
    document.getElementById("detailLikes").textContent = Number(item.likes) || 0;
    document.getElementById("detailOpenOriginal").href = item.url;
}

window.openMediaDetails = (item) => {
    activeDetailItem = item;
    document.getElementById("lightbox-img").src = item.url;
    refreshDetailPanel();
    document.getElementById("lightbox").style.display = "flex";
};

window.closeMediaDetails = () => {
    document.getElementById("lightbox").style.display = "none";
    activeDetailItem = null;
};

async function secureApi(path, payload) {
    const token = await getIdToken();
    const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch {
        throw new Error(`Máy chủ upload trả về dữ liệu không hợp lệ (HTTP ${response.status}). Hãy kiểm tra Vercel API.`);
    }
    if (!response.ok) throw new Error(data.error || "Yêu cầu bảo mật thất bại.");
    return data;
}

window.downloadImage = async (url, filename) => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Download failed");
        const blobUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename || "wallpaper";
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
    } catch {
        showToast("Không thể tải trực tiếp; đang mở file gốc.", "error");
        window.open(url, "_blank", "noopener");
    }
};

const darkModeToggle = document.getElementById("darkModeToggle");
document.documentElement.dataset.theme = localStorage.getItem("theme") || "dark";
darkModeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = isDark ? "light" : "dark";
    localStorage.setItem("theme", isDark ? "light" : "dark");
});

async function getFileTechnicalMetadata(file) {
    const base = { fileSizeBytes: file.size };
    if (!/^(image|video)\//.test(file.type)) return base;
    const objectUrl = URL.createObjectURL(file);
    try {
        const dimensions = await new Promise((resolve) => {
            const media = file.type.startsWith("video/") ? document.createElement("video") : new Image();
            const readyEvent = file.type.startsWith("video/") ? "loadedmetadata" : "load";
            media.addEventListener(readyEvent, () => resolve({ width: media.videoWidth || media.naturalWidth, height: media.videoHeight || media.naturalHeight }), { once: true });
            media.addEventListener("error", () => resolve({}), { once: true });
            media.src = objectUrl;
        });
        return { ...base, ...dimensions };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function getFileHash(file) {
    if (!globalThis.crypto?.subtle) throw new Error("Trình duyệt không hỗ trợ kiểm tra tệp trùng. Hãy dùng Chrome/Edge bản mới.");
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadOneFile(file, metadata) {
    const { collectionId, ...photoMetadata } = metadata;
    const resourceType = file.type.startsWith("video/") ? "video" : "image";
    const signature = await secureApi("/api/upload-signature", { resourceType });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("api_key", signature.apiKey);
    formData.append("timestamp", signature.timestamp);
    formData.append("folder", signature.folder);
    formData.append("signature", signature.signature);

    const upload = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/${resourceType}/upload`, {
        method: "POST",
        body: formData
    });
    const responseText = await upload.text();
    let media;
    try {
        media = JSON.parse(responseText);
    } catch {
        throw new Error(`Cloudinary trả về dữ liệu không hợp lệ (HTTP ${upload.status}).`);
    }
    if (!upload.ok) throw new Error(media.error?.message || `Cloudinary từ chối tệp (HTTP ${upload.status}).`);

    try {
        const reference = await addDoc(collection(db, "photos"), {
            url: media.secure_url,
            publicId: media.public_id,
            type: resourceType,
            ...photoMetadata,
            createdAt: new Date()
        });
        return reference.id;
    } catch (error) {
        // Do not leave an inaccessible Cloudinary asset behind when Firestore rejects its metadata.
        try {
            await secureApi("/api/delete-media", { publicId: media.public_id, resourceType });
        } catch (cleanupError) {
            console.error("Không thể dọn file Cloudinary sau khi Firestore lỗi:", cleanupError);
        }
        throw error;
    }
}

function readFileMetadata(index) {
    const card = document.querySelector(`.file-metadata-card[data-file-index="${index}"]`);
    if (!card) return null;
    return {
        device: card.querySelector('[data-field="device"]').value.trim(),
        theme: card.querySelector('[data-field="theme"]').value.trim(),
        subName: card.querySelector('[data-field="subName"]').value.trim(),
        seriesName: card.querySelector('[data-field="seriesName"]').value.trim(),
        artistName: card.querySelector('[data-field="artistName"]').value.trim(),
        collectionId: card.querySelector('[data-field="collectionId"]')?.value || ""
    };
}

window.handleUpload = async () => {
    const files = [...selectedFiles];
    if (!files.length) {
        showToast("Hãy chọn ít nhất một tệp.", "error");
        return;
    }

    const maxSize = 100 * 1024 * 1024;
    const uploadQueue = [];
    const queuedHashes = new Set();
    const duplicateFiles = [];
    for (const [index, file] of files.entries()) {
        const validFile = /^(image|video)\//.test(file.type) && file.size <= maxSize;
        if (!validFile) {
            showToast(`Bỏ qua ${file.name}: chỉ nhận ảnh/video tối đa 100 MB.`, "error");
            continue;
        }
        const metadata = readFileMetadata(index);
        if (!metadata?.device || !metadata.theme) {
            showToast(`Hãy nhập Thiết bị và Chủ đề cho tệp ${index + 1}: ${file.name}`, "error");
            return;
        }
        let fileHash;
        try {
            fileHash = await getFileHash(file);
        } catch (error) {
            showToast(`${file.name}: ${error.message}`, "error");
            return;
        }
        if (queuedHashes.has(fileHash) || allImages.some((item) => item.fileHash === fileHash)) {
            duplicateFiles.push(file.name);
            continue;
        }
        queuedHashes.add(fileHash);
        uploadQueue.push({ file, metadata: { ...metadata, fileHash } });
    }
    if (!uploadQueue.length) {
        showToast(`Không có tệp mới để tải. ${duplicateFiles.length} tệp đã có trong archive.`, "error");
        return;
    }

    const uploadButton = document.getElementById("uploadButton");
    uploadButton.disabled = true;
    let succeeded = 0;
    const failures = [];
    const collectionFailures = [];
    try {
        for (const [index, item] of uploadQueue.entries()) {
            const { file, metadata } = item;
            uploadButton.innerHTML = `<span class="material-icons-outlined">cloud_upload</span> ĐANG TẢI ${index + 1}/${uploadQueue.length}`;
            try {
                const technicalMetadata = await getFileTechnicalMetadata(file);
                const photoId = await uploadOneFile(file, { ...metadata, ...technicalMetadata });
                try {
                    await attachUploadedPhotoToCollection(photoId, metadata.collectionId);
                } catch (collectionError) {
                    console.error(`Không thể thêm ${file.name} vào bộ sưu tập:`, collectionError);
                    collectionFailures.push(file.name);
                }
                succeeded += 1;
            } catch (error) {
                console.error(`Không thể tải ${file.name}:`, error);
                failures.push({ name: file.name, message: error.message || "Lỗi không xác định" });
            }
        }
        const failed = failures.length;
        if (succeeded) {
            showToast(`Đã lưu ${succeeded} tệp.`);
            resetUploadForm();
        }
        if (failed) {
            const firstFailure = failures[0];
            showToast(`${failed}/${uploadQueue.length} tệp không tải được. ${firstFailure.message}`, "error");
        }
        if (duplicateFiles.length) showToast(`Đã bỏ qua ${duplicateFiles.length} tệp trùng: ${duplicateFiles[0]}`, "error");
        if (collectionFailures.length) showToast(`${collectionFailures.length} tệp đã tải nhưng chưa được thêm vào bộ sưu tập.`, "error");
        await loadImages();
    } catch (error) {
        console.error(error);
        showToast(`Upload thất bại: ${error.message}`, "error");
    } finally {
        uploadButton.disabled = false;
        uploadButton.innerHTML = '<span class="material-icons-outlined">cloud_upload</span> ĐƯA VÀO ARCHIVE';
    }
};

function makeTag(text) {
    const tag = document.createElement("span");
    tag.className = "tag-label";
    tag.textContent = text;
    return tag;
}

function makeAction(icon, title, handler, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.className = className;
    const iconNode = document.createElement("span");
    iconNode.className = "material-icons-outlined";
    iconNode.textContent = icon;
    button.appendChild(iconNode);
    button.addEventListener("click", (event) => { event.stopPropagation(); handler(); });
    return button;
}

function renderGallerySkeleton() {
    const gallery = document.getElementById("gallery");
    gallery.replaceChildren();
    for (let index = 0; index < 9; index += 1) {
        const card = document.createElement("article");
        card.className = `card skeleton-card skeleton-card-${index % 3}`;
        card.setAttribute("aria-hidden", "true");
        card.appendChild(document.createElement("span"));
        gallery.appendChild(card);
    }
}

function renderGallery(data) {
    const gallery = document.getElementById("gallery");
    gallery.replaceChildren();
    if (!data.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Chưa có hình nền phù hợp.";
        gallery.appendChild(empty);
        return;
    }

    data.forEach((item) => {
        const video = isVideo(item);
        const card = document.createElement("article");
        card.className = `card ${item.device?.toLowerCase().includes("mobile") ? "mobile-view" : ""}`;
        const media = document.createElement(video ? "video" : "img");
        if (video) {
            media.src = item.url;
            media.muted = true;
            media.loop = true;
            media.playsInline = true;
            media.preload = "metadata";
            media.addEventListener("mouseenter", () => media.play());
            media.addEventListener("mouseleave", () => media.pause());
        } else {
            media.src = getOptimizedUrl(item.url);
            media.loading = "lazy";
            media.alt = item.subName || item.theme || "Anime wallpaper";
        }
        card.appendChild(media);

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "selection-toggle";
        selectButton.title = selectedAdminIds.has(item.id) ? "Bỏ chọn tệp" : "Chọn để sửa hàng loạt";
        selectButton.setAttribute("aria-label", selectButton.title);
        selectButton.classList.toggle("is-selected", selectedAdminIds.has(item.id));
        selectButton.innerHTML = `<span class="material-icons-outlined">${selectedAdminIds.has(item.id) ? "check_box" : "check_box_outline_blank"}</span>`;
        selectButton.addEventListener("click", (event) => {
            event.stopPropagation();
            if (selectedAdminIds.has(item.id)) selectedAdminIds.delete(item.id);
            else selectedAdminIds.add(item.id);
            goToPage(currentPage, { scroll: false });
        });
        card.appendChild(selectButton);

        const overlay = document.createElement("div");
        overlay.className = "card-overlay";
        const info = document.createElement("div");
        info.className = "card-info";
        info.append(makeTag(video ? "VIDEO" : item.device || "IMAGE"), makeTag(`#${item.theme || "Khác"}`));
        if (item.subName) info.appendChild(makeTag(item.subName));
        if (item.seriesName) info.appendChild(makeTag(item.seriesName));
        if (item.artistName) info.appendChild(makeTag(item.artistName));
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.append(
            makeAction("edit_note", "Sửa thông tin", () => window.editPhoto(item)),
            makeAction("file_download", "Tải xuống", () => window.downloadImage(item.url, `${item.subName || item.theme || "anime"}${video ? ".mp4" : ".jpg"}`)),
            makeAction("delete_sweep", "Xóa file", () => window.deletePhoto(item), "btn-del")
        );
        overlay.append(info, actions);
        card.appendChild(overlay);
        card.addEventListener("click", () => {
            if (video) window.open(item.url, "_blank", "noopener");
            else window.openMediaDetails(item);
        });
        gallery.appendChild(card);
    });
}

window.editPhoto = (item) => {
    document.getElementById("editId").value = item.id;
    document.getElementById("editDeviceInput").value = item.device || "";
    document.getElementById("editThemeInput").value = item.theme || "";
    document.getElementById("editNameInput").value = item.subName || "";
    document.getElementById("editSeriesInput").value = item.seriesName || "";
    document.getElementById("editArtistInput").value = item.artistName || "";
    document.getElementById("editModal").style.display = "flex";
};
window.closeEditModal = () => { document.getElementById("editModal").style.display = "none"; };
window.saveEdit = async () => {
    const id = document.getElementById("editId").value;
    const newData = {
        device: document.getElementById("editDeviceInput").value.trim(),
        theme: document.getElementById("editThemeInput").value.trim(),
        subName: document.getElementById("editNameInput").value.trim(),
        seriesName: document.getElementById("editSeriesInput").value.trim(),
        artistName: document.getElementById("editArtistInput").value.trim()
    };
    if (!newData.device || !newData.theme) return showToast("Thiết bị và chủ đề không được để trống.", "error");
    try {
        await updateDoc(doc(db, "photos", id), newData);
        const index = allImages.findIndex((item) => item.id === id);
        if (index >= 0) allImages[index] = { ...allImages[index], ...newData };
        filteredImages = [...allImages];
        window.closeEditModal();
        renderFilterTags();
        goToPage(currentPage, { scroll: false });
        showToast("Đã cập nhật thông tin.");
    } catch (error) {
        showToast("Không thể cập nhật. Hãy kiểm tra Firebase Rules.", "error");
    }
};

async function removeOne(item) {
    if (!item.publicId) throw new Error("Bản ghi cũ thiếu publicId; không thể xác nhận xóa file Cloudinary.");
    await secureApi("/api/delete-media", { publicId: item.publicId, resourceType: isVideo(item) ? "video" : "image" });
    await deleteDoc(doc(db, "photos", item.id));

    // Keep collection documents tidy: a deleted photo must not remain as a stale ID in albums.
    const affectedCollections = adminCollections.filter((collectionItem) => collectionItem.photoIds?.includes(item.id));
    try {
        await Promise.all(affectedCollections.map(async (collectionItem) => {
            const photoIds = collectionItem.photoIds.filter((photoId) => photoId !== item.id);
            await updateDoc(doc(db, "collections", collectionItem.id), { photoIds });
            collectionItem.photoIds = photoIds;
        }));
    } catch (error) {
        // The photo has already been deleted; retain a clear warning rather than reporting a false deletion failure.
        console.warn("Không thể dọn ID ảnh khỏi một số album:", error);
    }
}

window.deletePhoto = async (item) => {
    if (!confirm("Xóa vĩnh viễn file khỏi Cloudinary và thư viện?")) return;
    try {
        await removeOne(item);
        renderAdminCollections();
        showToast("Đã xóa file và bản ghi.");
        await loadImages();
    } catch (error) {
        console.error(error);
        showToast(`Chưa xóa: ${error.message}`, "error");
    }
};

window.deleteAllPhotos = async () => {
    if (!confirm("Xóa vĩnh viễn toàn bộ file Cloudinary và mọi bản ghi?")) return;
    try {
        const snapshot = [...allImages];
        for (const item of snapshot) await removeOne(item);
        showToast(`Đã xóa ${snapshot.length} tệp.`);
        await loadImages();
    } catch (error) {
        console.error(error);
        showToast(`Đã dừng xóa để bảo toàn dữ liệu còn lại: ${error.message}`, "error");
        await loadImages();
    }
};

function renderFilterTags() {
    const container = document.getElementById("dynamic-tags");
    container.replaceChildren();
    const allButton = document.createElement("button");
    allButton.className = "tag-btn active";
    allButton.textContent = `Tất cả (${allImages.length})`;
    allButton.addEventListener("click", () => window.filterByDynamicTag("all", allButton));
    container.appendChild(allButton);
    const counts = new Map();
    allImages.forEach(({ subName }) => {
        const name = subName?.trim();
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
    });
    [...counts.keys()].sort().forEach((name) => {
        const button = document.createElement("button");
        button.className = "tag-btn";
        button.append(document.createTextNode(`${name} `));
        const count = document.createElement("span");
        count.className = "tag-count";
        count.textContent = counts.get(name);
        button.appendChild(count);
        button.addEventListener("click", () => window.filterByDynamicTag(name.toLowerCase(), button));
        container.appendChild(button);
    });
}

window.filterByDynamicTag = (tag, button) => {
    document.querySelectorAll(".tag-btn, .filter-item").forEach((element) => element.classList.remove("active"));
    button?.classList.add("active");
    const term = tag.toLowerCase();
    filteredImages = term === "all" ? [...allImages] : allImages.filter((item) =>
        item.subName?.toLowerCase().includes(term) || item.device?.toLowerCase() === term || item.theme?.toLowerCase() === term
    );
    goToPage(1, { scroll: false });
};
window.filterByType = (type, button) => {
    document.querySelectorAll(".tag-btn, .filter-item").forEach((element) => element.classList.remove("active"));
    button?.classList.add("active");
    filteredImages = allImages.filter((item) => isVideo(item) === (type === "video"));
    goToPage(1, { scroll: false });
};
window.filterMissingMetadata = (button) => {
    document.querySelectorAll(".tag-btn, .filter-item").forEach((element) => element.classList.remove("active"));
    button?.classList.add("active");
    filteredImages = allImages.filter(isMissingMetadata);
    goToPage(1, { scroll: false });
};
window.filterImages = () => {
    const term = document.getElementById("searchInput").value.trim().toLowerCase();
    filteredImages = allImages.filter((item) => [item.device, item.theme, item.subName, item.seriesName, item.artistName].some((value) => value?.toLowerCase().includes(term)));
    goToPage(1, { scroll: false });
};

function openBulkEditModal() {
    if (!selectedAdminIds.size) return;
    document.getElementById("bulkEditHint").textContent = `Áp dụng cho ${selectedAdminIds.size} tệp. Chỉ các ô có nhập dữ liệu mới thay đổi.`;
    ["bulkDeviceInput", "bulkThemeInput", "bulkNameInput", "bulkSeriesInput", "bulkArtistInput"].forEach((id) => { document.getElementById(id).value = ""; });
    document.getElementById("bulkEditModal").style.display = "flex";
}

async function saveBulkEdit() {
    const fieldMap = {
        device: "bulkDeviceInput", theme: "bulkThemeInput", subName: "bulkNameInput",
        seriesName: "bulkSeriesInput", artistName: "bulkArtistInput"
    };
    const updates = Object.fromEntries(Object.entries(fieldMap)
        .map(([field, id]) => [field, document.getElementById(id).value.trim()])
        .filter(([, value]) => value));
    if (!Object.keys(updates).length) return showToast("Hãy nhập ít nhất một trường để cập nhật.", "error");
    const targets = allImages.filter((item) => selectedAdminIds.has(item.id));
    const saveButton = document.getElementById("bulkEditSave");
    saveButton.disabled = true;
    try {
        for (const item of targets) {
            await updateDoc(doc(db, "photos", item.id), updates);
        }
        selectedAdminIds.clear();
        document.getElementById("bulkEditModal").style.display = "none";
        showToast(`Đã cập nhật ${targets.length} tệp.`);
        await loadImages();
    } catch (error) {
        console.error(error);
        showToast("Không thể sửa hàng loạt. Hãy kiểm tra Firebase Rules.", "error");
    } finally {
        saveButton.disabled = false;
    }
}

window.goToPage = async function goToPage(page, { scroll = false, showSkeleton = false } = {}) {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    if (page < 1 || (totalPages > 0 && page > totalPages)) return;
    const pageChanged = currentPage !== page;
    if (paginationLoading) return;
    currentPage = page;
    if (showSkeleton && pageChanged) {
        paginationLoading = true;
        renderPagination();
        renderGallerySkeleton();
        await new Promise((resolve) => setTimeout(resolve, PAGE_SKELETON_DURATION_MS));
        paginationLoading = false;
    }
    renderGallery(filteredImages.slice((page - 1) * itemsPerPage, page * itemsPerPage));
    renderPagination();
    updateAdminSelectionControls();
    if (scroll) document.getElementById("adminArchive").scrollIntoView({ behavior: "smooth", block: "start" });
};
function renderPagination() {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    document.querySelectorAll(".gallery-pagination").forEach((container) => {
        container.replaceChildren();
        if (totalPages <= 1) return;
        const addButton = (label, page, disabled = false, active = false) => {
            const button = document.createElement("button");
            button.className = `page-btn ${active ? "active" : ""}`;
            button.innerHTML = label;
            button.disabled = disabled || paginationLoading;
            button.addEventListener("click", () => goToPage(page, { showSkeleton: true }));
            container.appendChild(button);
        };
        addButton('<span class="material-icons-outlined">chevron_left</span>', currentPage - 1, currentPage === 1);
        const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))]
            .sort((a, b) => a - b);
        pages.forEach((page, index) => {
            if (index && page - pages[index - 1] > 1) {
                const dots = document.createElement("span");
                dots.className = "pagination-dots";
                dots.textContent = "…";
                container.appendChild(dots);
            }
            addButton(String(page), page, false, page === currentPage);
        });
        addButton('<span class="material-icons-outlined">chevron_right</span>', currentPage + 1, currentPage === totalPages);
    });
}

async function loadImages() {
    const gallery = document.getElementById("gallery");
    renderGallerySkeleton();
    try {
        const [snapshot] = await Promise.all([
            getDocs(query(collection(db, "photos"), orderBy("createdAt", "desc"))),
            loadAdminCollections()
        ]);
        allImages = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        filteredImages = [...allImages];
        renderDashboard();
        renderAdminCollections();
        renderFilterTags();
        goToPage(1, { scroll: false });
        loadCloudinaryUsage();
    } catch (error) {
        console.error(error);
        gallery.textContent = "Không thể tải thư viện. Hãy kiểm tra Firebase Rules.";
    }
}

function addMetadataInput(card, labelText, field, placeholder, value = "", required = false) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value;
    input.dataset.field = field;
    input.required = required;
    label.appendChild(input);
    card.appendChild(label);
}

function addCollectionSelect(card, value = "") {
    const label = document.createElement("label");
    label.textContent = "THÊM VÀO BỘ SƯU TẬP";
    const select = document.createElement("select");
    select.dataset.field = "collectionId";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Chưa thêm vào album";
    select.appendChild(emptyOption);
    adminCollections.forEach((collectionItem) => {
        const option = document.createElement("option");
        option.value = collectionItem.id;
        option.textContent = collectionItem.name;
        option.selected = collectionItem.id === value;
        select.appendChild(option);
    });
    if (!adminCollections.length) {
        select.disabled = true;
        emptyOption.textContent = "Tạo album trước để lựa chọn";
    }
    label.appendChild(select);
    card.appendChild(label);
}

function captureMetadataDrafts() {
    return selectedFiles.map((_, index) => readFileMetadata(index) || { device: "", theme: "", subName: "", seriesName: "", artistName: "", collectionId: "" });
}

function syncFileInput() {
    const transfer = new DataTransfer();
    selectedFiles.forEach((file) => transfer.items.add(file));
    document.getElementById("imageInput").files = transfer.files;
}

function createFilePreview(file, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-metadata-thumbnail";
    button.dataset.fileIndex = index;
    button.title = `Xem trước ${file.name}`;
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("active", index === selectedPreviewIndex);
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "img");
    media.className = "file-metadata-preview";
    media.alt = file.name;
    media.muted = true;
    media.playsInline = true;
    media.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    media.src = objectUrl;
    const releaseUrl = () => URL.revokeObjectURL(objectUrl);
    media.addEventListener(file.type.startsWith("video/") ? "loadeddata" : "load", releaseUrl, { once: true });
    media.addEventListener("error", releaseUrl, { once: true });
    button.appendChild(media);
    button.addEventListener("click", () => window.selectUploadPreview(index));
    return button;
}

function renderFileMetadataFields(files) {
    const list = document.getElementById("fileMetadataList");
    list.replaceChildren();
    if (!files.length) {
        const empty = document.createElement("p");
        empty.className = "metadata-empty";
        empty.textContent = "Chọn tệp để nhập thông tin riêng cho từng ảnh hoặc video.";
        list.appendChild(empty);
        return;
    }

    files.forEach((file, index) => {
        const card = document.createElement("article");
        card.className = "file-metadata-card form-group";
        card.dataset.fileIndex = index;
        const heading = document.createElement("div");
        heading.className = "file-metadata-heading";
        heading.appendChild(createFilePreview(file, index));
        const title = document.createElement("div");
        title.className = "file-metadata-title";
        const order = document.createElement("span");
        order.textContent = `TỆP ${index + 1}`;
        const name = document.createElement("strong");
        name.textContent = file.name;
        title.append(order, name);
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-selected-file";
        removeButton.title = `Bỏ ${file.name} khỏi danh sách`;
        removeButton.setAttribute("aria-label", removeButton.title);
        removeButton.textContent = "×";
        removeButton.addEventListener("click", () => window.removeSelectedFile(index));
        heading.append(title, removeButton);
        card.appendChild(heading);
        const draft = metadataDrafts[index] || {};
        addMetadataInput(card, "THIẾT BỊ", "device", "Mobile hoặc PC", draft.device, true);
        addMetadataInput(card, "CHỦ ĐỀ", "theme", "Anime, Game...", draft.theme, true);
        addMetadataInput(card, "NHÂN VẬT / TÊN", "subName", "Ví dụ: Luffy, Jinx", draft.subName);
        addMetadataInput(card, "TÊN GAME / ANIME", "seriesName", "Ví dụ: Genshin Impact", draft.seriesName);
        addMetadataInput(card, "TÊN ARTIST", "artistName", "Ví dụ: Hiten", draft.artistName);
        addCollectionSelect(card, draft.collectionId);
        list.appendChild(card);
    });
}

function renderMainPreview() {
    const preview = document.getElementById("preview");
    const videoPreview = document.getElementById("videoPreview");
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    if (videoPreview.dataset.objectUrl) URL.revokeObjectURL(videoPreview.dataset.objectUrl);
    preview.removeAttribute("src");
    preview.removeAttribute("data-object-url");
    preview.style.display = "none";
    videoPreview.removeAttribute("src");
    videoPreview.removeAttribute("data-object-url");
    videoPreview.style.display = "none";

    const selectedFile = selectedFiles[selectedPreviewIndex];
    if (!selectedFile) return;
    const objectUrl = URL.createObjectURL(selectedFile);
    if (selectedFile.type.startsWith("video/")) {
        videoPreview.src = objectUrl;
        videoPreview.dataset.objectUrl = objectUrl;
        videoPreview.style.display = "block";
    } else {
        preview.src = objectUrl;
        preview.dataset.objectUrl = objectUrl;
        preview.style.display = "block";
    }
}

function refreshUploadSelection() {
    renderMainPreview();
    renderFileMetadataFields(selectedFiles);
    const selectedInfo = document.getElementById("selectedFilesInfo");
    const dropText = document.getElementById("dropText");
    if (!selectedFiles.length) {
        selectedInfo.textContent = "";
        dropText.style.display = "block";
        return;
    }
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const sizeInMb = (totalSize / 1024 / 1024).toFixed(totalSize >= 10 * 1024 * 1024 ? 0 : 1);
    selectedInfo.textContent = `${selectedFiles.length} tệp đã chọn · ${sizeInMb} MB · xem trước tệp ${selectedPreviewIndex + 1}`;
    dropText.style.display = "none";
}

window.selectUploadPreview = (index) => {
    if (!selectedFiles[index]) return;
    selectedPreviewIndex = index;
    renderMainPreview();
    document.querySelectorAll(".file-metadata-thumbnail").forEach((thumbnail) => {
        thumbnail.classList.toggle("active", Number(thumbnail.dataset.fileIndex) === index);
    });
    refreshUploadSelectionInfo();
};

function refreshUploadSelectionInfo() {
    const selectedInfo = document.getElementById("selectedFilesInfo");
    if (!selectedFiles.length) {
        selectedInfo.textContent = "";
        return;
    }
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const sizeInMb = (totalSize / 1024 / 1024).toFixed(totalSize >= 10 * 1024 * 1024 ? 0 : 1);
    selectedInfo.textContent = `${selectedFiles.length} tệp đã chọn · ${sizeInMb} MB · xem trước tệp ${selectedPreviewIndex + 1}`;
}

window.removeSelectedFile = (index) => {
    metadataDrafts = captureMetadataDrafts();
    selectedFiles.splice(index, 1);
    metadataDrafts.splice(index, 1);
    if (index < selectedPreviewIndex) selectedPreviewIndex -= 1;
    selectedPreviewIndex = Math.min(selectedPreviewIndex, Math.max(0, selectedFiles.length - 1));
    syncFileInput();
    refreshUploadSelection();
};

function resetUploadForm() {
    selectedFiles = [];
    metadataDrafts = [];
    selectedPreviewIndex = 0;
    document.getElementById("imageInput").value = "";
    refreshUploadSelection();
}

document.getElementById("imageInput").addEventListener("change", (event) => {
    selectedFiles = [...event.target.files];
    metadataDrafts = [];
    selectedPreviewIndex = 0;
    refreshUploadSelection();
});

document.getElementById("missingMetadataFilter").addEventListener("click", (event) => window.filterMissingMetadata(event.currentTarget));
document.getElementById("selectFilteredButton").addEventListener("click", () => {
    filteredImages.forEach((item) => selectedAdminIds.add(item.id));
    goToPage(currentPage, { scroll: false });
});
document.getElementById("clearAdminSelection").addEventListener("click", () => {
    selectedAdminIds.clear();
    goToPage(currentPage, { scroll: false });
});
document.getElementById("bulkEditButton").addEventListener("click", openBulkEditModal);
document.getElementById("bulkEditCancel").addEventListener("click", () => { document.getElementById("bulkEditModal").style.display = "none"; });
document.getElementById("bulkEditSave").addEventListener("click", saveBulkEdit);
document.getElementById("importMetadataButton").addEventListener("click", () => document.getElementById("metadataImportInput").click());
document.getElementById("metadataImportInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await restoreMetadataFile(file);
    event.target.value = "";
});
document.getElementById("refreshCloudinaryUsage").addEventListener("click", loadCloudinaryUsage);

window.exportMetadata = () => {
    const metadataFields = ["id", "publicId", "type", "device", "theme", "subName", "seriesName", "artistName", "favorite", "views", "downloads", "likes", "width", "height", "fileSizeBytes", "fileHash"];
    const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        photos: allImages.map((item) => Object.fromEntries(metadataFields
            .filter((field) => Object.prototype.hasOwnProperty.call(item, field))
            .map((field) => [field, item[field]])))
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `anime-wallpaper-metadata-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Đã xuất metadata. Hãy sao lưu file này cùng các file gốc.");
};

async function restoreMetadataFile(file) {
    let backup;
    try {
        backup = JSON.parse(await file.text());
    } catch {
        showToast("File JSON không hợp lệ.", "error");
        return;
    }
    const records = Array.isArray(backup) ? backup : backup.photos;
    if (!Array.isArray(records)) {
        showToast("File sao lưu không có danh sách photos hợp lệ.", "error");
        return;
    }
    if (!confirm(`Khôi phục metadata cho các tệp khớp trong archive? File này có ${records.length} bản ghi. Ảnh trên Cloudinary sẽ không bị thay đổi.`)) return;
    const restorableFields = ["device", "theme", "subName", "seriesName", "artistName", "favorite", "views", "downloads", "likes", "width", "height", "fileSizeBytes", "fileHash"];
    let restored = 0;
    let skipped = 0;
    try {
        for (const record of records) {
            const target = allImages.find((item) => item.id === record.id || (record.publicId && item.publicId === record.publicId));
            if (!target) {
                skipped += 1;
                continue;
            }
            const updates = Object.fromEntries(restorableFields
                .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
                .map((field) => [field, record[field]]));
            if (!Object.keys(updates).length) {
                skipped += 1;
                continue;
            }
            await updateDoc(doc(db, "photos", target.id), updates);
            restored += 1;
        }
        showToast(`Đã khôi phục metadata cho ${restored} tệp${skipped ? `, bỏ qua ${skipped} tệp không khớp` : ""}.`);
        await loadImages();
    } catch (error) {
        console.error(error);
        showToast("Khôi phục bị dừng vì Firebase từ chối cập nhật.", "error");
    }
}

const backToTop = document.getElementById("backToTop");
window.addEventListener("scroll", () => { backToTop.style.display = window.scrollY > 300 ? "flex" : "none"; });
backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.getElementById("detailClose").addEventListener("click", window.closeMediaDetails);
document.getElementById("detailDownload").addEventListener("click", () => {
    if (!activeDetailItem) return;
    window.downloadImage(activeDetailItem.url, `${activeDetailItem.subName || activeDetailItem.seriesName || activeDetailItem.theme || "anime"}${isVideo(activeDetailItem) ? ".mp4" : ".jpg"}`);
});
document.getElementById("detailEdit").addEventListener("click", () => {
    if (!activeDetailItem) return;
    const item = activeDetailItem;
    window.closeMediaDetails();
    window.editPhoto(item);
});
document.getElementById("adminCollectionForm").addEventListener("submit", createAdminCollection);
document.getElementById("collectionPickerClose").addEventListener("click", closeCollectionPicker);
document.getElementById("collectionPickerCancel").addEventListener("click", closeCollectionPicker);
document.getElementById("collectionPickerSave").addEventListener("click", saveCollectionPicker);
document.getElementById("collectionPickerSearch").addEventListener("input", () => {
    collectionPickerPage = 1;
    renderCollectionPicker();
});
document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "ArrowRight") goToPage(currentPage + 1);
    if (event.key === "ArrowLeft") goToPage(currentPage - 1);
});

protectPage(loadImages);
