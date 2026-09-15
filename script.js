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
const itemsPerPage = 20;

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

function updateAdminSelectionControls() {
    const count = selectedAdminIds.size;
    document.getElementById("adminSelectionCount").textContent = count ? `${count} TỆP ĐÃ CHỌN` : "CHƯA CHỌN TỆP";
    document.getElementById("bulkEditButton").disabled = count === 0;
    document.getElementById("clearAdminSelection").hidden = count === 0;
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
        await addDoc(collection(db, "photos"), {
            url: media.secure_url,
            publicId: media.public_id,
            type: resourceType,
            ...metadata,
            createdAt: new Date()
        });
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
        artistName: card.querySelector('[data-field="artistName"]').value.trim()
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
    try {
        for (const [index, item] of uploadQueue.entries()) {
            const { file, metadata } = item;
            uploadButton.innerHTML = `<span class="material-icons-outlined">cloud_upload</span> ĐANG TẢI ${index + 1}/${uploadQueue.length}`;
            try {
                const technicalMetadata = await getFileTechnicalMetadata(file);
                await uploadOneFile(file, { ...metadata, ...technicalMetadata });
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
}

window.deletePhoto = async (item) => {
    if (!confirm("Xóa vĩnh viễn file khỏi Cloudinary và thư viện?")) return;
    try {
        await removeOne(item);
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

window.goToPage = function goToPage(page, { scroll = true } = {}) {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    if (page < 1 || (totalPages > 0 && page > totalPages)) return;
    currentPage = page;
    renderGallery(filteredImages.slice((page - 1) * itemsPerPage, page * itemsPerPage));
    renderPagination();
    updateAdminSelectionControls();
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
};
function renderPagination() {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    const container = document.getElementById("pagination");
    container.replaceChildren();
    if (totalPages <= 1) return;
    const addButton = (label, page, disabled = false, active = false) => {
        const button = document.createElement("button");
        button.className = `page-btn ${active ? "active" : ""}`;
        button.innerHTML = label;
        button.disabled = disabled;
        button.addEventListener("click", () => goToPage(page));
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
}

async function loadImages() {
    const gallery = document.getElementById("gallery");
    gallery.textContent = "Đang tải thư viện…";
    try {
        const snapshot = await getDocs(query(collection(db, "photos"), orderBy("createdAt", "desc")));
        allImages = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        filteredImages = [...allImages];
        renderDashboard();
        renderFilterTags();
        goToPage(1, { scroll: false });
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

function captureMetadataDrafts() {
    return selectedFiles.map((_, index) => readFileMetadata(index) || { device: "", theme: "", subName: "", seriesName: "", artistName: "" });
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
document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "ArrowRight") goToPage(currentPage + 1);
    if (event.key === "ArrowLeft") goToPage(currentPage - 1);
});

protectPage(loadImages);
