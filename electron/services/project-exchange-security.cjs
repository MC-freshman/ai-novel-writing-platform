const crypto = require("node:crypto");

const MAGIC = Buffer.from("AINOVELX1\n", "ascii");

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ""), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
  });
}

function isEncrypted(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  return input.length > MAGIC.length + 4 && input.subarray(0, MAGIC.length).equals(MAGIC);
}

async function encryptBuffer(buffer, password) {
  if (!String(password || "").trim()) return Buffer.from(buffer);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(buffer)), cipher.final()]);
  const header = Buffer.from(JSON.stringify({ algorithm: "AES-256-GCM", kdf: "scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") }), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([MAGIC, length, header, ciphertext]);
}

async function decryptBuffer(buffer, password) {
  const input = Buffer.from(buffer);
  if (!isEncrypted(input)) return input;
  if (!String(password || "")) throw new Error("这个项目交换包已加密，请输入密码。");
  const headerLength = input.readUInt32BE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const headerEnd = headerStart + headerLength;
  if (headerEnd >= input.length) throw new Error("加密项目交换包结构损坏。");
  try {
    const header = JSON.parse(input.subarray(headerStart, headerEnd).toString("utf8"));
    const key = await deriveKey(password, Buffer.from(header.salt, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
    decipher.setAuthTag(Buffer.from(header.tag, "base64"));
    return Buffer.concat([decipher.update(input.subarray(headerEnd)), decipher.final()]);
  } catch {
    throw new Error("项目交换包密码错误，或文件已经损坏。");
  }
}

module.exports = { decryptBuffer, encryptBuffer, isEncrypted, MAGIC };
