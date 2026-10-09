const fs = require('fs');
const path = require('path');

/**
 * A JSON file encrypted at rest with the OS keychain.
 *
 * `encryption` is Electron's `safeStorage` in the app (Windows DPAPI, macOS
 * Keychain, Linux libsecret) and a fake in tests. The data can only be
 * decrypted by the same OS user on the same machine; copying the file to
 * another computer or account makes it unreadable.
 *
 * Never falls back to plain text: if OS encryption is unavailable, writes fail.
 */
class EncryptedJsonStore {
  /**
   * @param {object} options
   * @param {string} options.file
   * @param {{ isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string }} options.encryption
   */
  constructor({ file, encryption }) {
    this.file = file;
    this.encryption = encryption;
  }

  isAvailable() {
    return this.encryption.isEncryptionAvailable();
  }

  /** Returns `fallback` if the file is missing, unreadable or was encrypted by another user/machine. */
  read(fallback) {
    if (!fs.existsSync(this.file) || !this.isAvailable()) return fallback;
    try {
      return JSON.parse(this.encryption.decryptString(fs.readFileSync(this.file)));
    } catch {
      return fallback;
    }
  }

  write(data) {
    if (!this.isAvailable()) throw new Error('OS encryption is not available, refusing to store secrets in plain text');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.encryption.encryptString(JSON.stringify(data)), { mode: 0o600 });
    fs.renameSync(tmp, this.file); // atomic replace
  }

  delete() {
    fs.rmSync(this.file, { force: true });
  }
}

module.exports = { EncryptedJsonStore };
