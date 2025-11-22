const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const path = require("path");
const readline = require("readline");
const chalk = require("chalk");

const { buildCommands, findCommand } = require("./src/commands");
const { getTextFromMessage } = require("./src/messages");
const { createDb } = require("./src/db");

const AUTH_FOLDER = path.join(__dirname, "auth_info");
const CONFIG_PATH = path.join(__dirname, "config.json");
const defaultConfig = {
  prefix: ".",
  ownerNumber: "6280000000000",
  ownerName: "Bot Owner",
  botName: "Bot Kelas",
  pairingNumber: "",
  debugLogging: true,
  loginMethod: "qr", // qr | code | prompt
  mongoUri: "",
  mongoDbName: "kelas105",
  mongoCollection: "jadwal",
  mongoTasksCollection: "tugas",
  whitelistGroupJids: [],
  admins: []
};

let config = defaultConfig;
try {
  const file = fs.readFileSync(CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(file);
  config = { ...defaultConfig, ...parsed };
} catch (err) {
  console.warn(`Gagal membaca config.json, pakai nilai default. (${err.message})`);
}

const db = createDb(config);
const commands = buildCommands(config, {
  db,
  notifyNewTask,
  isOwner: (jid) => {
    const { num, id, raw } = extractIdOrNumber(jid);
    const ownerNum = normalizeNumber(config.ownerNumber);
    const ownerLid = (config.ownerLid || "").trim();
    const ownerLidBase = ownerLid.split("@")[0];
    if (num && ownerNum && ownerNum === num) return true;
    if (num && ownerLidBase && normalizeNumber(ownerLidBase) === num) return true;
    if (ownerLidBase && (id === ownerLidBase || raw === `${ownerLidBase}@lid` || raw === ownerLidBase)) {
      return true;
    }
    return false;
  },
  isAdmin: (jid) => {
    const { num, id, raw } = extractIdOrNumber(jid);
    if (!num && !id && !raw) return false;
    if (num && normalizeNumber(config.ownerNumber) === num) return true;
    if (adminParsed.numbers.has(num)) return true;
    if (adminParsed.ids.has(id)) return true;
    if (adminParsed.raws.has(raw)) return true;
    return false;
  },
  addAdmin: addAdmin,
  removeAdmin: removeAdmin
});
const logger = P({ level: "info" });
let sock;
let reconnecting = false;
let lastLoginMethod = null;
let reminderTimer = null;
const REMINDER_WINDOW_MS = 10 * 60 * 1000; // hanya kirim jika trigger jatuh dalam 10 menit terakhir
config.admins = config.admins || [];
let adminParsed = parseAdminEntries(config.admins);

function formatTime() {
  return new Date().toTimeString().slice(0, 8);
}

function normalizeNumber(input) {
  return (input || "").replace(/\D/g, "");
}

function extractIdOrNumber(jidOrNumber) {
  if (!jidOrNumber) return { num: "", id: "", raw: "" };
  if (jidOrNumber.includes("@")) {
    const [user, domain] = jidOrNumber.split("@");
    const base = (user || "").split(":")[0];
    return { num: normalizeNumber(base), id: base, raw: `${base}@${domain}` };
  }
  const num = normalizeNumber(jidOrNumber);
  return { num, id: num, raw: num };
}

function numberFromJid(jid) {
  if (!jid) return "";
  const [user] = jid.split("@");
  const base = (user || "").split(":")[0];
  return normalizeNumber(base);
}

function formatAddress(jid) {
  if (!jid) return { label: "ID", text: "-", type: "tidak dikenal" };
  const [user, domain] = jid.split("@");
  const baseUser = (user || "").split(":")[0]; // jika LID, ambil bagian depan
  const num = normalizeNumber(baseUser);

  if (domain?.includes("g.us")) return { label: "IDGRUP", text: baseUser, type: "grup" };
  if (domain?.includes("newsletter")) return { label: "IDSALURAN", text: baseUser, type: "saluran" };
  // Untuk chat pribadi, treat baik s.whatsapp.net maupun lid sebagai NOMOR agar konsisten
  if (domain?.includes("s.whatsapp.net") || domain?.includes("lid")) {
    return { label: "NOMOR", text: num || baseUser, type: "pribadi" };
  }
  return { label: "NOMOR", text: num || baseUser || jid, type: "pribadi" };
}

function debugLog({ status = "info", from, participant, text, command, args, err }) {
  if (!config.debugLogging) return;
  const colors = {
    incoming: chalk.cyan,
    command: chalk.green,
    unknown: chalk.yellow,
    error: chalk.red,
    info: chalk.white
  };
  const colorFn = colors[status] || colors.info;
  const time = chalk.gray(formatTime());
  const statusText = colorFn(status.toUpperCase());
  const info = formatAddress(from);
  const fromText = chalk.magenta(`${info.text}`);
  const typeText = chalk.gray(info.type);
  const textPart = typeof text === "string" && text.length > 0 ? text : "-";

  const label = info.label || "NOMOR";
  let line = `${time} ${statusText} DARI: ${typeText} | ${label}: ${fromText}`;

  if (info.type === "grup" && participant) {
    const senderInfo = formatAddress(participant);
    line += ` | PENGIRIM: ${chalk.gray(senderInfo.label)} ${chalk.magenta(senderInfo.text)}`;
  }

  line += ` | Ngetik: ${chalk.white(textPart)}`;
  if (command) line += ` | Cmd: ${chalk.green(command)}`;
  if (args?.length) line += ` | Args: ${chalk.gray(args.join(" "))}`;
  if (err) line += ` | Err: ${chalk.red(err.message || err)}`;

  console.log(line);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function chooseLoginMethod() {
  const answer = (await ask("Metode login (qr/code)? ")).toLowerCase();
  if (answer === "qr" || answer === "code") {
    return answer;
  }
  console.log("Metode tidak dikenal, default ke QR.");
  return "qr";
}

async function resolveLoginMethod() {
  const cfg = (config.loginMethod || "").toLowerCase();
  if (cfg === "qr" || cfg === "code") return cfg;
  if (cfg === "prompt") return await chooseLoginMethod();
  console.log('loginMethod di config.json tidak dikenal, silakan pilih (qr/code).');
  return await chooseLoginMethod();
}

async function getPairingNumber(defaultNumber = "") {
  const prompt = defaultNumber
    ? `Nomor WhatsApp (misal 628123xxxx, kosongkan untuk pakai ${defaultNumber}): `
    : "Nomor WhatsApp (misal 628123xxxx): ";
  const response = await ask(prompt);
  const cleaned = (response || defaultNumber).replace(/\D/g, "");
  if (!cleaned) {
    console.error("Nomor tidak boleh kosong.");
    process.exit(1);
  }
  return cleaned;
}

async function handleMessages({ messages }) {
  for (const msg of messages) {
    if (!msg.message || msg.key.fromMe) continue;
    const remoteJid = msg.key.remoteJid;
    const participant = msg.key.participant;
    const senderJid = participant || remoteJid;
    const text = getTextFromMessage(msg.message);

    debugLog({ status: "incoming", from: remoteJid, participant, text });

    if (!text || !text.startsWith(config.prefix)) continue;

    const withoutPrefix = text.slice(config.prefix.length).trim();
    if (!withoutPrefix) continue;

    const [rawCommand, ...args] = withoutPrefix.split(/\s+/);
    const command = findCommand(commands, rawCommand);
    if (!command) {
      debugLog({ status: "unknown", from: remoteJid, participant, text, command: rawCommand });
      continue;
    }

    const reply = async (textToSend) => {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: textToSend },
        { quoted: msg }
      );
    };

    try {
      await command.run({
        sock,
        msg,
        args,
        reply,
        prefix: config.prefix,
        commandName: rawCommand,
        config,
        db,
        senderJid,
        senderNumber: numberFromJid(senderJid)
      });
      debugLog({
        status: "command",
        from: remoteJid,
        participant,
        text,
        command: command.name,
        args
      });
    } catch (err) {
      logger.error({ err, command: rawCommand }, "Error saat menjalankan command");
      debugLog({
        status: "error",
        from: remoteJid,
        participant,
        text,
        command: rawCommand,
        args,
        err
      });
      await reply("Terjadi error saat menjalankan perintah.");
    }
  }
}

