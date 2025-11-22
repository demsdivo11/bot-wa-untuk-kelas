function buildCommands(config, deps = {}) {
  const { db, notifyNewTask, isAdmin, isOwner, addAdmin, removeAdmin } = deps;
  const commands = [];

  commands.push({
    name: "menu",
    aliases: ["help"],
    description: "Tampilkan daftar perintah",
    run: async (ctx) => {
      const list = commands
        .filter((cmd) => !cmd.hidden)
        .map((cmd) => {
          const desc = cmd.description ? ` - ${cmd.description}` : "";
          return `${config.prefix}${cmd.name}${desc}`;
        })
        .join("\n");
      const intro = `*${config.botName}*\n`;
      await ctx.reply(`${intro}${list}`);
    }
  });

  commands.push({
    name: "owner",
    description: "Info pemilik bot",
    run: async (ctx) => {
      const waLink = config.ownerNumber ? `wa.me/${config.ownerNumber}` : "Nomor owner belum diisi";
      const text = `Owner: ${config.ownerName}\nWhatsApp: ${waLink}`;
      await ctx.reply(text);
    }
  });

  commands.push({
    name: "addjadwalpelajaran",
    aliases: ["addjadwal"],
    description: "Tambah jadwal pelajaran per hari ke MongoDB",
    run: async (ctx) => {
      if (isAdmin && !isAdmin(ctx.senderJid)) {
        return ctx.reply("Perintah ini khusus admin.");
      }
      if (!db) {
        return ctx.reply("DB belum diset. Pastikan mongoUri di config.json sudah terisi.");
      }

      const [day, ...rest] = ctx.args;
      const subjectsRaw = rest.join(" ");
      if (!day || !subjectsRaw) {
        return ctx.reply(
          `Format: ${config.prefix}addjadwalpelajaran <hari> <mata pelajaran dipisah koma>\n` +
            `Contoh: ${config.prefix}addjadwalpelajaran senin matematika, fisika, biologi`
        );
      }

      const subjects = subjectsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (subjects.length === 0) {
        return ctx.reply("Daftar mata pelajaran tidak boleh kosong.");
      }

      const dayLower = day.toLowerCase();

      try {
        const saved = await db.saveSchedule(dayLower, subjects);
        const list = subjects.map((s) => `- ${s}`).join("\n");
        await ctx.reply(`Jadwal hari ${dayLower} disimpan:\n${list}`);
      } catch (err) {
        console.error("Gagal simpan jadwal:", err);
        await ctx.reply("Gagal menyimpan jadwal ke database.");
      }
    }
  });

  commands.push({
    name: "addtugas",
    description: "Tambah tugas beserta deadline",
    run: async (ctx) => {
      if (isAdmin && !isAdmin(ctx.senderJid)) {
        return ctx.reply("Perintah ini khusus admin.");
      }
      if (!db) {
        return ctx.reply("DB belum diset. Pastikan mongoUri di config.json sudah terisi.");
      }

      const args = [...ctx.args];
      if (args.length < 3) {
        return ctx.reply(
          `Format: ${config.prefix}addtugas <mapel> <deskripsi> <deadline dd-mm-yyyy[-hh[-mm]] atau dd-mm-yyyy hh[:mm]>` +
            `\nContoh: ${config.prefix}addtugas matematika Integral parsial 22-11-2025 07:00` +
            `\nContoh: ${config.prefix}addtugas kimia belajar 22-11-2025-18-30`
        );
      }

      const subject = args.shift();
      const { dateToken, timeToken, descTokens } = extractDateTime(args);
      if (!dateToken) {
        return ctx.reply(
          `Format deadline salah. Gunakan dd-mm-yyyy hh[:mm] atau dd-mm-yyyy-hh[-mm] (24 jam).`
        );
      }

      const description = descTokens.join(" ");
      if (!description) {
        return ctx.reply("Deskripsi tugas tidak boleh kosong.");
      }

      const parsed = parseDeadline(dateToken, timeToken);
      if (!parsed) {
        return ctx.reply("Format deadline salah. Gunakan dd-mm-yyyy hh[:mm] atau dd-mm-yyyy-hh[-mm] (24 jam).");
      }
      if (parsed.getTime() < Date.now()) {
        return ctx.reply("Deadline sudah lewat. Isi tanggal/waktu di masa depan.");
      }

      try {
        const saved = await db.addTask(subject, description, parsed);
        const deadlineText = formatDateId(parsed);
        await ctx.reply(`Tugas disimpan:\nMapel: ${subject}\nDeadline: ${deadlineText}\nDeskripsi: ${description}`);
        if (notifyNewTask) {
          notifyNewTask(saved).catch((err) => {
            console.error("Gagal kirim notifikasi tugas baru:", err);
          });
        }
      } catch (err) {
        console.error("Gagal tambah tugas:", err);
        await ctx.reply("Gagal menyimpan tugas ke database.");
      }
    }
  });

  commands.push({
    name: "jadwalmapel",
    aliases: ["jadwalpel"],
    description: "Lihat semua jadwal pelajaran",
    run: async (ctx) => {
      if (!db) {
        return ctx.reply("DB belum diset. Pastikan mongoUri di config.json sudah terisi.");
      }

      try {
        const schedules = await db.getAllSchedules();
        const tasks = db.getAllTasks ? await db.getAllTasks() : [];

        const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
        const jadwalText =
          schedules && schedules.length > 0
            ? schedules
                .map(({ day, subjects = [] }) => {
                  const list =
                    subjects.length > 0
                      ? subjects.map((s, idx) => `${idx + 1}. ${s}`).join("\n")
                      : "-";
                  return `*${cap(day)}*\n${list}`;
                })
                .join("\n\n")
            : "Belum ada jadwal tersimpan.";

        const tasksText =
          tasks && tasks.length > 0
            ? tasks
                .map((t, idx) => {
                  const deadline = t.deadline ? formatDateId(t.deadline) : "-";
                  return `${idx + 1}. ${t.subject} | ${deadline}\n   ${t.description}`;
                })
                .join("\n")
            : "Belum ada tugas tersimpan.";

        const text = `${jadwalText}\n\n*Tugas*\n${tasksText}`;

        await ctx.reply(text);
      } catch (err) {
        console.error("Gagal ambil jadwal:", err);
        await ctx.reply("Gagal mengambil jadwal dari database.");
      }
    }
  });

  commands.push({
    name: "detail",
    description: "Lihat cara pakai command",
    run: async (ctx) => {
      const lines = [
        `*${config.botName}* - Bantuan`,
        `${config.prefix}menu - Daftar command singkat`,
        `${config.prefix}owner - Info pemilik`,
        `${config.prefix}addjadwalpelajaran <hari> <mapel dipisah koma>`,
        `  Contoh: ${config.prefix}addjadwalpelajaran senin matematika, fisika, biologi`,
        `${config.prefix}jadwalmapel (alias ${config.prefix}jadwalpel) - Lihat jadwal & tugas`,
        `${config.prefix}addtugas <mapel> <deskripsi> <deadline dd-mm-yyyy[ hh[:mm]]>`,
        `  Contoh: ${config.prefix}addtugas fisika hapalkan glbb 23-11-2025 00:01`
      ];
      await ctx.reply(lines.join("\n"));
    }
  });

  commands.push({
    name: "addadmin",
    description: "Tambah admin (owner saja)",
    run: async (ctx) => {
      if (isOwner && !isOwner(ctx.senderJid)) {
        return ctx.reply("Perintah ini hanya untuk owner.");
      }
      if (!addAdmin) {
        return ctx.reply("Fungsi tambah admin tidak tersedia.");
      }

      const target = resolveTarget(ctx);
      if (!target.num && !target.id && !target.raw) {
        return ctx.reply(
          `Gunakan: ${config.prefix}addadmin <nomor> atau reply/tag target.\nContoh: ${config.prefix}addadmin 6281234567890`
        );
      }
      const added = addAdmin(target.raw || target.num || target.id);
      if (added) {
        await ctx.reply(`Nomor/ID ${target.raw || target.num || target.id} ditambahkan sebagai admin.`);
      } else {
        await ctx.reply("Nomor sudah terdaftar atau gagal menambah admin.");
      }
    }
  });

  commands.push({
    name: "deladmin",
    description: "Hapus admin (owner saja)",
    run: async (ctx) => {
      if (isOwner && !isOwner(ctx.senderJid)) {
        return ctx.reply("Perintah ini hanya untuk owner.");
      }
      if (!removeAdmin) {
        return ctx.reply("Fungsi hapus admin tidak tersedia.");
      }

      const target = resolveTarget(ctx);
      if (!target.num && !target.id && !target.raw) {
        return ctx.reply(
          `Gunakan: ${config.prefix}deladmin <nomor> atau reply/tag target.`
        );
      }
      const removed = removeAdmin(target.raw || target.num || target.id);
      if (removed) {
        await ctx.reply(`Admin ${target.raw || target.num || target.id} dihapus.`);
      } else {
        await ctx.reply("Admin tidak ditemukan atau gagal menghapus.");
      }
    }
  });

  return commands;
}

