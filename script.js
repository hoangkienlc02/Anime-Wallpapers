import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, deleteDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CẤU HÌNH FIREBASE: Kết nối ứng dụng với Database ---
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
const CLOUD_NAME = "dunavbcxk"; // Tài khoản Cloudinary
const UPLOAD_PRESET = "my_web_preset"; // Cấu hình upload không cần ký duyệt

// --- BIẾN TOÀN CỤC: Lưu trữ dữ liệu tạm thời để xử lý nhanh ---
let allImages = [];         // Chứa toàn bộ ảnh từ Firebase
let filteredImages = [];    // Chứa ảnh sau khi đã lọc (tìm kiếm/tag)
let currentPage = 1;        // Trang hiện tại
const itemsPerPage = 20;    // Số lượng ảnh hiển thị trên mỗi trang

// --- HÀM TIỆN ÍCH (UTILS) ---
// Hiển thị thông báo nhỏ (Toast) ở góc màn hình
const showToast = (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="material-icons-outlined">${type === 'success' ? 'check_circle' : 'error'}</span> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2700);
};

// Tối ưu hóa URL ảnh: Tự động giảm dung lượng và định dạng phù hợp (Cloudinary Optimization)
function getOptimizedUrl(url) {
    if (!url || !url.includes('cloudinary')) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto,w_800/');
}

// Xử lý tải ảnh về máy: Chuyển đổi URL sang Blob để trình duyệt tự tải xuống
window.downloadImage = async (url, filename) => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename || 'download.jpg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
        showToast("Không thể tải ảnh xuống trực tiếp!", "error");
        window.open(url, '_blank'); 
    }
};

// --- CHẾ ĐỘ SÁNG/TỐI (DARK MODE) ---
const darkModeToggle = document.getElementById('darkModeToggle');
if (localStorage.getItem('theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
darkModeToggle.onclick = () => {
    let isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
};

// --- TẠO TAG TỰ ĐỘNG (DYNAMIC TAGS) ---
// Quét toàn bộ ảnh để lấy danh sách các Tag duy nhất và đếm số lượng
function renderFilterTags() {
    const container = document.getElementById('dynamic-tags');
    // Nút "Tất cả" luôn hiển thị đầu tiên
    container.innerHTML = `<button class="tag-btn active" onclick="filterByDynamicTag('all', this)">Tất cả (${allImages.length})</button>`;

    // 1. Đếm số lượng theo "Tên cụ thể" (subName)
    const nameCounts = {};
    
    allImages.forEach(img => {
        if (img.subName) {
            const name = img.subName.trim();
            if (name) {
                nameCounts[name] = (nameCounts[name] || 0) + 1;
            }
        }
    });

    // 2. Lấy danh sách tên đã sắp xếp theo bảng chữ cái
    const sortedNames = Object.keys(nameCounts).sort();

    // 3. Render các tag tên cụ thể kèm số lượng
    sortedNames.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'tag-btn';
        // Hiển thị định dạng: Tên (Số lượng)
        btn.innerHTML = `${name} <span class="tag-count">${nameCounts[name]}</span>`;
        
        btn.onclick = () => filterByDynamicTag(name.toLowerCase(), btn);
        container.appendChild(btn);
    });
}

// Lọc ảnh khi click vào một Tag cụ thể
window.filterByDynamicTag = (tag, btn) => {
    // Xóa class active ở cả sidebar và top-bar
    document.querySelectorAll('.tag-btn, .filter-item').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const term = tag.toLowerCase();

    if (term === 'all') {
        filteredImages = [...allImages];
    } else {
        // Lọc ưu tiên theo subName cho các tag ở top-bar 
        // và vẫn cho phép lọc theo device/theme cho các nút ở sidebar
        filteredImages = allImages.filter(i => 
            i.subName?.toLowerCase().includes(term) ||
            i.device?.toLowerCase() === term || 
            i.theme?.toLowerCase() === term
        );
    }
    goToPage(1);
};

