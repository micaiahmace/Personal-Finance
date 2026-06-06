import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENCRYPTION_PREFIX = "enc:v1:";

type JsonRecord = Record<string, unknown>;

export function dataEncryptionConfigured() {
  return Boolean(getRawDataKey());
}

export function encryptSensitiveString(value: string) {
  const key = getDataKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSensitiveString(value: string) {
  if (!value.startsWith(ENCRYPTION_PREFIX)) return value;

  const key = getDataKey();
  const [ivText, authTagText, encryptedText] = value.slice(ENCRYPTION_PREFIX.length).split(".");
  if (!ivText || !authTagText || !encryptedText) {
    throw new Error("Encrypted value is malformed");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagText, "base64url"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]);
  return decrypted.toString("utf8");
}

export function sanitizeCategorizationPayload(payload: { categories: unknown[]; rules: unknown[]; transactions: unknown[] }) {
  const shareAmounts = process.env.AI_SHARE_TRANSACTION_AMOUNTS === "true";

  return {
    privacy: {
      exactAmountsShared: shareAmounts,
      balancesShared: false,
      accountNumbersShared: false,
      plaidTokensShared: false,
      notesShared: false
    },
    categories: asArray(payload.categories).map((category) => {
      const item = asRecord(category);
      return {
        id: asString(item.id),
        name: asString(item.name),
        icon: asString(item.icon),
        groupId: asString(item.groupId)
      };
    }),
    rules: asArray(payload.rules).map((rule) => {
      const item = asRecord(rule);
      return {
        pattern: asString(item.pattern),
        matchType: asString(item.matchType),
        categoryId: asString(item.categoryId),
        enabled: item.enabled === true
      };
    }),
    transactions: asArray(payload.transactions).map((transaction) => {
      const item = asRecord(transaction);
      const amount = asNumber(item.amount);
      const sanitized: JsonRecord = {
        id: asString(item.id),
        date: asString(item.date),
        name: asString(item.name),
        merchant: asString(item.merchant),
        amountDirection: amount > 0 ? "inflow" : amount < 0 ? "outflow" : "unknown"
      };

      if (shareAmounts && amount !== 0) {
        sanitized.roundedAmount = Math.round(Math.abs(amount));
      }

      return sanitized;
    })
  };
}

export function safeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.includes("APP_DATA_KEY")) {
    return error.message;
  }

  return fallback;
}

function getRawDataKey() {
  return process.env.APP_DATA_KEY || process.env.DATA_ENCRYPTION_KEY || "";
}

function getDataKey() {
  const raw = getRawDataKey();
  if (!raw) {
    throw new Error("Missing APP_DATA_KEY in .env. Add a long random value before connecting real accounts.");
  }

  return createHash("sha256").update(raw).digest();
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