function extractDateTime(args) {
  const dateRegex = /^\d{1,2}-\d{1,2}-\d{4}$/;
  const timeRegex = /^\d{1,2}(:\d{1,2})?$/;
  const combinedRegex = /^(\d{1,2})-(\d{1,2})-(\d{4})-([0-2]?\d)(?::|-)?(\d{2})?$/; // dd-mm-yyyy-hh[:mm] atau dd-mm-yyyy-hh-mm
  let dateIdx = -1;

  // Cek token kombinasi tanggal-waktu dalam satu kata (dd-mm-yyyy-hh:mm atau dd-mm-yyyy-hh-mm)
  for (let i = args.length - 1; i >= 0; i -= 1) {
    const match = args[i].match(combinedRegex);
    if (match) {
      const [, d, m, y, hh, mm = "00"] = match;
      return {
        dateToken: `${d}-${m}-${y}`,
        timeToken: `${hh}:${mm}`,
        descTokens: args.slice(0, i)
      };
    }
  }

  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (dateRegex.test(args[i])) {
      dateIdx = i;
      break;
    }
  }
  if (dateIdx === -1) {
    return { dateToken: null, timeToken: null, descTokens: args };
  }
  const dateToken = args[dateIdx];
  const possibleTime = args[dateIdx + 1];
  const timeToken = possibleTime && timeRegex.test(possibleTime) ? possibleTime : null;
  const descTokens = args.slice(0, dateIdx);
  return { dateToken, timeToken, descTokens };
}

