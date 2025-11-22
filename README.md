# Bot WhatsApp (Baileys)

Bot dasar menggunakan `@whiskeysockets/baileys` dengan pilihan login QR atau pairing code. Prefix default adalah `.` (contoh `.menu`). Semua konfigurasi ada di `config.json`.

## Persiapan
- Pastikan Node.js 18+ sudah terpasang.
- Install dependensi: `npm install`
- Salin `config.json.dummy` menjadi `config.json`, lalu sesuaikan:
  ```json
  {
    "prefix": ".",
    "ownerNumber": "6281234567890",
    "ownerLid": "",
    "ownerName": "Nama Kamu",
    "botName": "Nama Bot",
    "pairingNumber": "",
    "debugLogging": true,
    "loginMethod": "qr",
    "mongoUri": "mongodb+srv://user:pass@kelas105.gxd811d.mongodb.net/?appName=kelas105",
    "mongoDbName": "kelas105",
    "mongoCollection": "jadwal"
  }
  ```

## Menjalankan
1) `npm start`
2) Kalau belum ada sesi, pilih metode:
   - Set `loginMethod` di `config.json` ke `qr` atau `code` (default `qr`). Gunakan `prompt` jika ingin ditanya saat run.
   - Jika `code`, pastikan `pairingNumber` terisi format 62xxxx.
3) Setelah terhubung, coba kirim `.menu` atau `.owner` ke bot.

Sesi tersimpan di folder `auth_info/`. Hapus folder ini jika ingin login ulang.
Jika setelah scan muncul pesan `515`/restart, itu normal; tunggu sambung ulang otomatis. Jika loop terus menerus, hapus `auth_info/` lalu login ulang.

### Debug log
- `debugLogging: true` di `config.json` akan mencetak log berwarna dengan format: `HH:mm:ss STATUS Nomor: xxxx | Ngetik: ...`
- Set `debugLogging: false` jika ingin log lebih sunyi.

### MongoDB
- Isi `mongoUri` sesuai kredensial/cluster kamu. Contoh: `mongodb+srv://username:password@kelas105.gxd811d.mongodb.net/?appName=kelas105`.
- Opsi `mongoDbName` dan `mongoCollection` bisa diubah bila perlu.
- Jika `mongoUri` kosong, command yang butuh DB akan menolak berjalan.

#### Langkah membuat MongoDB Atlas (cloud)
1) Buat akun di https://cloud.mongodb.com/ dan login.
2) Create Project → beri nama (misal `kelas105`).
3) Create Cluster → pilih Free tier (Shared) dan region terdekat → tunggu provisioning selesai.
4) Menu “Database Access” → Add New Database User → set username & password (buat sendiri, contoh: `myuser` / `mypasswordku`) → Role: Atlas admin atau beri akses readWrite ke database target.
5) Menu “Network Access” → Add IP → `0.0.0.0/0` (atau batasi IP kamu sendiri).
6) Menu “Databases” → Connect → pilih “Connect your application” → copy connection string (`mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?appName=<app>`).
7) Tempel string itu ke `mongoUri` di `config.json`, ganti `<user>` `<pass>` sesuai user/password pada langkah 4.
8) Set `mongoDbName` (misal `kelas105`) dan koleksi default sudah disiapkan otomatis lewat kode (`jadwal`, `tugas`).

## Menambah command baru
Command ada di `src/commands.js`. Tambah item baru pada array `commands`:

```js
commands.push({
  name: "ping",
  description: "Cek respon bot",
  run: async ({ reply }) => reply("pong!")
});
```

Menu akan otomatis menampilkan perintah baru karena diambil langsung dari daftar command. Pastikan setiap command memanggil `reply()` untuk mengirim jawaban.

### Command jadwal
- Tambah jadwal pelajaran per hari ke MongoDB:  
  `.addjadwalpelajaran senin matematika, fisika, biologi`
- Alias: `.addjadwal`
- Lihat semua jadwal yang tersimpan: `.jadwalmapel` (alias `.jadwalpel`)
- Tambah tugas: `.addtugas <mapel> <deskripsi> <deadline dd-mm-yyyy[-hh[-mm]] atau dd-mm-yyyy hh[:mm]>` (default waktu 00:01 jika tidak diisi)
- Lihat detail cara pakai: `.detail`
- Tugas yang sudah lewat deadline akan dibersihkan otomatis dari MongoDB saat loop reminder berjalan.
- Tambah admin (owner saja): `.addadmin <nomor>` atau reply/tag target (bisa ID LID/JID). Admin bisa menjalankan `.addjadwalpelajaran` dan `.addtugas`.
- Hapus admin (owner saja): `.deladmin <nomor>` atau reply/tag target.