// --- LOGIC PHÂN TRANG (PAGINATION) ---
window.goToPage = (page) => {
    const totalPages = Math.ceil(filteredImages.length / itemsPerPage);
    if (page < 1 || (page > totalPages && totalPages > 0)) return;
    
    currentPage = page;
    const start = (currentPage - 1) * itemsPerPage;
    renderGallery(filteredImages.slice(start, start + itemsPerPage)); // Chỉ hiển thị 20 ảnh của trang hiện tại
    renderPagination(filteredImages.length);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Tạo các nút số trang và Prev/Next dựa trên tổng số ảnh
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

// --- XỬ LÝ TẢI LÊN (UPLOAD LOGIC) ---
window.handleUpload = async () => {
    const fileInput = document.getElementById('imageInput');
    const files = fileInput.files;
    const deviceInput = document.getElementById('deviceInput');
    const themeInput = document.getElementById('themeInput');
    const nameInput = document.getElementById('nameInput'); // Đây là "Tên cụ thể"

    const device = deviceInput.value.trim();
    const theme = themeInput.value.trim();
    const subName = nameInput.value.trim();

    // Kiểm tra đầu vào cơ bản
    if (files.length === 0 || !device) {
        return showToast("Vui lòng chọn ảnh và nhập thiết bị!", "error");
    }

    const MAX_SIZE = 10 * 1024 * 1024; // Giới hạn 10MB
    const validFiles = [];
    const errors = [];

    Array.from(files).forEach(file => {
        if (file.size > MAX_SIZE) {
            errors.push(`"${file.name}" quá lớn (>10MB)`);
        } else if (!file.type.startsWith('image/')) {
            errors.push(`"${file.name}" không phải là ảnh`);
        } else {
            validFiles.push(file);
        }
    });

    if (errors.length > 0) {
        errors.forEach(err => showToast(err, "error"));
    }

    if (validFiles.length === 0) return;

    showToast(`Đang tải lên ${validFiles.length} ảnh hợp lệ...`);

    const promises = validFiles.map(async (file) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', UPLOAD_PRESET);
        try {
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { 
                method: 'POST', 
                body: fd 
            });
            
            if (!res.ok) throw new Error("Cloudinary Error");

            const data = await res.json();
            
            return addDoc(collection(db, "photos"), { 
                url: data.secure_url, 
                publicId: data.public_id,
                device, 
                theme, 
                subName, 
                createdAt: new Date() 
            });
        } catch (e) {
            showToast(`Lỗi hệ thống khi tải file: ${file.name}`, "error");
            return null;
        }
    });

    await Promise.all(promises);
    showToast("Upload ảnh thành công!");

    // --- ĐOẠN MÃ THÊM VÀO ĐỂ RESET THÔNG TIN ---
    // 1. Xóa danh sách file trong input
    fileInput.value = ""; 
    
    // 2. Xóa trắng các ô nhập liệu văn bản
    deviceInput.value = "";
    themeInput.value = "";
    nameInput.value = "";

    // 3. Reset giao diện Preview ảnh
    const preview = document.getElementById('preview');
    const dropText = document.getElementById('dropText');
    if (preview) {
        preview.src = "";
        preview.style.display = 'none';
    }
    if (dropText) {
        dropText.style.display = 'block';
    }
    // --------------------------------------------

    loadImages();
};

// --- HIỂN THỊ DANH SÁCH ẢNH (RENDER GALLERY) ---
function renderGallery(data) {
    const gallery = document.getElementById('gallery');
    gallery.innerHTML = "";
    
    data.forEach(item => {
        const isMob = item.device?.toLowerCase().includes('mobile');
        const div = document.createElement('div');
        div.className = `card ${isMob ? 'mobile-view' : ''}`;
        
        div.innerHTML = `
            <img src="${getOptimizedUrl(item.url)}" loading="lazy" onload="this.classList.add('loaded')">
            <div class="card-overlay">
                <div class="card-info">
                    <span class="tag-label">${item.device}</span>
                    <span class="tag-label">#${item.theme}</span>
                    ${item.subName ? `<span class="tag-label">${item.subName}</span>` : ''}
                </div>
                <div class="actions">
                    <button onclick="event.stopPropagation(); editPhoto('${item.id}','${item.device}','${item.theme}','${item.subName||''}')">
                        <span class="material-icons-outlined">edit_note</span>
                    </button>
                    <button onclick="event.stopPropagation(); downloadImage('${item.url}', '${item.subName || item.theme}.jpg')">
                        <span class="material-icons-outlined">file_download</span>
                    </button>
                    <button class="btn-del" onclick="event.stopPropagation(); deletePhoto('${item.id}', '${item.publicId}')">
                        <span class="material-icons-outlined">delete_sweep</span>
                    </button>
                </div>
            </div>`;
            
        div.onclick = () => { 
            // Thay đổi từ item.url (nếu đang dùng tối ưu) thành URL gốc đầy đủ
            document.getElementById('lightbox-img').src = item.url; 
            document.getElementById('lightbox').style.display = 'flex'; 
        };
        gallery.appendChild(div);
    });
}

// --- CÁC THAO TÁC DỮ LIỆU (CRUD) ---
// Xóa một ảnh dựa trên ID
window.deletePhoto = async (id, publicId) => {
    if (confirm("Bạn muốn xóa ảnh này vĩnh viễn?")) { 
        try {
            // 1. Gọi API xóa của Cloudinary (Yêu cầu API Key)
            // Lưu ý: publicId thường có dạng "folder/image_name"
            const apiKey = "962206114668"; // Lấy từ config của bạn
            
            // Trong thực tế, bạn nên dùng một Cloud Function để bảo mật API Secret.
            // Đoạn code dưới đây minh họa logic gửi yêu cầu xóa:
            console.log("Đang yêu cầu Cloudinary xóa ảnh:", publicId);

            // 2. Xóa tài liệu trên Firestore
            await deleteDoc(doc(db, "photos", id)); 
            
            showToast("Đã xóa ảnh thành công!"); 
            loadImages(); 
        } catch (error) {
            showToast("Lỗi khi xóa: " + error.message, "error");
        }
    }
};

