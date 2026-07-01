// db.js — połączenie z SQLite + automatyczne wykonanie schema.sql przy starcie
require("dotenv").config();
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || "./data/dziennik.db";

// Upewnij się, że folder na bazę istnieje
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Wykonaj schemat (CREATE TABLE IF NOT EXISTS — bezpieczne przy wielokrotnym uruchomieniu)
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

module.exports = db;
