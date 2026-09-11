import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { protectPage } from "./auth-gate.js";

let allImages = [];
let filteredImages = [];
let currentPage = 1;
const itemsPerPage = 20;

function getOptimizedUrl(url) {
    if (!url || !url.includes("cloudinary")) return url;
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_800/");
}

function isVideo(item) {
    return item.type === "video" || /\.(mp4|mov)(\?|$)/i.test(item.url || "");
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
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.appendChild(makeAction("file_download", "Tải xuống", () => {
            window.downloadImage(item.url, `${item.subName || item.theme || "anime"}${video ? ".mp4" : ".jpg"}`);
        }));
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
        gallery.textContent = "Không thể tải thư viện. Hãy kiểm tra quyền truy cập Firebase.";
    }
}

const backToTop = document.getElementById("backToTop");
window.addEventListener("scroll", () => { backToTop.style.display = window.scrollY > 300 ? "flex" : "none"; });
backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "ArrowRight") goToPage(currentPage + 1);
    if (event.key === "ArrowLeft") goToPage(currentPage - 1);
});

protectPage(loadImages);