function setupEventHandlers(currentSock, loginMethod) {
  currentSock.ev.on("messages.upsert", handleMessages);

  currentSock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && loginMethod === "qr") {
      console.log("Scan QR berikut dengan WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("Bot berhasil terhubung.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(
        `Koneksi terputus (${statusCode || "unknown"}). ${
          shouldReconnect
            ? "Mencoba sambung ulang..."
            : "Session logout, hapus folder auth_info untuk login ulang."
        }`
      );

      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        sock = await startBot(true);
        reconnecting = false;
      }
    }
  });
}

async function startBot(isReconnect = false) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();
  const hasCredsFile = fs.existsSync(path.join(AUTH_FOLDER, "creds.json"));
  const alreadyRegistered = state.creds?.registered;

  let loginMethod;
  if (isReconnect && lastLoginMethod) {
    loginMethod = lastLoginMethod;
  } else if (alreadyRegistered || hasCredsFile) {
    loginMethod = "session";
  } else {
    loginMethod = await resolveLoginMethod();
  }
  lastLoginMethod = loginMethod;

  const currentSock = makeWASocket({
    logger,
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: false,
    auth: state,
    version
  });

  currentSock.ev.on("creds.update", saveCreds);
  setupEventHandlers(currentSock, loginMethod);

  if (!alreadyRegistered && loginMethod === "code") {
    const number = await getPairingNumber(config.pairingNumber);
    const code = await currentSock.requestPairingCode(number);
    console.log(`Kode pairing (${number}): ${code}`);
  }

  if (!isReconnect) {
    console.log(`Prefix command: "${config.prefix}" | ketik ${config.prefix}menu`);
  }

  if (!reminderTimer) {
    startReminderLoop();
  }

  return currentSock;
}

