import { collection, doc, getDocs, increment, orderBy, query, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { protectPage } from "./auth-gate.js";

let allImages = [];
let filteredImages = [];
let currentPage = 1;
let sortMode = "featured";
let activeDetailItem = null;
const itemsPerPage = 20;

function getOptimizedUrl(url) {
    if (!url || !url.includes("cloudinary")) return url;
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_800/");
}

function isVideo(item) {
    return item.type === "video" || /\.(mp4|mov)(\?|$)/i.test(item.url || "");
}

function getCreatedTime(item) {
    if (typeof item.createdAt?.toMillis === "function") return item.createdAt.toMillis();
    return new Date(item.createdAt || 0).getTime() || 0;
}

function applySort(items) {
    return [...items].sort((first, second) => {
        const viewsFirst = Number(first.views) || 0;
        const viewsSecond = Number(second.views) || 0;
        const downloadsFirst = Number(first.downloads) || 0;
        const downloadsSecond = Number(second.downloads) || 0;
        const likesFirst = Number(first.likes) || 0;
        const likesSecond = Number(second.likes) || 0;
        if (sortMode === "views") return viewsSecond - viewsFirst || getCreatedTime(second) - getCreatedTime(first);
        if (sortMode === "downloads") return downloadsSecond - downloadsFirst || getCreatedTime(second) - getCreatedTime(first);
        if (sortMode === "featured") {
            return (viewsSecond + downloadsSecond * 2 + likesSecond * 3) - (viewsFirst + downloadsFirst * 2 + likesFirst * 3)
                || getCreatedTime(second) - getCreatedTime(first);
        }
        return getCreatedTime(second) - getCreatedTime(first);
    });
}

function updateResultCount() {
    const resultCount = document.getElementById("galleryResultCount");
    if (resultCount) resultCount.textContent = `${filteredImages.length} KẾT QUẢ`;
}

async function trackInteraction(item, field) {
    item[field] = (Number(item[field]) || 0) + 1;
    try {
        await updateDoc(doc(db, "photos", item.id), { [field]: increment(1) });
    } catch (error) {
        console.warn(`Không thể lưu lượt ${field}:`, error);
    }
}

function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "Chưa có dữ liệu";
    const units = ["B", "KB", "MB", "GB"];
    const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function isLiked(item) {
    return localStorage.getItem(`anime-wallpaper-liked:${item.id}`) === "true";
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
    const liked = isLiked(item);
    const likeButton = document.getElementById("detailLike");
    likeButton.innerHTML = `<span class="material-icons-outlined">${liked ? "favorite" : "favorite_border"}</span> ${liked ? "ĐÃ THÍCH" : "THÍCH"}`;
    document.getElementById("detailOpenOriginal").href = item.url;
}

async function hydrateDetailTechnicalMetadata(item) {
    if (item.width && item.height && item.fileSizeBytes) return;
    const updates = {};
    if (!item.width || !item.height) {
        const dimensions = await new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => resolve({});
            image.src = item.url;
        });
        Object.assign(updates, dimensions);
    }
    if (!item.fileSizeBytes) {
        try {
            const response = await fetch(item.url);
            if (response.ok) updates.fileSizeBytes = (await response.blob()).size;
        } catch {
            // Older assets may not permit fetching their original file size from the browser.
        }
    }
    if (!Object.keys(updates).length) return;
    Object.assign(item, updates);
    if (activeDetailItem?.id === item.id) refreshDetailPanel();
    try {
        await updateDoc(doc(db, "photos", item.id), updates);
    } catch (error) {
        console.warn("Không thể lưu thông tin kỹ thuật của ảnh cũ:", error);
    }
}

window.openMediaDetails = (item) => {
    activeDetailItem = item;
    document.getElementById("lightbox-img").src = item.url;
    refreshDetailPanel();
    document.getElementById("lightbox").style.display = "flex";
    hydrateDetailTechnicalMetadata(item);
};

window.closeMediaDetails = () => {
    document.getElementById("lightbox").style.display = "none";
    activeDetailItem = null;
};

async function toggleLike() {
    const item = activeDetailItem;
    if (!item) return;
    const liked = isLiked(item);
    item.likes = Math.max(0, (Number(item.likes) || 0) + (liked ? -1 : 1));
    localStorage.setItem(`anime-wallpaper-liked:${item.id}`, String(!liked));
    refreshDetailPanel();
    try {
        await updateDoc(doc(db, "photos", item.id), { likes: increment(liked ? -1 : 1) });
    } catch (error) {
        console.warn("Không thể lưu lượt thích:", error);
    }
}

window.downloadImage = async (url, filename) => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Download failed");
        const blobUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename || "wallpaper";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
    } catch {
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

function makeTag(text) {
    const tag = document.createElement("span");
    tag.className = "tag-label";
    tag.textContent = text;
    return tag;
}

function makeAction(icon, title, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    const iconElement = document.createElement("span");
    iconElement.className = "material-icons-outlined";
    iconElement.textContent = icon;
    button.appendChild(iconElement);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
    });
    return button;
}

