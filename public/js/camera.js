// ==========================================
// CAMERA & OCR MODULE (public/js/camera.js)
// ==========================================

const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const plateInput = document.getElementById('plateInput');
const ocrStatus = document.getElementById('ocrStatus');

// 1. Akses Kamera HP (Belakang / Environment)
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: "environment" } }
        });
        video.srcObject = stream;
        document.getElementById('btnScan').disabled = false;
        ocrStatus.innerText = "Kamera aktif.";
    } catch (err) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
            document.getElementById('btnScan').disabled = false;
            ocrStatus.innerText = "Kamera aktif.";
        } catch (e) {
            alert('Gagal mengakses kamera: ' + e.message);
        }
    }
}

// 2. Capture Frame & Scan Tesseract OCR
async function scanPlate() {
    if (!video.srcObject) return;
    ocrStatus.innerText = "Memproses gambar...";

    const fullW = video.videoWidth;
    const fullH = video.videoHeight;
    const cropWidth = fullW * 0.65;
    const cropHeight = fullH * 0.22;
    const cropX = (fullW - cropWidth) / 2;
    const cropY = (fullH - cropHeight) / 2 - (fullH * 0.03);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    const ctx = cropCanvas.getContext('2d');
    ctx.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    try {
        ocrStatus.innerText = "Membaca plat nomor...";
        const worker = await Tesseract.createWorker('eng');
        await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
        const { data: { text } } = await worker.recognize(cropCanvas);
        await worker.terminate();

        let clean = text.replace(/[^A-Z0-9]/g, '').toUpperCase();
        const match = clean.match(/([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})/);

        if (match) {
            plateInput.value = `${match[1]} ${match[2]} ${match[3]}`;
            ocrStatus.innerText = "Berhasil! Silakan periksa kembali.";
        } else {
            plateInput.value = clean.substring(0, 9);
            ocrStatus.innerText = "Periksa & sesuaikan nomor plat di kolom.";
        }
    } catch (err) {
        ocrStatus.innerText = "Error OCR: " + err.message;
    }
}