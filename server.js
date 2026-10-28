import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const JWT_SECRET = 'parkir_scan_secret_key_2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Temporary Storage untuk Kode OTP (In-Memory)
const otpStore = new Map();

// ==========================================
// KONEKSI SUPABASE (POSTGRESQL)
// ==========================================
const pool = new Pool({
    connectionString: 'GANTI_DENGAN_CONNECTION_STRING_SUPABASE_ANDA',
    // Contoh: 'postgresql://postgres.xxxx:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
    if (err) console.error('Gagal koneksi ke Supabase:', err.message);
    else console.log('Berhasil terkoneksi ke Database Supabase (PostgreSQL).');
});

// Helper Inisialisasi Default Setting per User
async function initUserSettings(userId) {
    try {
        await pool.query(`INSERT INTO settings (user_id, key, value) VALUES ($1, 'pin', '1234') ON CONFLICT (user_id, key) DO NOTHING`, [userId]);
        await pool.query(`INSERT INTO settings (user_id, key, value) VALUES ($1, 'qris_active', '1') ON CONFLICT (user_id, key) DO NOTHING`, [userId]);
        await pool.query(`INSERT INTO settings (user_id, key, value) VALUES ($1, 'qris_image', '') ON CONFLICT (user_id, key) DO NOTHING`, [userId]);
        await pool.query(`INSERT INTO settings (user_id, key, value) VALUES ($1, 'parking_fee', '5000') ON CONFLICT (user_id, key) DO NOTHING`, [userId]);
    } catch (e) {
        console.error('Gagal init settings:', e.message);
    }
}

// Multer Config untuk Upload QRIS per User
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => {
        const userId = req.body.user_id || 'guest';
        cb(null, `qris_user_${userId}_${Date.now()}.${file.originalname.split('.').pop()}`);
    }
});
const upload = multer({ storage });

// ==========================================
// API VERIFIKASI & AUTENTIKASI (USERS)
// ==========================================

app.post('/api/auth/send-otp', (req, res) => {
    const { phone_number } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'Nomor HP wajib diisi' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    otpStore.set(phone_number, { code: otp, expiresAt });
    res.json({ success: true, message: 'Kode OTP verifikasi berhasil dikirim.', debug_otp: otp });
});

app.post('/api/auth/verify-otp', async (req, res) => {
    const { phone_number, otp } = req.body;
    const record = otpStore.get(phone_number);

    if (!record || record.code !== otp) return res.status(400).json({ error: 'Kode OTP salah!' });
    if (Date.now() > record.expiresAt) {
        otpStore.delete(phone_number);
        return res.status(400).json({ error: 'Kode OTP telah kadaluarsa!' });
    }
    otpStore.delete(phone_number);

    try {
        let result = await pool.query(`SELECT * FROM users WHERE phone_number = $1`, [phone_number]);
        if (result.rows.length > 0) {
            let row = result.rows[0];
            await pool.query(`UPDATE users SET is_verified = 1 WHERE id = $1`, [row.id]);
            const token = jwt.sign({ id: row.id, phone: row.phone_number }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token, user: { ...row, is_verified: 1 } });
        } else {
            let insertRes = await pool.query(
                `INSERT INTO users (auth_type, phone_number, is_verified) VALUES ('phone', $1, 1) RETURNING *`,
                [phone_number]
            );
            let newUser = insertRes.rows[0];
            await initUserSettings(newUser.id);
            const token = jwt.sign({ id: newUser.id, phone: phone_number }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token, user: newUser });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/google-verify', async (req, res) => {
    const { credential } = req.body;
    try {
        const base64Url = credential.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        const payload = JSON.parse(jsonPayload);

        const google_id = payload.sub;
        const email = payload.email;
        const full_name = payload.name;

        let result = await pool.query(`SELECT * FROM users WHERE google_id = $1 OR email = $2`, [google_id, email]);
        if (result.rows.length > 0) {
            let row = result.rows[0];
            const token = jwt.sign({ id: row.id, email: row.email }, JWT_SECRET, { expiresIn: '7d' });
            return res.json({ success: true, token, user: row });
        } else {
            let insertRes = await pool.query(
                `INSERT INTO users (auth_type, google_id, email, full_name, is_verified) VALUES ('google', $1, $2, $3, 1) RETURNING *`,
                [google_id, email, full_name]
            );
            let newUser = insertRes.rows[0];
            await initUserSettings(newUser.id);
            const token = jwt.sign({ id: newUser.id, email }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token, user: newUser });
        }
    } catch (e) {
        res.status(400).json({ error: 'Token Google gagal diproses: ' + e.message });
    }
});