// Xóa toàn bộ ảnh trong Collection
window.deleteAllPhotos = async () => {
    if (confirm("CẢNH BÁO: Xóa sạch toàn bộ ảnh trên cả Cloudinary và hệ thống?")) {
        try {
            const snap = await getDocs(collection(db, "photos"));
            
            const deletePromises = snap.docs.map(async (d) => {
                const data = d.data();
                const publicId = data.publicId; // Lấy publicId đã lưu khi upload

                // 1. Logic xóa trên Cloudinary 
                if (publicId) {
                    console.log("Đang yêu cầu xóa file trên Cloudinary:", publicId);
                    // Lưu ý: Cloudinary yêu cầu API Secret để thực hiện xóa hàng loạt.
                    // Ở client-side học tập, ta chủ yếu xử lý logic dọn dẹp Database.
                }

                // 2. Xóa tài liệu trên Firestore
                return deleteDoc(doc(db, "photos", d.id));
            });

            await Promise.all(deletePromises);
            showToast("Đã dọn dẹp sạch sẽ thư viện!");
            loadImages();
        } catch (error) {
            showToast("Lỗi khi xóa hàng loạt!", "error");
        }
    }
};

// Mở Modal chỉnh sửa thông tin ảnh
window.editPhoto = (id, dev, thm, nam) => {
    document.getElementById('editId').value = id;
    document.getElementById('editDeviceInput').value = dev;
    document.getElementById('editThemeInput').value = thm;
    document.getElementById('editNameInput').value = nam;
    document.getElementById('editModal').style.display = 'flex';
};

window.closeEditModal = () => document.getElementById('editModal').style.display = 'none';

// Cập nhật thông tin mới lên Firestore
window.saveEdit = async () => {
    const id = document.getElementById('editId').value;
    const newData = {
        device: document.getElementById('editDeviceInput').value.trim(),
        theme: document.getElementById('editThemeInput').value.trim(),
        subName: document.getElementById('editNameInput').value.trim()
    };

    try {
        await updateDoc(doc(db, "photos", id), newData);
        
        // Cập nhật lại mảng dữ liệu tạm thời (allImages) để không cần tải lại toàn bộ từ Firebase
        const index = allImages.findIndex(img => img.id === id);
        if (index !== -1) {
            allImages[index] = { ...allImages[index], ...newData };
            filteredImages = [...allImages]; // Cập nhật cả mảng đã lọc
        }

        closeEditModal(); 
        showToast("Cập nhật thành công!"); 
        
        // Gọi goToPage với currentPage hiện tại thay vì loadImages()
        renderFilterTags();
        goToPage(currentPage); 
    } catch (error) {
        showToast("Lỗi khi cập nhật!", "error");
    }
};

// Tìm kiếm ảnh thời gian thực theo từ khóa
window.filterImages = () => {
    const term = document.getElementById('searchInput').value.toLowerCase();
    filteredImages = allImages.filter(i => 
        i.device?.toLowerCase().includes(term) || i.theme?.toLowerCase().includes(term) || i.subName?.toLowerCase().includes(term)
    );
    goToPage(1);
};

// Tải dữ liệu từ Firestore lúc mới mở trang
async function loadImages(page = 1) { // Thêm tham số mặc định
    const q = query(collection(db, "photos"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    allImages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    filteredImages = [...allImages];
    renderFilterTags();
    goToPage(page); // Sử dụng tham số page truyền vào
}
// Hiện ảnh ở layout upload
document.getElementById('imageInput').addEventListener('change', function() {
    const file = this.files[0];
    const preview = document.getElementById('preview');
    const dropText = document.getElementById('dropText');

    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.src = e.target.result;
            preview.style.display = 'block'; // Hiện ảnh
            dropText.style.display = 'none'; // Ẩn chữ hướng dẫn
        }
        reader.readAsDataURL(file);
    }
});

const backToTop = document.getElementById('backToTop');

// Hiện nút khi cuộn xuống 300px
window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
        backToTop.style.display = 'flex';
    } else {
        backToTop.style.display = 'none';
    }
});

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

// Hàm xóa sạch thông tin sau khi đăng thành công
function resetUploadForm() {
    // 1. Xóa file đã chọn trong input
    document.getElementById('imageInput').value = "";
    
    // 2. Xóa các ô nhập liệu văn bản
    document.getElementById('deviceInput').value = "";
    document.getElementById('themeInput').value = "";
    document.getElementById('subNameInput').value = "";
    
    // 3. Ẩn ảnh xem trước (Preview) và hiện lại chữ hướng dẫn
    const preview = document.getElementById('preview');
    const dropText = document.getElementById('dropText');
    
    preview.src = "";
    preview.style.display = 'none';
    dropText.style.display = 'block';
}

loadImages();