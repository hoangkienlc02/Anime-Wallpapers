import { addDoc, collection, doc, getDocs, increment, orderBy, query, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { protectPage } from "./auth-gate.js";

let allImages = [];
let filteredImages = [];
let currentPage = 1;
let sortMode = "featured";
let activeDetailItem = null;
let libraryCollections = [];
let collectionTargetItem = null;
const selectedImageIds = new Set();
const advancedFilters = { device: "", media: "", orientation: "", resolution: "", theme: "", character: "", series: "", artist: "" };
const itemsPerPage = 20;

const showToast = (message, type = "success") => {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = document.createElement("span");
    icon.className = "material-icons-outlined";
    icon.textContent = type === "success" ? "check_circle" : "error";
    toast.append(icon, document.createTextNode(message));
    document.getElementById("toast-container").appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 3000);
};

function getOptimizedUrl(url) {
    if (!url || !url.includes("cloudinary")) return url;
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_800/");
}

function isVideo(item) {
    return item.type === "video" || /\.(mp4|mov)(\?|$)/i.test(item.url || "");
}

function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("vi");
}

function itemMatchesText(item, term) {
    return [item.device, item.theme, item.subName, item.seriesName, item.artistName]
        .some((value) => normalize(value).includes(normalize(term)));
}

function getOrientation(item) {
    const width = Number(item.width);
    const height = Number(item.height);
    if (!width || !height) return "";
    if (Math.abs(width - height) / Math.max(width, height) < .04) return "square";
    return height > width ? "portrait" : "landscape";
}

function matchesResolution(item, level) {
    if (!level) return true;
    const longestSide = Math.max(Number(item.width) || 0, Number(item.height) || 0);
    const thresholds = { hd: 1280, fhd: 1920, qhd: 2560, uhd: 3840 };
    return longestSide >= thresholds[level];
}

function applyAdvancedFilters(items) {
    return items.filter((item) => {
        if (advancedFilters.device && normalize(item.device) !== advancedFilters.device) return false;
        if (advancedFilters.media && (advancedFilters.media === "video") !== isVideo(item)) return false;
        if (advancedFilters.orientation && getOrientation(item) !== advancedFilters.orientation) return false;
        if (advancedFilters.resolution && !matchesResolution(item, advancedFilters.resolution)) return false;
        if (advancedFilters.theme && normalize(item.theme) !== advancedFilters.theme) return false;
        if (advancedFilters.character && normalize(item.subName) !== advancedFilters.character) return false;
        if (advancedFilters.series && normalize(item.seriesName) !== advancedFilters.series) return false;
        if (advancedFilters.artist && normalize(item.artistName) !== advancedFilters.artist) return false;
        return true;
    });
}

function updateSelectionControls() {
    const count = selectedImageIds.size;
    const selectionCount = document.getElementById("selectionCount");
    const downloadButton = document.getElementById("downloadSelection");
    const clearButton = document.getElementById("clearSelection");
    selectionCount.textContent = count ? `${count} ẢNH ĐÃ CHỌN` : "CHƯA CHỌN ẢNH";
    downloadButton.disabled = count === 0;
    clearButton.hidden = count === 0;
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
    if (resultCount) resultCount.textContent = `${filteredImages.length} ẢNH`;
}