(async () => {
  sock = await startBot();
})();

const REMINDER_OFFSETS = [
  { label: "H-3", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "H-2", ms: 2 * 24 * 60 * 60 * 1000 },
  { label: "H-1", ms: 1 * 24 * 60 * 60 * 1000 },
  { label: "12J", ms: 12 * 60 * 60 * 1000 },
  { label: "6J", ms: 6 * 60 * 60 * 1000 },
  { label: "3J", ms: 3 * 60 * 60 * 1000 }
];

async function processReminders() {
  if (!config.mongoUri || !config.whitelistGroupJids || config.whitelistGroupJids.length === 0) {
    return;
  }
  const tasks = (await db.getAllTasks()) || [];
  const now = Date.now();

  for (const task of tasks) {
    const deadline = new Date(task.deadline).getTime();
    if (Number.isNaN(deadline) || deadline <= now) continue;

    for (const offset of REMINDER_OFFSETS) {
      if (task.remindersSent?.includes(offset.label)) continue;
      const trigger = deadline - offset.ms;
      if (trigger > deadline) continue; // sanity

      const alreadyPastWindow = now - trigger > REMINDER_WINDOW_MS;
      if (alreadyPastWindow) continue; // kelewat, jangan kirim

      const shouldSendNow = now >= trigger && deadline > now;
      if (shouldSendNow) {
        await sendReminder(task, offset.label);
        await db.markReminderSent(task._id, offset.label);
      }
    }
  }

  // Bersihkan tugas yang sudah lewat deadlinenya supaya DB tidak penuh
  try {
    const deleted = await db.deletePastTasks();
    if (deleted > 0 && config.debugLogging) {
      debugLog({ status: "info", from: "system", text: `Bersih tugas kadaluarsa: ${deleted}` });
    }
  } catch (err) {
    logger.error({ err }, "Gagal bersihkan tugas kadaluarsa");
  }
}