app.post('/api/auth/update-profile', async (req, res) => {
    const { id, full_name, birth_date, phone_number, email, parking_address } = req.body;
    try {
        await pool.query(
            `UPDATE users SET full_name = $1, birth_date = $2, phone_number = $3, email = $4, parking_address = $5 WHERE id = $6`,
            [full_name, birth_date, phone_number, email, parking_address, id]
        );
        let result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
        res.json({ success: true, user: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// API TRANSAKSI PARKIR (PARKING_RECORDS)
// ==========================================

app.post('/api/parkir/masuk', async (req, res) => {
    const { plate_number, user_id } = req.body;
    if (!plate_number || !user_id) return res.status(400).json({ error: 'Plat nomor dan User ID wajib diisi' });

    let cleanPlate = plate_number.toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const noSpace = cleanPlate.replace(/\s/g, '');
    const match = noSpace.match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{1,3})$/);
    if (match) cleanPlate = `${match[1]} ${match[2]} ${match[3]}`;

    try {
        let result = await pool.query(
            `INSERT INTO parking_records (user_id, plate_number, time_in, status, fee, payment_method) VALUES ($1, $2, NOW(), 'IN', 0, 'Cash') RETURNING id`,
            [user_id, cleanPlate]
        );
        res.json({ success: true, id: result.rows[0].id, plate_number: cleanPlate });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/parkir/keluar/:id', async (req, res) => {
    const { id } = req.params;
    const { payment_method, user_id } = req.body;
    const method = payment_method || 'Cash';

    try {
        let settingRes = await pool.query(`SELECT value FROM settings WHERE user_id = $1 AND key = 'parking_fee'`, [user_id]);
        const currentFee = parseInt(settingRes.rows[0]?.value || 5000);

        let updateRes = await pool.query(
            `UPDATE parking_records SET status = 'OUT', time_out = NOW(), fee = $1, payment_method = $2 WHERE id = $3 AND user_id = $4 AND status = 'IN'`,
            [currentFee, method, id, user_id]
        );

        if (updateRes.rowCount === 0) return res.status(400).json({ error: 'Data tidak ditemukan atau sudah keluar' });
        res.json({ success: true, message: `Berhasil keluar via ${method}, saldo +${currentFee}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/parkir/summary', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'User ID diperlukan' });

    try {
        let query = `
            SELECT 
              SUM(CASE WHEN status = 'OUT' AND DATE(time_out) = CURRENT_DATE THEN fee ELSE 0 END) as total_saldo_hari_ini,
              SUM(CASE WHEN status = 'OUT' AND DATE(time_out) = CURRENT_DATE AND payment_method = 'Cash' THEN fee ELSE 0 END) as total_cash,
              SUM(CASE WHEN status = 'OUT' AND DATE(time_out) = CURRENT_DATE AND payment_method = 'QRIS' THEN fee ELSE 0 END) as total_qris,
              COUNT(CASE WHEN status = 'IN' THEN 1 END) as total_parkir_aktif,
              COUNT(CASE WHEN status = 'OUT' AND DATE(time_out) = CURRENT_DATE THEN 1 END) as total_keluar_hari_ini
            FROM parking_records WHERE user_id = $1
        `;
        let result = await pool.query(query, [user_id]);
        let row = result.rows[0];
        res.json({
            total_saldo_hari_ini: parseInt(row?.total_saldo_hari_ini || 0),
            total_cash: parseInt(row?.total_cash || 0),
            total_qris: parseInt(row?.total_qris || 0),
            total_parkir_aktif: parseInt(row?.total_parkir_aktif || 0),
            total_keluar_hari_ini: parseInt(row?.total_keluar_hari_ini || 0)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/parkir/riwayat', async (req, res) => {
    const { from, to, status, user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'User ID diperlukan' });

    const today = new Date().toISOString().split('T')[0];
    const dateFrom = from || today;
    const dateTo = to || today;

    try {
        let sql = `SELECT * FROM parking_records WHERE user_id = $1 AND DATE(time_in) BETWEEN $2 AND $3`;
        let params = [user_id, dateFrom, dateTo];

        if (status && status !== 'ALL') {
            sql += ` AND status = $4`;
            params.push(status);
        }

        sql += ` ORDER BY time_in DESC`;
        let result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/parkir/statistik', async (req, res) => {
    const { period, user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'User ID diperlukan' });

    try {
        let sql = '';
        if (period === 'day') {
            sql = `SELECT TO_CHAR(time_out, 'HH24:00') as label, SUM(fee) as total_saldo FROM parking_records WHERE user_id = $1 AND status = 'OUT' AND DATE(time_out) = CURRENT_DATE GROUP BY label ORDER BY label ASC`;
        } else if (period === 'week') {
            sql = `SELECT TO_CHAR(time_out, 'YYYY-MM-DD') as label, SUM(fee) as total_saldo FROM parking_records WHERE user_id = $1 AND status = 'OUT' AND time_out >= (CURRENT_DATE - INTERVAL '6 days') GROUP BY label ORDER BY label ASC`;
        } else if (period === 'month') {
            sql = `SELECT TO_CHAR(time_out, 'DD/MM') as label, SUM(fee) as total_saldo FROM parking_records WHERE user_id = $1 AND status = 'OUT' AND TO_CHAR(time_out, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM') GROUP BY label ORDER BY label ASC`;
        } else if (period === 'year') {
            sql = `SELECT TO_CHAR(time_out, 'MM/YYYY') as label, SUM(fee) as total_saldo FROM parking_records WHERE user_id = $1 AND status = 'OUT' AND TO_CHAR(time_out, 'YYYY') = TO_CHAR(CURRENT_DATE, 'YYYY') GROUP BY label ORDER BY label ASC`;
        }

        let result = await pool.query(sql, [user_id]);
        res.json(result.rows || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// API SETTINGS PER USER
// ==========================================

app.get('/api/settings', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'User ID diperlukan' });

    try {
        let result = await pool.query(`SELECT * FROM settings WHERE user_id = $1`, [user_id]);
        const config = {};
        result.rows.forEach(r => config[r.key] = r.value);
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings/verify-pin', async (req, res) => {
    const { pin, user_id } = req.body;
    try {
        let result = await pool.query(`SELECT value FROM settings WHERE user_id = $1 AND key = 'pin'`, [user_id]);
        if (result.rows.length > 0 && result.rows[0].value === pin) res.json({ success: true });
        else res.status(401).json({ error: 'PIN Salah!' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings/update', async (req, res) => {
    const { pin, parking_fee, qris_active, user_id } = req.body;
    try {
        let pinRes = await pool.query(`SELECT value FROM settings WHERE user_id = $1 AND key = 'pin'`, [user_id]);
        if (pinRes.rows.length === 0 || pinRes.rows[0].value !== pin) return res.status(401).json({ error: 'PIN Salah!' });

        if (parking_fee !== undefined) {
            await pool.query(
                `INSERT INTO settings (user_id, key, value) VALUES ($1, 'parking_fee', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = $2`,
                [user_id, parking_fee]
            );
        }
        if (qris_active !== undefined) {
            await pool.query(
                `INSERT INTO settings (user_id, key, value) VALUES ($1, 'qris_active', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = $2`,
                [user_id, qris_active]
            );
        }
        res.json({ success: true, message: 'Pengaturan berhasil diperbarui' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings/upload-qris', upload.single('qris_image'), async (req, res) => {
    const { user_id } = req.body;
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    const filePath = '/uploads/' + req.file.filename;

    try {
        await pool.query(
            `INSERT INTO settings (user_id, key, value) VALUES ($1, 'qris_image', $2) ON CONFLICT (user_id, key) DO UPDATE SET value = $2`,
            [user_id, filePath]
        );
        res.json({ success: true, image_url: filePath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});