async function trackInteraction(item, field) {
    item[field] = (Number(item[field]) || 0) + 1;
    if (field === "downloads") localStorage.setItem(`anime-wallpaper-downloaded:${item.id}`, "true");
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

function isDownloaded(item) {
    return localStorage.getItem(`anime-wallpaper-downloaded:${item.id}`) === "true";
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
    const favoriteButton = document.getElementById("detailFavorite");
    const favorite = Boolean(item.favorite);
    favoriteButton.innerHTML = `<span class="material-icons-outlined">${favorite ? "bookmark" : "bookmark_border"}</span> ${favorite ? "ĐÃ LƯU YÊU THÍCH" : "LƯU YÊU THÍCH"}`;
    favoriteButton.classList.toggle("is-active", favorite);
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
    if (location.pathname.startsWith("/wallpaper/")) {
        history.pushState({}, "", "/wallpapers");
        renderRoute();
    }
};

window.openWallpaperPage = (item) => {
    history.pushState({}, "", `/wallpaper/${encodeURIComponent(item.id)}`);
    window.openMediaDetails(item);
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

async function toggleFavorite(item = activeDetailItem) {
    if (!item) return;
    const previous = Boolean(item.favorite);
    item.favorite = !previous;
    if (activeDetailItem?.id === item.id) refreshDetailPanel();
    document.querySelectorAll(`[data-favorite-id="${CSS.escape(item.id)}"]`).forEach((button) => {
        button.classList.toggle("is-favorite", item.favorite);
        button.innerHTML = `<span class="material-icons-outlined">${item.favorite ? "bookmark" : "bookmark_border"}</span>`;
    });
    try {
        await updateDoc(doc(db, "photos", item.id), { favorite: item.favorite });
        if (location.pathname === "/favorites") renderRoute();
        showToast(item.favorite ? "Đã lưu vào Yêu thích." : "Đã bỏ khỏi Yêu thích.");
    } catch (error) {
        item.favorite = previous;
        if (activeDetailItem?.id === item.id) refreshDetailPanel();
        showToast("Không thể cập nhật Yêu thích. Hãy kiểm tra Firebase Rules.", "error");
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

        const selectionButton = document.createElement("button");
        selectionButton.type = "button";
        selectionButton.className = "selection-toggle";
        selectionButton.dataset.selectId = item.id;
        selectionButton.title = selectedImageIds.has(item.id) ? "Bỏ chọn ảnh" : "Chọn ảnh để tải ZIP";
        selectionButton.setAttribute("aria-label", selectionButton.title);
        selectionButton.classList.toggle("is-selected", selectedImageIds.has(item.id));
        selectionButton.innerHTML = `<span class="material-icons-outlined">${selectedImageIds.has(item.id) ? "check_box" : "check_box_outline_blank"}</span>`;
        selectionButton.addEventListener("click", (event) => {
            event.stopPropagation();
            if (selectedImageIds.has(item.id)) selectedImageIds.delete(item.id);
            else selectedImageIds.add(item.id);
            renderGallery(filteredImages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage));
            updateSelectionControls();
        });
        card.appendChild(selectionButton);

        const overlay = document.createElement("div");
        overlay.className = "card-overlay";
        const info = document.createElement("div");
        info.className = "card-info";
        info.append(makeTag(video ? "VIDEO" : item.device || "IMAGE"), makeTag(`#${item.theme || "Khác"}`));
        if (item.subName) info.appendChild(makeTag(item.subName));
        if (item.seriesName) info.appendChild(makeTag(item.seriesName));
        const actions = document.createElement("div");
        actions.className = "actions";
        const favoriteButton = makeAction(item.favorite ? "bookmark" : "bookmark_border", item.favorite ? "Bỏ Yêu thích" : "Lưu Yêu thích", () => toggleFavorite(item));
        favoriteButton.classList.add("favorite-action");
        favoriteButton.dataset.favoriteId = item.id;
        favoriteButton.classList.toggle("is-favorite", Boolean(item.favorite));
        actions.appendChild(favoriteButton);
        actions.appendChild(makeAction("file_download", "Tải xuống", () => {
            trackInteraction(item, "downloads");
            window.downloadImage(item.url, `${item.subName || item.theme || "anime"}${video ? ".mp4" : ".jpg"}`);
        }));
        overlay.append(info, actions);
        card.appendChild(overlay);
        card.addEventListener("click", () => {
            trackInteraction(item, "views");
            if (video) window.open(item.url, "_blank", "noopener");
            else window.openWallpaperPage(item);
        });
        gallery.appendChild(card);
    });
}

function renderFilterTags() {
    // Metadata is filtered through the compact advanced-filter panel.
}

function renderCollectionTags() {
    const container = document.getElementById("collection-tags");
    if (!container) return;
    container.replaceChildren();
    if (!libraryCollections.length) return;
    const caption = document.createElement("span");
    caption.className = "filter-caption";
    caption.textContent = "BỘ SƯU TẬP";
    container.appendChild(caption);
    libraryCollections.forEach((collectionItem) => {
        const button = document.createElement("button");
        button.className = "tag-btn";
        button.dataset.collectionId = collectionItem.id;
        button.textContent = `${collectionItem.name} (${collectionItem.photoIds?.length || 0})`;
        button.addEventListener("click", () => navigateTo(`/collection/${encodeURIComponent(collectionItem.id)}`));
        container.appendChild(button);
    });
}

function filterByTerm(term, source = allImages) {
    if (term === "all") return [...source];
    const separator = term.indexOf(":");
    if (separator > 0) {
        const field = term.slice(0, separator).toLowerCase();
        const value = term.slice(separator + 1);
        const metadataFields = { theme: "theme", subname: "subName", seriesname: "seriesName", artistname: "artistName" };
        if (metadataFields[field]) {
            return source.filter((item) => normalize(item[metadataFields[field]]) === value);
        }
    }
    return source.filter((item) => itemMatchesText(item, term));
}

