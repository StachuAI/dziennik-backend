// auth.js — logowanie kafelkiem (bez hasła, jak w demo) + opcjonalne hasło + JWT middleware
require("dotenv").config();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET || "zmien-mnie";

function signToken(teacher) {
  return jwt.sign(
    { id: teacher.id, full_name: teacher.full_name, role: teacher.role },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// Middleware: wymaga ważnego tokenu JWT w nagłówku Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Brak tokenu autoryzacji. Zaloguj się ponownie." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.teacher = payload; // { id, full_name, role }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token nieprawidłowy lub wygasł. Zaloguj się ponownie." });
  }
}

// Middleware: tylko dyrekcja (director / vice_director)
function requireDirection(req, res, next) {
  if (req.teacher.role !== "director" && req.teacher.role !== "vice_director") {
    return res.status(403).json({ error: "Tylko dyrekcja ma dostęp do tej operacji." });
  }
  next();
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}
function checkPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

module.exports = { signToken, requireAuth, requireDirection, hashPassword, checkPassword, JWT_SECRET };
