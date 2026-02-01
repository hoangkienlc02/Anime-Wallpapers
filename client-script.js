import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CẤU HÌNH FIREBASE (Chỉ dùng quyền Read) ---
const firebaseConfig = {
    apiKey: "AIzaSyAKYazmv5LhCsRUlGRoYm5RSHKuV5nT24A",
    authDomain: "images-web-8e8a0.firebaseapp.com",
    projectId: "images-web-8e8a0",
    storageBucket: "images-web-8e8a0.firebasestorage.app",
    messagingSenderId: "962206114668",
    appId: "1:962206114668:web:2178cd8a304abaddce8949"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- BIẾN TOÀN CỤC ---
let allImages = [];
let filteredImages = [];
let currentPage = 1;
const itemsPerPage = 20;

// --- HÀM TIỆN ÍCH ---
function getOptimizedUrl(url) {
    if (!url || !url.includes('cloudinary')) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto,w_800/');
}

window.downloadImage = async (url, filename) => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename || 'wallpaper.jpg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
        window.open(url, '_blank'); 
    }
};

// --- DARK MODE ---
const darkModeToggle = document.getElementById('darkModeToggle');
if (localStorage.getItem('theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
darkModeToggle.onclick = () => {
    let isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
};

// --- HIỂN THỊ GALLERY ---
function renderGallery(data) {
    const gallery = document.getElementById('gallery');
    gallery.innerHTML = "";
    
    data.forEach(item => {
        const isMob = item.device?.toLowerCase().includes('mobile');
        const div = document.createElement('div');
        div.className = `card ${isMob ? 'mobile-view' : ''}`;
        
        div.innerHTML = `
            <img src="${getOptimizedUrl(item.url)}" loading="lazy">
            <div class="card-overlay">
                <div class="card-info">
                    <span class="tag-label">${item.device}</span>
                    <span class="tag-label">#${item.theme}</span>
                    ${item.subName ? `<span class="tag-label">${item.subName}</span>` : ''}
                </div>
                <div class="actions">
                    <button title="Tải xuống" onclick="event.stopPropagation(); downloadImage('${item.url}', '${item.subName || 'anime'}.jpg')">
                        <span class="material-icons-outlined">file_download</span>
                    </button>
                </div>
            </div>`;
            
        div.onclick = () => { 
            document.getElementById('lightbox-img').src = item.url; 
            document.getElementById('lightbox').style.display = 'flex'; 
        };
        gallery.appendChild(div);
    });
}

// --- LỌC VÀ TÌM KIẾM ---
function renderFilterTags() {
    const container = document.getElementById('dynamic-tags');
    container.innerHTML = `<button class="tag-btn active" onclick="filterByDynamicTag('all', this)">Tất cả (${allImages.length})</button>`;

    const nameCounts = {};
    allImages.forEach(img => {
        if (img.subName) {
            const name = img.subName.trim();
            if (name) nameCounts[name] = (nameCounts[name] || 0) + 1;
        }
    });

    Object.keys(nameCounts).sort().forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'tag-btn';
        btn.innerHTML = `${name} <span class="tag-count">${nameCounts[name]}</span>`;
        btn.onclick = () => filterByDynamicTag(name.toLowerCase(), btn);
        container.appendChild(btn);
    });
}

window.filterByDynamicTag = (tag, btn) => {
    // Xóa trạng thái active của TẤT CẢ các nút lọc
    document.querySelectorAll('.tag-btn, .filter-item').forEach(b => b.classList.remove('active'));
    
    // Thêm active cho nút vừa ấn
    if (btn) btn.classList.add('active');

    const term = tag.toLowerCase();

    if (term === 'all') {
        filteredImages = [...allImages];
    } else {
        // Logic lọc: Tìm trong subName, device hoặc theme
        filteredImages = allImages.filter(i => 
            i.subName?.toLowerCase().includes(term) ||
            i.device?.toLowerCase() === term || 
            i.theme?.toLowerCase() === term
        );
    }
    currentPage = 1;
    goToPage(1);
};

window.filterImages = () => {
    const term = document.getElementById('searchInput').value.toLowerCase();
    filteredImages = allImages.filter(i => 
        i.device?.toLowerCase().includes(term) || i.theme?.toLowerCase().includes(term) || i.subName?.toLowerCase().includes(term)
    );
    goToPage(1);
};

// --- PHÂN TRANG ---
window.goToPage = (page) => {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    if (page < 1 || (page > totalPages && totalPages > 0)) return;
    currentPage = page;
    const start = (currentPage - 1) * itemsPerPage;
    renderGallery(filteredImages.slice(start, start + itemsPerPage));
    renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function renderPagination() {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    const container = document.getElementById('pagination');
    container.innerHTML = '';

    // Nếu không có ảnh hoặc chỉ có 1 trang thì không hiện phân trang
    if (totalPages <= 1) return;

    // --- Nút TRƯỚC (Prev) ---
    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '<span class="material-icons-outlined">chevron_left</span>';
    prevBtn.className = `page-btn ${currentPage === 1 ? 'disabled' : ''}`;
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => goToPage(currentPage - 1);
    container.appendChild(prevBtn);

    // --- Logic hiển thị số trang và dấu ba chấm ---
    const range = 1; 
    let pages = [];
    pages.push(1);
    for (let i = currentPage - range; i <= currentPage + range; i++) {
        if (i > 1 && i < totalPages) pages.push(i);
    }
    if (totalPages > 1) pages.push(totalPages);
    pages = [...new Set(pages)].sort((a, b) => a - b);

    pages.forEach((page, index) => {
        if (index > 0 && page - pages[index - 1] > 1) {
            const dots = document.createElement('span');
            dots.innerText = '...';
            dots.className = 'pagination-dots';
            container.appendChild(dots);
        }

        const btn = document.createElement('button');
        btn.innerText = page;
        btn.className = `page-btn ${page === currentPage ? 'active' : ''}`;
        btn.onclick = () => goToPage(page);
        container.appendChild(btn);
    });

    // --- Nút SAU (Next) ---
    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = '<span class="material-icons-outlined">chevron_right</span>';
    nextBtn.className = `page-btn ${currentPage === totalPages ? 'disabled' : ''}`;
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => goToPage(currentPage + 1);
    container.appendChild(nextBtn);
}

// --- KHỞI TẠO ---
async function loadImages() {
    const q = query(collection(db, "photos"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    allImages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    filteredImages = [...allImages];
    renderFilterTags();
    goToPage(1);
}

loadImages();

// Nút Back to Top
const backToTop = document.getElementById('backToTop');
window.addEventListener('scroll', () => {
    backToTop.style.display = window.scrollY > 300 ? 'flex' : 'none';
});
backToTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// Logic cuộn mượt lên đầu
backToTop.onclick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

document.addEventListener('keydown', (e) => {
    // 1. Kiểm tra nếu người dùng đang gõ trong ô tìm kiếm hoặc ô nhập liệu thì bỏ qua
    const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    if (isTyping) return;

    // 2. Tính toán tổng số trang hiện tại
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);

    // 3. Xử lý sự kiện nhấn phím
    if (e.key === 'ArrowRight') {
        // Nếu nhấn mũi tên Phải -> Sang trang sau
        if (currentPage < totalPages) {
            goToPage(currentPage + 1);
        }
    } else if (e.key === 'ArrowLeft') {
        // Nếu nhấn mũi tên Trái -> Về trang trước
        if (currentPage > 1) {
            goToPage(currentPage - 1);
        }
    }
});
loadImages();