function populateSelect(selectId, field) {
    const select = document.getElementById(selectId);
    const selected = select.value;
    const firstOption = select.options[0].cloneNode(true);
    select.replaceChildren(firstOption);
    const values = [...new Set(allImages.map((item) => String(item[field] || "").trim()).filter(Boolean))]
        .sort((first, second) => first.localeCompare(second, "vi"));
    values.forEach((value) => {
        const option = document.createElement("option");
        option.value = normalize(value);
        option.textContent = value;
        select.appendChild(option);
    });
    select.value = selected;
}

function populateAdvancedFilters() {
    populateSelect("filterDevice", "device");
    populateSelect("filterTheme", "theme");
    populateSelect("filterCharacter", "subName");
    populateSelect("filterSeries", "seriesName");
    populateSelect("filterArtist", "artistName");
}

function syncAdvancedFilterControls() {
    const map = {
        filterDevice: "device", filterMedia: "media", filterOrientation: "orientation", filterResolution: "resolution",
        filterTheme: "theme", filterCharacter: "character", filterSeries: "series", filterArtist: "artist"
    };
    Object.entries(map).forEach(([id, key]) => { document.getElementById(id).value = advancedFilters[key]; });
}

function syncRouteControls(path, tag = "") {
    document.querySelectorAll(".nav-link, .tag-btn, .filter-item").forEach((element) => element.classList.remove("active"));
    document.querySelector(`[data-router-link][href="${path}"]`)?.classList.add("active");
    if (tag) document.querySelectorAll(`[data-tag="${CSS.escape(tag)}"]`).forEach((element) => element.classList.add("active"));
    const collectionId = path.startsWith("/collection/") ? path.slice("/collection/".length) : "";
    if (collectionId) document.querySelectorAll(`[data-collection-id="${CSS.escape(collectionId)}"]`).forEach((element) => element.classList.add("active"));
}

