import { mattermost } from "./mattermost.js";
import type { I18nDictionary } from "./en.js";

/**
 * Indonesian localization for OpenCode Mattermost Bot.
 *
 * Keep upstream emoji and technical terms where they help recognition.
 * Prefer natural Indonesian wording over literal translation.
 * Keep this dictionary complete to avoid falling back to another locale.
 */
export const id: I18nDictionary = {
  ...mattermost,
  "cmd.description.recent": "Sesi terbaru di semua proyek",
  "cmd.description.status": "Status server dan sesi",
  "cmd.description.new": "Buat sesi baru",
  "cmd.description.stop": "Hentikan aksi saat ini",
  "cmd.description.detach": "Lepaskan dari sesi saat ini",
  "cmd.description.sessions": "Daftar sesi",
  "cmd.description.messages": "Telusuri pesan sesi",
  "cmd.description.settings": "Ubah pengaturan bot",
  "cmd.description.projects": "Daftar proyek",
  "cmd.description.worktree": "Ganti git worktree",
  "cmd.description.task": "Buat tugas terjadwal",
  "cmd.description.tasklist": "Daftar tugas terjadwal",
  "cmd.description.commands": "Perintah khusus",
  "cmd.description.skills": "Katalog skill",
  "cmd.description.mcps": "Server MCP",
  "cmd.description.opencode_start": "Mulai server OpenCode",
  "cmd.description.opencode_stop": "Hentikan server OpenCode",
  "cmd.description.reload": "Reload OpenCode configuration",
  "cmd.description.ls": "Daftar isi direktori",
  "cmd.description.help": "Bantuan",

  "error.load_agents": "❌ Gagal memuat daftar agent",
  "error.load_models": "❌ Gagal memuat daftar model",
  "error.load_variants": "❌ Gagal memuat daftar varian",
  "error.context_button": "❌ Gagal memproses tombol konteks",
  "error.generic": "🔴 Terjadi kesalahan.",

  "common.cancelled": "Dibatalkan",
  "common.unknown": "tidak diketahui",
  "common.unknown_error": "kesalahan tidak diketahui",

  "agent.changed_message": "✅ Agent diubah menjadi: {name}",
  "agent.change_error_callback": "Gagal mengubah agent",
  "agent.menu.current": "Agent saat ini: {name}\n\nPilih agent:",
  "agent.menu.select": "Pilih agent:",
  "agent.menu.empty": "⚠️ Tidak ada agent yang tersedia",
  "agent.menu.error": "🔴 Gagal memuat daftar agent",

  "model.changed_message": "✅ Model diubah menjadi: {name}",
  "model.change_error_callback": "Gagal mengubah model",
  "model.menu.empty": "⚠️ Tidak ada model yang tersedia",
  "model.menu.select": "Pilih model:",
  "model.menu.current": "Model saat ini: {name}\n\nPilih model:",
  "model.menu.favorites_title": "⭐ Favorit (Tambahkan model ke favorit di OpenCode CLI)",
  "model.menu.favorites_empty": "— Kosong.",
  "model.menu.recent_title": "🕘 Terbaru",
  "model.menu.recent_empty": "— Kosong.",
  "model.menu.favorites_hint": "ℹ️ Tambahkan model ke favorit di OpenCode CLI agar tetap di atas.",
  "model.menu.error": "🔴 Gagal memuat daftar model",
  "model.search.button": "🔍 Cari",
  "model.search.prompt": "🔍 Ketik nama model yang ingin dicari:",
  "model.search.results_title": 'Hasil pencarian untuk "{query}":',
  "model.search.no_results": 'Model "{query}" tidak ditemukan',
  "model.search.search_again": "↩ Cari lagi",
  "model.search.error": "Gagal mencari",
  "model.button.back": "⬅️ Kembali",
  "model.providers.button": "🗂 Provider",
  "model.providers.title": "Pilih provider dari daftar:",
  "model.providers.empty": "⚠️ Tidak ada provider yang terhubung",
  "model.providers.error": "Gagal memuat daftar provider",
  "model.providers.page_indicator": "Halaman {current}/{total}",
  "model.providers.prev_page": "⬅️ Sebelumnya",
  "model.providers.next_page": "Berikutnya ➡️",
  "model.provider_models.title": "{provider} — pilih model:",
  "model.provider_models.empty": "⚠️ Tidak ada model yang tersedia untuk {provider}",
  "model.provider_models.page_indicator": "Halaman {current}/{total}",

  "variant.model_not_selected_callback": "Kesalahan: model belum dipilih",
  "variant.changed_message": "✅ Varian diubah menjadi: {name}",
  "variant.change_error_callback": "Gagal mengubah varian",
  "variant.select_model_first": "⚠️ Pilih model terlebih dahulu",
  "variant.menu.empty": "⚠️ Tidak ada varian yang tersedia",
  "variant.menu.current": "Varian saat ini: {name}\n\nPilih varian:",
  "variant.menu.error": "🔴 Gagal memuat daftar varian",

  "runtime.container.command_unavailable": "⚠️ Perintah ini tidak tersedia di image Docker.",

  "task.prompt.schedule":
    "⏰ Kirim jadwal tugas dalam bahasa alami.\n\nContoh:\n- setiap 5 menit\n- setiap hari pukul 17:00\n- besok pukul 12:00",
  "task.schedule_empty": "⚠️ Jadwal tidak boleh kosong.",
  "task.parse.in_progress": "⏳ Mengurai jadwal...",
  "task.parse_error":
    "🔴 Gagal mengurai jadwal.\n\n{message}\n\nKirim ulang jadwal dalam bentuk yang lebih jelas.",
  "task.schedule_preview":
    "✅ Jadwal diurai\n\nIni yang saya pahami: {summary}\n{cronLine}Zona waktu: {timezone}\nJenis: {kind}\nDijalankan berikutnya: {nextRunAt}",
  "task.schedule_preview.cron": "Cron: {cron}",
  "task.prompt.body": "📝 Sekarang kirim apa yang harus dilakukan bot sesuai jadwal.",
  "task.prompt_empty": "⚠️ Teks tugas tidak boleh kosong.",
  "task.created":
    "✅ Tugas terjadwal dibuat\n\nTugas: {description}\nProyek: {project}\nAgent: {agent}\nModel: {model}\nJadwal: {schedule}\n{cronLine}Dijalankan berikutnya: {nextRunAt}",
  "task.created.cron": "Cron: {cron}",
  "task.button.retry_schedule": "🔁 Masukkan ulang jadwal",
  "task.button.cancel": "❌ Batal",
  "task.retry_schedule_callback": "Memasukkan ulang jadwal...",
  "task.inactive_callback": "Alur tugas terjadwal ini tidak aktif",
  "task.inactive": "⚠️ Pembuatan tugas terjadwal tidak aktif. Jalankan /task lagi.",
  "task.blocked.expected_input":
    "⚠️ Selesaikan dulu penyiapan tugas terjadwal saat ini dengan mengirim teks atau menggunakan tombol di pesan jadwal.",
  "task.blocked.command_not_allowed":
    "⚠️ Perintah ini tidak tersedia selama pembuatan tugas terjadwal aktif.",
  "task.limit_reached": "⚠️ Batas tugas tercapai ({limit}). Hapus dulu salah satu tugas terjadwal.",
  "task.schedule_too_frequent":
    "Jadwal berulang terlalu sering. Interval paling cepat 5 menit sekali.",
  "task.kind.cron": "berulang",
  "task.kind.once": "sekali",
  "task.run.success": "⏰ Tugas terjadwal selesai: {description}",
  "task.run.error": "🔴 Tugas terjadwal gagal: {description}\n\nKesalahan: {error}",
  "task.run.error.folder_missing": "The project folder no longer exists: {path}",
  "task.run.error.interactive_question":
    "Tugas terjadwal meminta pertanyaan interaktif, jadi tidak bisa lanjut tanpa pengawasan.",
  "task.run.error.interactive_permission":
    "Tugas terjadwal meminta izin interaktif, jadi tidak bisa lanjut tanpa pengawasan.",

  "commands.download.not_file": "Path ini bukan file",
  "cmd.description.rename": "Ganti nama sesi saat ini",

  "cmd.description.open": "Tambah proyek dengan menelusuri direktori",
  "open.no_subfolders": "📭 Tidak ada subfolder",
  "open.subfolder_count": "{count} subfolder",
  "open.subfolders_count": "{count} subfolder",
  "ls.access_denied": "⛔ Akses ditolak: path di luar proyek saat ini",
  "ls.scan_error": "🔴 Tidak dapat menampilkan direktori",
  "local_command.empty_output": "Perintah tidak menghasilkan output.",
  "local_command.failed": "Perintah gagal dengan exit code {exitCode}: {stderr}",
  "local_command.timeout": "Perintah kehabisan waktu.",
  "cmd.description.models": "Browse models",
  "cmd.description.model": "Select provider/model",
  "cmd.description.agent": "Select agent",
  "cmd.description.variant": "Select reasoning variant",
  "cmd.description.compact": "Compact session context",
  "cmd.description.download": "Download a local file",
  "cmd.description.attach": "Attach a local text file",
  "cmd.description.permission": "Answer a permission request",
  "cmd.description.answer": "Answer OpenCode questions",
  "cmd.description.cancel": "Reject pending questions",
  "cmd.description.context": "Inspect session token usage",
  "cmd.description.revert": "Revert to a user message",
  "cmd.description.fork": "Fork the current session",
};