function renderGallery(data) {
    const gallery = document.getElementById("gallery");
    gallery.replaceChildren();
    if (data.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Không tìm thấy hình nền phù hợp.";
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
        if (item.seriesName) info.appendChild(makeTag(item.seriesName));
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.appendChild(makeAction("file_download", "Tải xuống", () => {
            trackInteraction(item, "downloads");
            window.downloadImage(item.url, `${item.subName || item.theme || "anime"}${video ? ".mp4" : ".jpg"}`);
        }));
        overlay.append(info, actions);
        card.appendChild(overlay);
        card.addEventListener("click", () => {
            trackInteraction(item, "views");
            if (video) window.open(item.url, "_blank", "noopener");
            else window.openMediaDetails(item);
        });
        gallery.appendChild(card);
    });
}

function renderFilterTags() {
    const container = document.getElementById("dynamic-tags");
    container.replaceChildren();
    const allButton = document.createElement("button");
    allButton.className = "tag-btn active";
    allButton.dataset.tag = "all";
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
        button.dataset.tag = name.toLowerCase();
        button.append(document.createTextNode(`${name} `));
        const count = document.createElement("span");
        count.className = "tag-count";
        count.textContent = counts.get(name);
        button.appendChild(count);
        button.addEventListener("click", () => window.filterByDynamicTag(name.toLowerCase(), button));
        container.appendChild(button);
    });
}

function filterByTerm(term) {
    return term === "all" ? [...allImages] : allImages.filter((item) =>
        [item.subName, item.device, item.theme, item.seriesName, item.artistName].some((value) => value?.toLowerCase().includes(term))
    );
}

function syncRouteControls(path, tag = "") {
    document.querySelectorAll(".nav-link, .tag-btn, .filter-item").forEach((element) => element.classList.remove("active"));
    document.querySelector(`[data-router-link][href="${path}"]`)?.classList.add("active");
    if (tag) document.querySelectorAll(`[data-tag="${CSS.escape(tag)}"]`).forEach((element) => element.classList.add("active"));
}

function renderRoute() {
    const path = decodeURIComponent(location.pathname.replace(/\/+$/, "")) || "/";
    const queryText = new URLSearchParams(location.search).get("q")?.trim().toLowerCase() || "";
    const searchInput = document.getElementById("searchInput");
    let data = [...allImages];
    let activeTag = "";

    if (path === "/images") data = data.filter((item) => !isVideo(item));
    else if (path === "/videos") data = data.filter((item) => isVideo(item));
    else if (path.startsWith("/tag/")) {
        activeTag = path.slice("/tag/".length).toLowerCase();
        data = filterByTerm(activeTag);
    } else if (path !== "/" && path !== "/wallpapers" && path !== "/search") {
        history.replaceState({}, "", "/wallpapers");
    }

    if (queryText) {
        activeTag = "";
        data = data.filter((item) => [item.device, item.theme, item.subName, item.seriesName, item.artistName].some((value) => value?.toLowerCase().includes(queryText)));
    }

    searchInput.value = queryText;
    filteredImages = applySort(data);
    syncRouteControls(path, activeTag || (path === "/" || path === "/wallpapers" ? "all" : ""));
    goToPage(1, { scroll: false });
}

function navigateTo(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, "", path);
    else history.pushState({}, "", path);
    renderRoute();
}

window.filterByDynamicTag = (tag) => {
    const route = tag.toLowerCase() === "all" ? "/wallpapers" : `/tag/${encodeURIComponent(tag.toLowerCase())}`;
    navigateTo(route);
};

window.filterByType = (type) => navigateTo(type === "video" ? "/videos" : "/images");

window.filterImages = () => {
    const term = document.getElementById("searchInput").value.trim();
    navigateTo(term ? `/search?q=${encodeURIComponent(term)}` : "/wallpapers", { replace: true });
};

window.sortGallery = (mode, button) => {
    sortMode = mode;
    document.querySelectorAll(".sort-tab").forEach((tab) => tab.classList.remove("active"));
    button?.classList.add("active");
    filteredImages = applySort(filteredImages);
    goToPage(1, { scroll: false });
};

window.goToPage = function goToPage(page, { scroll = true } = {}) {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    if (page < 1 || (totalPages > 0 && page > totalPages)) return;
    currentPage = page;
    updateResultCount();
    renderGallery(filteredImages.slice((page - 1) * itemsPerPage, page * itemsPerPage));
    renderPagination();
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
        renderFilterTags();
        renderRoute();
    } catch (error) {
        console.error(error);
        gallery.textContent = "Không thể tải thư viện. Hãy kiểm tra quyền truy cập Firebase.";
    }
}

const backToTop = document.getElementById("backToTop");
window.addEventListener("scroll", () => { backToTop.style.display = window.scrollY > 300 ? "flex" : "none"; });
backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "Escape" && activeDetailItem) return window.closeMediaDetails();
    if (event.key === "ArrowRight") goToPage(currentPage + 1);
    if (event.key === "ArrowLeft") goToPage(currentPage - 1);
});

document.querySelectorAll("[data-router-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigateTo(link.getAttribute("href"));
    });
});
document.getElementById("detailClose").addEventListener("click", window.closeMediaDetails);
document.getElementById("detailDownload").addEventListener("click", () => {
    if (!activeDetailItem) return;
    trackInteraction(activeDetailItem, "downloads");
    window.downloadImage(activeDetailItem.url, `${activeDetailItem.subName || activeDetailItem.theme || "anime"}.jpg`);
    refreshDetailPanel();
});
document.getElementById("detailLike").addEventListener("click", toggleLike);
document.getElementById("detailOpenOriginal").addEventListener("click", () => {
    if (activeDetailItem) trackInteraction(activeDetailItem, "views");
});
window.addEventListener("popstate", renderRoute);

protectPage(loadImages);