function renderRoute() {
    const path = decodeURIComponent(location.pathname.replace(/\/+$/, "")) || "/";
    if (path.startsWith("/collection/")) {
        history.replaceState({}, "", "/wallpapers");
        return renderRoute();
    }
    const queryText = new URLSearchParams(location.search).get("q")?.trim().toLowerCase() || "";
    const searchInput = document.getElementById("searchInput");
    let data = [...allImages];
    let activeTag = "";
    const detailId = path.startsWith("/wallpaper/") ? path.slice("/wallpaper/".length) : "";
    const detailItem = detailId ? allImages.find((item) => item.id === detailId) : null;

    if (!detailId && activeDetailItem) {
        document.getElementById("lightbox").style.display = "none";
        activeDetailItem = null;
    }

    if (detailId && !detailItem) {
        history.replaceState({}, "", "/wallpapers");
        return renderRoute();
    }
    if (detailId) data = data.filter((item) => item.id === detailId);
    else if (path === "/images") data = data.filter((item) => !isVideo(item));
    else if (path === "/videos") data = data.filter((item) => isVideo(item));
    else if (path === "/favorites") {
        activeTag = "favorites";
        data = data.filter((item) => item.favorite);
    } else if (path === "/downloads") {
        activeTag = "downloads";
        data = data.filter((item) => isDownloaded(item));
    } else if (path.startsWith("/tag/")) {
        activeTag = path.slice("/tag/".length).toLowerCase();
        data = filterByTerm(activeTag);
    } else if (path !== "/" && path !== "/wallpapers" && path !== "/search") {
        history.replaceState({}, "", "/wallpapers");
    }

    if (queryText) {
        activeTag = "";
        data = data.filter((item) => itemMatchesText(item, queryText));
    }

    searchInput.value = queryText;
    filteredImages = applySort(applyAdvancedFilters(data));
    syncRouteControls(path, activeTag || (path === "/" || path === "/wallpapers" ? "all" : ""));
    goToPage(1, { scroll: false });
    if (detailItem && !isVideo(detailItem)) window.openMediaDetails(detailItem);
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

window.filterBySaved = (type) => navigateTo(type === "downloads" ? "/downloads" : "/favorites");

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
    updateSelectionControls();
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

async function loadCollections() {
    try {
        const snapshot = await getDocs(collection(db, "collections"));
        libraryCollections = snapshot.docs
            .map((document) => ({ id: document.id, ...document.data() }))
            .filter((item) => item.name)
            .sort((first, second) => String(first.name).localeCompare(String(second.name), "vi"));
    } catch (error) {
        libraryCollections = [];
        console.warn("Không thể tải bộ sưu tập:", error);
    }
}

function renderCollectionModal() {
    const list = document.getElementById("collectionList");
    const hasTarget = Boolean(collectionTargetItem);
    document.getElementById("collectionModalTitle").textContent = hasTarget ? "LƯU ẢNH VÀO BỘ SƯU TẬP" : "QUẢN LÝ BỘ SƯU TẬP";
    document.getElementById("collectionModalHint").textContent = hasTarget
        ? `Chọn các album muốn lưu “${collectionTargetItem.subName || collectionTargetItem.theme || "Wallpaper"}”.`
        : "Tạo album mới để sắp xếp hình nền theo ý bạn.";
    document.getElementById("saveCollections").hidden = !hasTarget;
    list.replaceChildren();
    if (!libraryCollections.length) {
        const empty = document.createElement("p");
        empty.className = "collection-empty";
        empty.textContent = "Chưa có album nào. Hãy tạo album đầu tiên ở trên.";
        list.appendChild(empty);
        return;
    }
    libraryCollections.forEach((collectionItem) => {
        const row = document.createElement("label");
        row.className = "collection-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = collectionItem.id;
        checkbox.checked = Boolean(collectionTargetItem && collectionItem.photoIds?.includes(collectionTargetItem.id));
        checkbox.disabled = !hasTarget;
        const name = document.createElement("span");
        name.textContent = collectionItem.name;
        const total = document.createElement("small");
        total.textContent = `${collectionItem.photoIds?.length || 0} ảnh`;
        row.append(checkbox, name, total);
        list.appendChild(row);
    });
}

window.openCollectionModal = (item = null) => {
    collectionTargetItem = item;
    renderCollectionModal();
    document.getElementById("collectionModal").style.display = "flex";
    document.getElementById("newCollectionName").focus();
};

window.closeCollectionModal = () => {
    document.getElementById("collectionModal").style.display = "none";
    collectionTargetItem = null;
};

async function createCollection(event) {
    event.preventDefault();
    const input = document.getElementById("newCollectionName");
    const name = input.value.trim();
    if (!name) return;
    if (libraryCollections.some((item) => normalize(item.name) === normalize(name))) {
        showToast("Album này đã tồn tại.", "error");
        return;
    }
    try {
        const photoIds = collectionTargetItem ? [collectionTargetItem.id] : [];
        const reference = await addDoc(collection(db, "collections"), { name, photoIds });
        libraryCollections.push({ id: reference.id, name, photoIds });
        libraryCollections.sort((first, second) => first.name.localeCompare(second.name, "vi"));
        input.value = "";
        renderCollectionModal();
        renderCollectionTags();
        showToast(`Đã tạo album “${name}”.`);
    } catch (error) {
        console.error(error);
        showToast("Không thể tạo album. Hãy publish Firestore Rules mới.", "error");
    }
}

async function saveCollectionMembership() {
    if (!collectionTargetItem) return;
    const selectedIds = new Set([...document.querySelectorAll("#collectionList input:checked")].map((input) => input.value));
    const changedCollections = libraryCollections.filter((collectionItem) => {
        const currentlyIncluded = collectionItem.photoIds?.includes(collectionTargetItem.id);
        return currentlyIncluded !== selectedIds.has(collectionItem.id);
    });
    try {
        await Promise.all(changedCollections.map(async (collectionItem) => {
            const photoIds = collectionItem.photoIds || [];
            const shouldInclude = selectedIds.has(collectionItem.id);
            const updatedPhotoIds = shouldInclude ? [...new Set([...photoIds, collectionTargetItem.id])] : photoIds.filter((id) => id !== collectionTargetItem.id);
            await updateDoc(doc(db, "collections", collectionItem.id), { photoIds: updatedPhotoIds });
            collectionItem.photoIds = updatedPhotoIds;
        }));
        renderCollectionTags();
        if (location.pathname.startsWith("/collection/")) renderRoute();
        window.closeCollectionModal();
        showToast("Đã cập nhật bộ sưu tập.");
    } catch (error) {
        console.error(error);
        showToast("Không thể lưu album. Hãy publish Firestore Rules mới.", "error");
    }
}

function safeFilename(item, index) {
    const extension = isVideo(item) ? ".mp4" : ".jpg";
    const base = String(item.subName || item.seriesName || item.theme || `wallpaper-${index + 1}`)
        .replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
    return `${String(index + 1).padStart(2, "0")}-${base || "wallpaper"}${extension}`;
}

async function downloadSelectedAsZip() {
    const selectedItems = allImages.filter((item) => selectedImageIds.has(item.id));
    if (!selectedItems.length) return;
    if (!window.JSZip) {
        showToast("Không tải được công cụ ZIP. Kiểm tra kết nối mạng rồi thử lại.", "error");
        return;
    }
    if (selectedItems.length > 30) {
        showToast("Để trình duyệt ổn định, mỗi lần chỉ tải ZIP tối đa 30 tệp.", "error");
        return;
    }
    const button = document.getElementById("downloadSelection");
    button.disabled = true;
    const originalLabel = button.innerHTML;
    const zip = new window.JSZip();
    const failures = [];
    try {
        for (const [index, item] of selectedItems.entries()) {
            button.innerHTML = `<span class="material-icons-outlined">hourglass_top</span> ĐANG GÓI ${index + 1}/${selectedItems.length}`;
            try {
                const response = await fetch(item.url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                zip.file(safeFilename(item, index), await response.blob());
                trackInteraction(item, "downloads");
            } catch (error) {
                failures.push(item);
            }
        }
        if (!Object.keys(zip.files).length) throw new Error("Không tải được tệp nào từ Cloudinary.");
        button.innerHTML = '<span class="material-icons-outlined">archive</span> ĐANG TẠO ZIP';
        const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        const archiveUrl = URL.createObjectURL(archive);
        const link = document.createElement("a");
        link.href = archiveUrl;
        link.download = "anime-wallpapers-selection.zip";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(archiveUrl), 1000);
        showToast(failures.length ? `Đã tạo ZIP, nhưng bỏ qua ${failures.length} tệp lỗi.` : `Đã tạo ZIP gồm ${selectedItems.length} tệp.`);
    } catch (error) {
        console.error(error);
        showToast(`Không thể tạo ZIP: ${error.message}`, "error");
    } finally {
        button.disabled = selectedImageIds.size === 0;
        button.innerHTML = originalLabel;
    }
}

async function loadImages() {
    const gallery = document.getElementById("gallery");
    gallery.textContent = "Đang tải thư viện…";
    try {
        const snapshot = await getDocs(query(collection(db, "photos"), orderBy("createdAt", "desc")));
        allImages = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
        populateAdvancedFilters();
        syncAdvancedFilterControls();
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
    if (event.key === "Escape" && document.getElementById("collectionModal").style.display === "flex") return window.closeCollectionModal();
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
document.getElementById("detailShare").addEventListener("click", async () => {
    if (!activeDetailItem) return;
    const shareUrl = `${location.origin}/wallpaper/${encodeURIComponent(activeDetailItem.id)}`;
    try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Đã sao chép link ảnh.");
    } catch {
        window.prompt("Sao chép link ảnh này:", shareUrl);
    }
});
document.getElementById("detailLike").addEventListener("click", toggleLike);
document.getElementById("detailFavorite").addEventListener("click", () => toggleFavorite());
document.getElementById("detailOpenOriginal").addEventListener("click", () => {
    if (activeDetailItem) trackInteraction(activeDetailItem, "views");
});
document.getElementById("advancedFilterToggle").addEventListener("click", () => {
    const panel = document.getElementById("advancedFilters");
    panel.hidden = !panel.hidden;
    document.getElementById("advancedFilterToggle").classList.toggle("active", !panel.hidden);
});
const advancedFilterMap = {
    filterDevice: "device", filterMedia: "media", filterOrientation: "orientation", filterResolution: "resolution",
    filterTheme: "theme", filterCharacter: "character", filterSeries: "series", filterArtist: "artist"
};
Object.entries(advancedFilterMap).forEach(([id, key]) => {
    document.getElementById(id).addEventListener("change", (event) => {
        advancedFilters[key] = event.target.value;
        renderRoute();
    });
});
document.getElementById("clearAdvancedFilters").addEventListener("click", () => {
    Object.keys(advancedFilters).forEach((key) => { advancedFilters[key] = ""; });
    syncAdvancedFilterControls();
    renderRoute();
});
document.getElementById("collectionClose").addEventListener("click", window.closeCollectionModal);
document.getElementById("newCollectionForm").addEventListener("submit", createCollection);
document.getElementById("saveCollections").addEventListener("click", saveCollectionMembership);
document.getElementById("downloadSelection").addEventListener("click", downloadSelectedAsZip);
document.getElementById("clearSelection").addEventListener("click", () => {
    selectedImageIds.clear();
    goToPage(currentPage, { scroll: false });
    updateSelectionControls();
});
window.addEventListener("popstate", renderRoute);

protectPage(loadImages);