async function sendReminder(task, label, opts = {}) {
  if (!config.whitelistGroupJids || config.whitelistGroupJids.length === 0) {
    return;
  }
  const deadlineText = new Date(task.deadline).toLocaleString("id-ID", { hour12: false });
  const isNew = opts.type === "new";
  const header = isNew ? "Tugas baru" : `Pengingat tugas (${label})`;
  const text =
    `${header}\n` +
    `Mapel: ${task.subject}\n` +
    `Deadline: ${deadlineText}\n` +
    `Deskripsi: ${task.description || "-"}`;

  for (const gid of config.whitelistGroupJids) {
    try {
      await sock.sendMessage(gid, { text });
      debugLog({ status: "info", from: gid, text: `Reminder ${label} terkirim untuk ${task.subject}` });
    } catch (err) {
      const isNotFound = err?.data === 404 || /item-not-found/i.test(err?.message || "");
      if (isNotFound) {
        debugLog({
          status: "error",
          from: gid,
          text: `Gagal kirim reminder (${label}) ke grup (item-not-found). Pastikan bot masih di grup.`,
          err
        });
        continue;
      }
      logger.error({ err, gid }, "Gagal kirim reminder");
    }
  }
}

async function notifyNewTask(task) {
  try {
    await sendReminder(task, "BARU", { type: "new" });
  } catch (err) {
    logger.error({ err }, "Gagal kirim notifikasi tugas baru");
  }
}

function startReminderLoop() {
  if (!config.mongoUri) {
    console.log("Reminder tidak aktif: mongoUri kosong.");
    return;
  }
  if (!config.whitelistGroupJids || config.whitelistGroupJids.length === 0) {
    console.log("Reminder tidak aktif: whitelistGroupJids kosong.");
    return;
  }

  reminderTimer = setInterval(() => {
    if (!sock) return;
    processReminders().catch((err) => logger.error({ err }, "Reminder loop error"));
  }, 60 * 1000); // cek tiap menit

  console.log("Reminder tugas aktif (cek setiap 60 detik).");
}

function addAdmin(target) {
  const { num, id, raw } = extractIdOrNumber(target);
  if (!num && !id && !raw) return false;
  const current = config.admins || [];
  const exists = current.some((entry) => {
    const { num: eNum, id: eId, raw: eRaw } = extractIdOrNumber(entry);
    return (
      (num && eNum === num) ||
      (id && eId === id) ||
      (raw && eRaw === raw)
    );
  });
  if (exists) return false;
  const stored = raw || num || id;
  const updated = [...current, stored];
  config.admins = updated;
  adminParsed = parseAdminEntries(updated);

  try {
    const file = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(file);
    parsed.admins = updated;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2));
    return true;
  } catch (err) {
    logger.error({ err }, "Gagal menulis admin ke config.json");
    return false;
  }
}

function removeAdmin(target) {
  const { num, id, raw } = extractIdOrNumber(target);
  const current = config.admins || [];
  const filtered = current.filter((entry) => {
    const { num: eNum, id: eId, raw: eRaw } = extractIdOrNumber(entry);
    const match =
      (num && eNum === num) ||
      (id && eId === id) ||
      (raw && eRaw === raw);
    return !match;
  });
  if (filtered.length === current.length) return false;
  config.admins = filtered;
  adminParsed = parseAdminEntries(filtered);

  try {
    const file = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(file);
    parsed.admins = filtered;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2));
    return true;
  } catch (err) {
    logger.error({ err }, "Gagal menghapus admin di config.json");
    return false;
  }
}

function parseAdminEntries(entries) {
  const numbers = new Set();
  const ids = new Set();
  const raws = new Set();
  (entries || []).forEach((entry) => {
    const { num, id, raw } = extractIdOrNumber(entry);
    if (num) numbers.add(num);
    if (id) ids.add(id);
    if (raw) raws.add(raw);
  });
  return { numbers, ids, raws };
}
