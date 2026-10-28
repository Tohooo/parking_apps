// ==========================================
// MAIN APP LOGIC MODULE (public/js/app.js)
// ==========================================

let cachedRecords = [];
let selectedRecordForPay = null;
let currentConfig = { parking_fee: 5000, qris_active: '1', qris_image: '' };

// Ambil data user yang sedang login dari localStorage
function getLoggedInUser() {
    const user = JSON.parse(localStorage.getItem('parkir_user') || 'null');
    if (!user || !user.id) {
        window.location.href = '/account.html';
        return null;
    }
    return user;
}

// 1. Set Default Date Filter (Hari Ini)
const todayStr = new Date().toISOString().split('T')[0];
if (document.getElementById('filterDateFrom')) {
    document.getElementById('filterDateFrom').value = todayStr;
    document.getElementById('filterDateTo').value = todayStr;
}

// ==========================================
// 2. LOGIKA DROPDOWN MENU HEADER
// ==========================================
function toggleMainMenu(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('mainDropdownMenu');
    if (dropdown) dropdown.classList.toggle('hidden');
}

// Sembunyikan dropdown otomatis jika klik di luar menu
window.addEventListener('click', function (e) {
    const dropdown = document.getElementById('mainDropdownMenu');
    const btn = document.getElementById('btnMainMenu');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
            dropdown.classList.add('hidden');
        }
    }
});

// ==========================================
// 3. AMBIL SETTING TERKINI (TARIF & QRIS) PER USER
// ==========================================
async function fetchSettings() {
    try {
        const user = getLoggedInUser();
        if (!user) return;

        const res = await fetch(`/api/settings?user_id=${user.id}`);
        if (res.ok) {
            currentConfig = await res.json();
        }
    } catch (e) {
        console.error('Gagal memuat setting:', e);
    }
}

// 4. Submit Kendaraan Masuk
async function submitMasuk() {
    const user = getLoggedInUser();
    if (!user) return;

    const plateInput = document.getElementById('plateInput');
    const ocrStatus = document.getElementById('ocrStatus');
    const plate = plateInput.value.trim();

    if (!plate) return alert('Isi plat nomor terlebih dahulu!');

    const res = await fetch('/api/parkir/masuk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            plate_number: plate,
            user_id: user.id // Terikat ke akun user aktif
        })
    });

    const data = await res.json();
    if (data.success) {
        plateInput.value = '';
        if (ocrStatus) ocrStatus.innerText = 'Berhasil dicatat!';
        refreshData();
    } else {
        alert(data.error || 'Gagal menyimpan');
    }
}

// 5. Modal Pembayaran (Cash / QRIS)
async function openPayModal(event, id, plate) {
    event.stopPropagation();
    await fetchSettings(); // Refresh setting tarif & QRIS terbaru user

    selectedRecordForPay = { id, plate };

    document.getElementById('payPlatText').innerText = plate;

    // Set Teks Tarif Sesuai Setting Aktif User
    const currentFee = parseInt(currentConfig.parking_fee || 5000);
    document.getElementById('payAmountText').innerText = `Rp ${currentFee.toLocaleString('id-ID')}`;

    // Cek Apakah QRIS Aktif di Setting User
    const btnQris = document.getElementById('btnQrisOption');
    if (currentConfig.qris_active === '0') {
        if (btnQris) btnQris.classList.add('hidden');
    } else {
        if (btnQris) btnQris.classList.remove('hidden');
    }

    document.getElementById('payOptions').classList.remove('hidden');
    document.getElementById('qrisView').classList.add('hidden');
    document.getElementById('payModal').classList.remove('hidden');
}

function closePayModal() {
    document.getElementById('payModal').classList.add('hidden');
    selectedRecordForPay = null;
}

// Tampilkan Foto QRIS Upload / Dummy
function showQrisView() {
    if (!selectedRecordForPay) return;

    const qrisImg = document.getElementById('qrisImg');
    if (currentConfig.qris_image) {
        qrisImg.src = currentConfig.qris_image;
    } else {
        const dummyData = `QRIS-PARKIR-PLAT-${selectedRecordForPay.plate}`;
        qrisImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(dummyData)}`;
    }

    document.getElementById('payOptions').classList.add('hidden');
    document.getElementById('qrisView').classList.remove('hidden');
}

async function confirmPayment(method) {
    if (!selectedRecordForPay) return;
    const user = getLoggedInUser();
    if (!user) return;

    const res = await fetch(`/api/parkir/keluar/${selectedRecordForPay.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            payment_method: method,
            user_id: user.id
        })
    });

    const data = await res.json();
    if (data.success) {
        closePayModal();
        refreshData();
    } else {
        alert(data.error || 'Gagal memproses pembayaran');
    }
}

