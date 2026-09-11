import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { getIdToken, protectPage } from "./auth-gate.js";

let allImages = [];
let filteredImages = [];
let currentPage = 1;
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

    await addDoc(collection(db, "photos"), {
        url: media.secure_url,
        publicId: media.public_id,
        type: resourceType,
        ...metadata,
        createdAt: new Date()
    });
}

window.handleUpload = async () => {
    const fileInput = document.getElementById("imageInput");
    const device = document.getElementById("deviceInput").value.trim();
    const theme = document.getElementById("themeInput").value.trim();
    const subName = document.getElementById("nameInput").value.trim();
    const files = [...fileInput.files];
    if (!files.length || !device || !theme) {
        showToast("Hãy chọn tệp, nhập thiết bị và chủ đề.", "error");
        return;
    }

    const maxSize = 100 * 1024 * 1024;
    const validFiles = files.filter((file) => {
        const valid = /^(image|video)\//.test(file.type) && file.size <= maxSize;
        if (!valid) showToast(`Bỏ qua ${file.name}: chỉ nhận ảnh/video tối đa 100 MB.`, "error");
        return valid;
    });
    if (!validFiles.length) return;

    const uploadButton = document.getElementById("uploadButton");
    uploadButton.disabled = true;
    const metadata = { device, theme, subName };
    let succeeded = 0;
    const failures = [];
    try {
        for (const [index, file] of validFiles.entries()) {
            uploadButton.innerHTML = `<span class="material-icons-outlined">cloud_upload</span> ĐANG TẢI ${index + 1}/${validFiles.length}`;
            try {
                await uploadOneFile(file, metadata);
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
            showToast(`${failed} tệp lỗi. ${firstFailure.name}: ${firstFailure.message}`, "error");
        }
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

        const overlay = document.createElement("div");
        overlay.className = "card-overlay";
        const info = document.createElement("div");
        info.className = "card-info";
        info.append(makeTag(video ? "VIDEO" : item.device || "IMAGE"), makeTag(`#${item.theme || "Khác"}`));
        if (item.subName) info.appendChild(makeTag(item.subName));
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
            else {
                document.getElementById("lightbox-img").src = item.url;
                document.getElementById("lightbox").style.display = "flex";
            }
        });
        gallery.appendChild(card);
    });
}

window.editPhoto = (item) => {
    document.getElementById("editId").value = item.id;
    document.getElementById("editDeviceInput").value = item.device || "";
    document.getElementById("editThemeInput").value = item.theme || "";
    document.getElementById("editNameInput").value = item.subName || "";
    document.getElementById("editModal").style.display = "flex";
};
window.closeEditModal = () => { document.getElementById("editModal").style.display = "none"; };
window.saveEdit = async () => {
    const id = document.getElementById("editId").value;
    const newData = {
        device: document.getElementById("editDeviceInput").value.trim(),
        theme: document.getElementById("editThemeInput").value.trim(),
        subName: document.getElementById("editNameInput").value.trim()
    };
    if (!newData.device || !newData.theme) return showToast("Thiết bị và chủ đề không được để trống.", "error");
    try {
        await updateDoc(doc(db, "photos", id), newData);
        const index = allImages.findIndex((item) => item.id === id);
        if (index >= 0) allImages[index] = { ...allImages[index], ...newData };
        filteredImages = [...allImages];
        window.closeEditModal();
        renderFilterTags();
        goToPage(currentPage);
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
    goToPage(1);
};
window.filterByType = (type, button) => {
    document.querySelectorAll(".tag-btn, .filter-item").forEach((element) => element.classList.remove("active"));
    button?.classList.add("active");
    filteredImages = allImages.filter((item) => isVideo(item) === (type === "video"));
    goToPage(1);
};
window.filterImages = () => {
    const term = document.getElementById("searchInput").value.trim().toLowerCase();
    filteredImages = allImages.filter((item) => [item.device, item.theme, item.subName].some((value) => value?.toLowerCase().includes(term)));
    goToPage(1);
};

window.goToPage = function goToPage(page) {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    if (page < 1 || (totalPages > 0 && page > totalPages)) return;
    currentPage = page;
    renderGallery(filteredImages.slice((page - 1) * itemsPerPage, page * itemsPerPage));
    renderPagination();
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        renderFilterTags();
        goToPage(1);
    } catch (error) {
        console.error(error);
        gallery.textContent = "Không thể tải thư viện. Hãy kiểm tra Firebase Rules.";
    }
}

function resetUploadForm() {
    const preview = document.getElementById("preview");
    const videoPreview = document.getElementById("videoPreview");
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    if (videoPreview.dataset.objectUrl) URL.revokeObjectURL(videoPreview.dataset.objectUrl);
    document.getElementById("imageInput").value = "";
    document.getElementById("deviceInput").value = "";
    document.getElementById("themeInput").value = "";
    document.getElementById("nameInput").value = "";
    document.getElementById("selectedFilesInfo").textContent = "";
    preview.removeAttribute("src");
    preview.removeAttribute("data-object-url");
    preview.style.display = "none";
    videoPreview.removeAttribute("src");
    videoPreview.removeAttribute("data-object-url");
    videoPreview.style.display = "none";
    document.getElementById("dropText").style.display = "block";
}

document.getElementById("imageInput").addEventListener("change", (event) => {
    const files = [...event.target.files];
    const file = files[0];
    if (!file) return;
    const preview = document.getElementById("preview");
    const videoPreview = document.getElementById("videoPreview");
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    if (videoPreview.dataset.objectUrl) URL.revokeObjectURL(videoPreview.dataset.objectUrl);
    const objectUrl = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
        videoPreview.src = objectUrl;
        videoPreview.dataset.objectUrl = objectUrl;
        videoPreview.style.display = "block";
        preview.removeAttribute("data-object-url");
        preview.style.display = "none";
    } else {
        preview.src = objectUrl;
        preview.dataset.objectUrl = objectUrl;
        preview.style.display = "block";
        videoPreview.removeAttribute("data-object-url");
        videoPreview.style.display = "none";
    }
    const totalSize = files.reduce((sum, selectedFile) => sum + selectedFile.size, 0);
    const sizeInMb = (totalSize / 1024 / 1024).toFixed(totalSize >= 10 * 1024 * 1024 ? 0 : 1);
    document.getElementById("selectedFilesInfo").textContent = `${files.length} tệp đã chọn · ${sizeInMb} MB · xem trước tệp đầu tiên`;
    document.getElementById("dropText").style.display = "none";
});

window.exportMetadata = () => {
    const blob = new Blob([JSON.stringify(allImages, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `anime-wallpaper-metadata-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Đã xuất metadata. Hãy sao lưu file này cùng các file gốc.");
};

const backToTop = document.getElementById("backToTop");
window.addEventListener("scroll", () => { backToTop.style.display = window.scrollY > 300 ? "flex" : "none"; });
backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "ArrowRight") goToPage(currentPage + 1);
    if (event.key === "ArrowLeft") goToPage(currentPage - 1);
});

protectPage(loadImages);