function parseDeadline(dateStr, timeStr) {
  if (!dateStr) return null;
  const [d, m, y] = dateStr.split("-").map((n) => parseInt(n, 10));
  if (!d || !m || !y) return null;

  let hh = 0;
  let mm = 1; // default menit 01 jika waktu tidak diisi sama sekali
  if (timeStr) {
    const pieces = timeStr.includes(":") ? timeStr.split(":") : [timeStr, "00"];
    const [h, m2] = pieces.map((n) => parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m2)) return null;
    hh = h;
    mm = pieces.length > 1 ? m2 : 0; // kalau jam saja, menit default 00
  }

  const dt = new Date(y, m - 1, d, hh, mm, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function resolveTarget(ctx) {
  // Prioritas: mention -> reply participant -> arg pertama
  const mentioned =
    ctx.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
    ctx.msg.message?.conversation?.contextInfo?.mentionedJid?.[0];
  const quotedParticipant =
    ctx.msg.message?.extendedTextMessage?.contextInfo?.participant ||
    ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.participant ||
    ctx.msg.key?.participant;

  const candidateJid = mentioned || quotedParticipant;
  if (candidateJid) {
    const num = jidToNumber(candidateJid);
    return { num, id: candidateJid.split("@")[0], raw: candidateJid };
  }

  if (ctx.args && ctx.args.length > 0) {
    const raw = ctx.args[0];
    const num = raw.replace(/\D/g, "");
    return { num, id: num, raw };
  }

  return { num: "", id: "", raw: "" };
}

function jidToNumber(jid) {
  if (!jid) return null;
  const [user] = jid.split("@");
  const base = (user || "").split(":")[0];
  const num = base.replace(/\D/g, "");
  return num || null;
}

function formatDateId(date) {
  const d = new Date(date);
  return d.toLocaleString("id-ID", { hour12: false });
}

function findCommand(commands, name) {
  const lower = name.toLowerCase();
  return commands.find(
    (cmd) =>
      cmd.name.toLowerCase() === lower ||
      (cmd.aliases || []).some((alias) => alias.toLowerCase() === lower)
  );
}

module.exports = { buildCommands, findCommand };