// 6. Fetch Riwayat Transaksi Parkir Berdasarkan User ID
async function fetchRiwayat() {
    const user = getLoggedInUser();
    if (!user) return;

    const dateFrom = document.getElementById('filterDateFrom').value;
    const dateTo = document.getElementById('filterDateTo').value;
    const statusVal = document.getElementById('filterStatus').value;

    const res = await fetch(`/api/parkir/riwayat?from=${dateFrom}&to=${dateTo}&status=${statusVal}&user_id=${user.id}`);
    cachedRecords = await res.json();

    const listContainer = document.getElementById('listRiwayat');
    listContainer.innerHTML = '';

    if (!cachedRecords || cachedRecords.length === 0) {
        listContainer.innerHTML = `<p class="text-center text-slate-400 text-xs py-4">Tidak ada data ditemukan.</p>`;
        return;
    }

    cachedRecords.forEach(item => {
        const timeIn = new Date(item.time_in).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const timeOut = item.time_out ? new Date(item.time_out).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        const isOut = item.status === 'OUT';

        const el = document.createElement('div');
        el.className = 'flex justify-between items-center bg-slate-50 p-2.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors';
        el.onclick = () => openModal(item.id);

        el.innerHTML = `
          <div>
            <div class="flex items-center gap-2">
              <p class="font-mono font-bold text-slate-800 text-sm">${item.plate_number}</p>
              <span class="text-[9px] px-1.5 py-0.5 rounded font-semibold ${isOut ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}">
                ${isOut ? 'SUDAH KELUAR' : 'BELUM KELUAR'}
              </span>
            </div>
            <p class="text-[10px] text-slate-400 mt-0.5">Masuk: ${timeIn} WIB ${isOut ? '| Keluar: ' + timeOut + ' WIB (' + (item.payment_method || 'Cash') + ')' : ''}</p>
          </div>
          ${!isOut ? `
            <button onclick="openPayModal(event, ${item.id}, '${item.plate_number}')" class="bg-rose-500 text-white text-xs px-3 py-1.5 rounded font-medium hover:bg-rose-600">
              Bayar & Keluar
            </button>
          ` : `
            <span class="text-xs font-bold text-emerald-600">+Rp ${(item.fee || 0).toLocaleString('id-ID')}</span>
          `}
        `;
        listContainer.appendChild(el);
    });
}

// 7. Modal Detail Tiket Parkir
function openModal(id) {
    const item = cachedRecords.find(r => r.id === id);
    if (!item) return;

    const timeInDate = new Date(item.time_in);
    const timeOutDate = item.time_out ? new Date(item.time_out) : new Date();

    const diffMs = timeOutDate - timeInDate;
    const diffMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    const durationStr = item.status === 'OUT' ? `${hrs} jam ${mins} menit` : `${hrs} jam ${mins} menit (Berjalan)`;

    document.getElementById('mTiket').innerText = `TKT-${String(item.id).padStart(5, '0')}`;
    document.getElementById('mPlat').innerText = item.plate_number;

    const isOut = item.status === 'OUT';
    const mStatus = document.getElementById('mStatus');
    mStatus.innerText = isOut ? 'SUDAH KELUAR' : 'BELUM KELUAR';
    mStatus.className = `font-semibold px-2 py-0.5 rounded text-[10px] ${isOut ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-700'}`;

    document.getElementById('mWaktuMasuk').innerText = timeInDate.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) + ' WIB';
    document.getElementById('mWaktuKeluar').innerText = item.time_out ? timeOutDate.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) + ' WIB' : '-';
    document.getElementById('mDurasi').innerText = durationStr;
    document.getElementById('mTarif').innerText = `Rp ${(item.fee || 0).toLocaleString('id-ID')}`;
    document.getElementById('mMetode').innerText = item.payment_method || 'Cash';

    const mBayarStatus = document.getElementById('mBayarStatus');
    mBayarStatus.innerText = isOut ? 'Lunas' : 'Pending';
    mBayarStatus.className = `font-bold ${isOut ? 'text-emerald-600' : 'text-amber-600'}`;

    document.getElementById('detailModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('detailModal').classList.add('hidden');
}

// 8. Global Refresh Data Berdasarkan User ID
async function refreshData() {
    const user = getLoggedInUser();
    if (!user) return;

    await fetchSettings();
    const resSummary = await fetch(`/api/parkir/summary?user_id=${user.id}`);
    const summary = await resSummary.json();

    document.getElementById('totalSaldo').innerText = `Rp ${(summary.total_saldo_hari_ini || 0).toLocaleString('id-ID')}`;
    document.getElementById('subCash').innerText = `Rp ${(summary.total_cash || 0).toLocaleString('id-ID')}`;
    document.getElementById('subQris').innerText = `Rp ${(summary.total_qris || 0).toLocaleString('id-ID')}`;
    document.getElementById('totalAktif').innerText = `${summary.total_parkir_aktif || 0} Unit`;

    fetchRiwayat();
}

// Inisialisasi awal saat aplikasi dimuat
refreshData();