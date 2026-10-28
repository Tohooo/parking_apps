// ==========================================
// CHART & MENU DROPDOWN MODULE (public/js/chart.js)
// ==========================================

let myChart = null;

// Ambil data user yang sedang login dari localStorage
function getLoggedInUser() {
    const user = JSON.parse(localStorage.getItem('parkir_user') || 'null');
    if (!user || !user.id) {
        window.location.href = '/account.html';
        return null;
    }
    return user;
}

// Toggle Buka/Tutup Dropdown Menu Header
function toggleMainMenu(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('mainDropdownMenu');
    if (dropdown) dropdown.classList.toggle('hidden');
}

// Buka Modal Grafik via Dropdown Menu
function openChartFromMenu() {
    const dropdown = document.getElementById('mainDropdownMenu');
    if (dropdown) dropdown.classList.add('hidden');
    openChartModal();
}

function openChartModal() {
    const modal = document.getElementById('chartModal');
    if (modal) modal.classList.remove('hidden');
    loadChart('day');
}

function closeChartModal() {
    const modal = document.getElementById('chartModal');
    if (modal) modal.classList.add('hidden');
}

// Menutup Dropdown secara otomatis jika mengeklik area luar
window.addEventListener('click', function (e) {
    const dropdown = document.getElementById('mainDropdownMenu');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        dropdown.classList.add('hidden');
    }
});

// Load Data & Render Chart.js Berdasarkan User ID
async function loadChart(period = 'day') {
    const user = getLoggedInUser();
    if (!user) return;

    // Highlight tombol periode aktif
    document.querySelectorAll('.btn-chart').forEach(btn => {
        btn.className = "btn-chart text-xs px-3 py-1.5 rounded-lg font-semibold text-slate-500";
    });
    const activeBtn = document.getElementById(`btn-${period}`);
    if (activeBtn) activeBtn.className = "btn-chart text-xs px-3 py-1.5 rounded-lg font-semibold bg-white text-indigo-600 shadow-sm";

    try {
        const res = await fetch(`/api/parkir/statistik?period=${period}&user_id=${user.id}`);
        const data = await res.json();

        const labels = data.map(d => d.label);
        const totals = data.map(d => d.total_saldo);

        const canvasEl = document.getElementById('statChart');
        if (!canvasEl) return;
        const ctx = canvasEl.getContext('2d');

        if (myChart) myChart.destroy();

        myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels.length > 0 ? labels : ['Belum Ada Data'],
                datasets: [{
                    label: 'Pendapatan (Rp)',
                    data: totals.length > 0 ? totals : [0],
                    backgroundColor: 'rgba(99, 102, 241, 0.85)',
                    borderColor: 'rgb(79, 70, 229)',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: value => 'Rp ' + value.toLocaleString('id-ID'), font: { size: 10 } }
                    },
                    x: { ticks: { font: { size: 10 } } }
                }
            }
        });
    } catch (e) {
        console.error('Gagal memuat grafik statistik:', e);
    }
}