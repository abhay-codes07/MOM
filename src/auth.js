const crypto = require("crypto");

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createUser(email, password, role = "admin") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);

  return {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    role,
    salt,
    passwordHash,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };
}

function verifyPassword(user, password) {
  if (!user || !password) {
    return false;
  }

  const hashed = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hashed, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function signAuthToken(payload, secret, expiresInSeconds = 3600 * 8) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyAuthToken(token, secret) {
  if (!token || !secret || !token.includes(".")) {
    return null;
  }

  const [encoded, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function extractBearerToken(authHeader = "") {
  const value = String(authHeader || "");
  if (!value.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return value.slice(7).trim();
}

module.exports = {
  createUser,
  verifyPassword,
  signAuthToken,
  verifyAuthToken,
  extractBearerToken
};
