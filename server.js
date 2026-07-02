// server.js — e-Dziennik SP im. Starego Dębu — kompletny backend REST API
// Uruchomienie: npm install && npm start  (działa lokalnie, zero zewnętrznych usług)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db");
const { signToken, requireAuth, requireDirection, hashPassword, checkPassword } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ═══════════════════════════════════════════════════════════════════════════
// Pomocnicze: czy nauczyciel ma dostęp do danego teacher_class_subject
// ═══════════════════════════════════════════════════════════════════════════
function tcsBelongsToTeacher(tcsId, teacherId) {
  const row = db.prepare(`SELECT teacher_id FROM teacher_class_subject WHERE id = ?`).get(tcsId);
  return row && row.teacher_id === teacherId;
}
function isDirection(role) {
  return role === "director" || role === "vice_director";
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH — lista nauczycieli (ekran wyboru) + logowanie
// ═══════════════════════════════════════════════════════════════════════════

// Lista wszystkich nauczycieli — do ekranu wyboru kafelkiem (dane publiczne, bez haseł)
app.get("/api/teachers", (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.full_name, t.first_name, t.last_name, t.role, t.photo_url, t.is_special,
           (t.password_hash IS NOT NULL) AS has_password,
           GROUP_CONCAT(DISTINCT s.name) AS subjects
    FROM teachers t
    LEFT JOIN teacher_class_subject tcs ON tcs.teacher_id = t.id
    LEFT JOIN subjects s ON s.id = tcs.subject_id
    WHERE t.active = 1
    GROUP BY t.id
    ORDER BY t.role DESC, t.last_name
  `).all();
  res.json(rows.map(r => ({ ...r, subjects: r.subjects ? r.subjects.split(",") : [] })));
});

// Logowanie: jeśli nauczyciel nie ma jeszcze hasła -> loguje się samym kliknięciem (tryb demo/szkolny intranet)
// Jeśli ma hasło ustawione -> wymagane jest podanie go.
app.post("/api/auth/login", (req, res) => {
  const { teacherId, password } = req.body;
  const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ? AND active = 1`).get(teacherId);
  if (!teacher) return res.status(404).json({ error: "Nie znaleziono nauczyciela." });

  if (teacher.password_hash) {
    if (!password) return res.status(401).json({ error: "To konto wymaga hasła." });
    if (!checkPassword(password, teacher.password_hash)) {
      return res.status(401).json({ error: "Nieprawidłowe hasło." });
    }
  }
  // Brak hasła ustawionego = logowanie otwarte (zaufana sieć szkolna / tryb startowy)

  const token = signToken(teacher);
  res.json({
    token,
    teacher: { id: teacher.id, full_name: teacher.full_name, role: teacher.role, is_special: !!teacher.is_special }
  });
});

// Ustawienie / zmiana własnego hasła (po zalogowaniu)
app.post("/api/auth/set-password", requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Hasło musi mieć min. 4 znaki." });
  }
  db.prepare(`UPDATE teachers SET password_hash = ? WHERE id = ?`)
    .run(hashPassword(newPassword), req.teacher.id);
  res.json({ ok: true });
});

// Kim jestem (weryfikacja tokenu)
app.get("/api/auth/me", requireAuth, (req, res) => {
  const t = db.prepare(`SELECT id, full_name, role, is_special FROM teachers WHERE id = ?`).get(req.teacher.id);
  res.json(t);
});

// ═══════════════════════════════════════════════════════════════════════════
// MOJE PRZYDZIAŁY — klasy / przedmioty zalogowanego nauczyciela
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/me/assignments", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT tcs.id AS tcs_id, c.id AS class_id, c.label AS class_label, s.id AS subject_id, s.name AS subject_name
    FROM teacher_class_subject tcs
    JOIN classes c ON c.id = tcs.class_id
    JOIN subjects s ON s.id = tcs.subject_id
    WHERE tcs.teacher_id = ?
    ORDER BY c.grade, c.section
  `).all(req.teacher.id);
  res.json(rows);
});

// Klasy widoczne dla nauczyciela (dyrekcja widzi wszystkie)
app.get("/api/me/classes", requireAuth, (req, res) => {
  if (isDirection(req.teacher.role)) {
    const all = db.prepare(`SELECT id, label, grade, section FROM classes ORDER BY grade, section`).all();
    return res.json(all);
  }
  const rows = db.prepare(`
    SELECT DISTINCT c.id, c.label, c.grade, c.section
    FROM teacher_class_subject tcs JOIN classes c ON c.id = tcs.class_id
    WHERE tcs.teacher_id = ? ORDER BY c.grade, c.section
  `).all(req.teacher.id);
  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════════════════
// UCZNIOWIE
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/classes/:classId/students", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, first_name, last_name FROM students WHERE class_id = ? AND active = 1 ORDER BY last_name`).all(req.params.classId);
  res.json(rows);
});

app.post("/api/classes/:classId/students", requireAuth, (req, res) => {
  const { first_name, last_name } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: "Imię i nazwisko są wymagane." });
  const info = db.prepare(`INSERT INTO students (class_id, first_name, last_name) VALUES (?,?,?)`)
    .run(req.params.classId, first_name, last_name);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete("/api/students/:id", requireAuth, (req, res) => {
  db.prepare(`UPDATE students SET active = 0 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// OCENY — zabezpieczone: nauczyciel widzi/edytuje tylko swoje teacher_class_subject
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/grades", requireAuth, (req, res) => {
  const { classId, subjectId, studentId } = req.query;
  let query = `
    SELECT g.*, s.first_name, s.last_name, sub.name AS subject_name, c.label AS class_label
    FROM grades g
    JOIN teacher_class_subject tcs ON tcs.id = g.teacher_class_subject_id
    JOIN students s ON s.id = g.student_id
    JOIN subjects sub ON sub.id = tcs.subject_id
    JOIN classes c ON c.id = tcs.class_id
    WHERE 1=1
  `;
  const params = [];
  if (!isDirection(req.teacher.role)) {
    query += ` AND tcs.teacher_id = ?`;
    params.push(req.teacher.id);
  }
  if (classId) { query += ` AND c.id = ?`; params.push(classId); }
  if (subjectId) { query += ` AND sub.id = ?`; params.push(subjectId); }
  if (studentId) { query += ` AND s.id = ?`; params.push(studentId); }
  query += ` ORDER BY g.given_at DESC`;
  res.json(db.prepare(query).all(...params));
});

app.post("/api/grades", requireAuth, (req, res) => {
  const { studentId, tcsId, value, weight, description, category, givenAt } = req.body;
  if (!studentId || !tcsId || !value) return res.status(400).json({ error: "Brak wymaganych pól." });
  if (value < 1 || value > 6) return res.status(400).json({ error: "Ocena musi być w zakresie 1-6." });

  if (!isDirection(req.teacher.role) && !tcsBelongsToTeacher(tcsId, req.teacher.id)) {
    return res.status(403).json({ error: "Nie uczysz tego przedmiotu w tej klasie." });
  }

  const info = db.prepare(`
    INSERT INTO grades (student_id, teacher_class_subject_id, value, weight, description, category, given_at, created_by)
    VALUES (?,?,?,?,?,?,COALESCE(?, date('now')),?)
  `).run(studentId, tcsId, value, weight || 1, description || null, category || null, givenAt || null, req.teacher.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Wpis wielu ocen naraz (tryb "okienko po okienku" jak w Librusie)
app.post("/api/grades/bulk", requireAuth, (req, res) => {
  const { tcsId, entries } = req.body; // entries: [{studentId, value, description}]
  if (!tcsId || !Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: "Brak danych do zapisania." });
  }
  if (!isDirection(req.teacher.role) && !tcsBelongsToTeacher(tcsId, req.teacher.id)) {
    return res.status(403).json({ error: "Nie uczysz tego przedmiotu w tej klasie." });
  }

  const insert = db.prepare(`
    INSERT INTO grades (student_id, teacher_class_subject_id, value, description, created_by)
    VALUES (?,?,?,?,?)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      if (r.value == null) continue;
      insert.run(r.studentId, tcsId, r.value, r.description || null, req.teacher.id);
    }
  });
  tx(entries);
  res.status(201).json({ ok: true, count: entries.filter(e => e.value != null).length });
});

app.delete("/api/grades/:id", requireAuth, (req, res) => {
  const grade = db.prepare(`SELECT teacher_class_subject_id FROM grades WHERE id = ?`).get(req.params.id);
  if (!grade) return res.status(404).json({ error: "Nie znaleziono oceny." });
  if (!isDirection(req.teacher.role) && !tcsBelongsToTeacher(grade.teacher_class_subject_id, req.teacher.id)) {
    return res.status(403).json({ error: "Brak uprawnień do usunięcia tej oceny." });
  }
  db.prepare(`DELETE FROM grades WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// FREKWENCJA
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/attendance", requireAuth, (req, res) => {
  const { classId, date } = req.query;
  let query = `
    SELECT a.*, s.first_name, s.last_name, c.label AS class_label
    FROM attendance a
    JOIN teacher_class_subject tcs ON tcs.id = a.teacher_class_subject_id
    JOIN students s ON s.id = a.student_id
    JOIN classes c ON c.id = tcs.class_id
    WHERE 1=1
  `;
  const params = [];
  if (!isDirection(req.teacher.role)) { query += ` AND tcs.teacher_id = ?`; params.push(req.teacher.id); }
  if (classId) { query += ` AND c.id = ?`; params.push(classId); }
  if (date) { query += ` AND a.date = ?`; params.push(date); }
  res.json(db.prepare(query).all(...params));
});

app.post("/api/attendance", requireAuth, (req, res) => {
  const { studentId, tcsId, date, status } = req.body;
  if (!studentId || !tcsId || !date || !status) return res.status(400).json({ error: "Brak wymaganych pól." });

  if (!isDirection(req.teacher.role) && !tcsBelongsToTeacher(tcsId, req.teacher.id)) {
    return res.status(403).json({ error: "Nie uczysz tego przedmiotu w tej klasie." });
  }

  // Reguła: zajęcia weekendowe nauczyciela "specjalnego" (np. Rzątkowski) są zawsze usprawiedliwione
  const teacherRow = db.prepare(`
    SELECT t.is_special FROM teacher_class_subject tcs JOIN teachers t ON t.id = tcs.teacher_id WHERE tcs.id = ?
  `).get(tcsId);
  const dow = new Date(date + "T12:00:00").getDay(); // 0=Niedz, 6=Sob
  let finalStatus = status;
  let autoExcused = 0;
  if (teacherRow?.is_special && (dow === 0 || dow === 6) && status === "nieobecny") {
    finalStatus = "usprawiedliwiony";
    autoExcused = 1;
  }

  db.prepare(`
    INSERT INTO attendance (student_id, teacher_class_subject_id, date, status, auto_excused, marked_by)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(student_id, teacher_class_subject_id, date)
    DO UPDATE SET status = excluded.status, auto_excused = excluded.auto_excused, marked_by = excluded.marked_by
  `).run(studentId, tcsId, date, finalStatus, autoExcused, req.teacher.id);

  res.json({ ok: true, status: finalStatus, autoExcused: !!autoExcused });
});

// ═══════════════════════════════════════════════════════════════════════════
// UWAGI
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/students/:studentId/notes", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, t.full_name AS teacher_name FROM student_notes n
    JOIN teachers t ON t.id = n.teacher_id
    WHERE n.student_id = ? ORDER BY n.created_at DESC
  `).all(req.params.studentId);
  res.json(rows);
});

app.post("/api/students/:studentId/notes", requireAuth, (req, res) => {
  const { content, category } = req.body;
  if (!content) return res.status(400).json({ error: "Treść uwagi jest wymagana." });
  const info = db.prepare(`INSERT INTO student_notes (student_id, teacher_id, content, category) VALUES (?,?,?,?)`)
    .run(req.params.studentId, req.teacher.id, content, category || "neutralna");
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete("/api/notes/:id", requireAuth, (req, res) => {
  const note = db.prepare(`SELECT teacher_id FROM student_notes WHERE id = ?`).get(req.params.id);
  if (!note) return res.status(404).json({ error: "Nie znaleziono uwagi." });
  if (!isDirection(req.teacher.role) && note.teacher_id !== req.teacher.id) {
    return res.status(403).json({ error: "Możesz usuwać tylko własne uwagi." });
  }
  db.prepare(`DELETE FROM student_notes WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// SPRAWDZIANY / ZAPOWIEDZI
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/tests", requireAuth, (req, res) => {
  let query = `
    SELECT te.*, c.label AS class_label, sub.name AS subject_name
    FROM tests te
    JOIN teacher_class_subject tcs ON tcs.id = te.teacher_class_subject_id
    JOIN classes c ON c.id = tcs.class_id
    JOIN subjects sub ON sub.id = tcs.subject_id
    WHERE 1=1
  `;
  const params = [];
  if (!isDirection(req.teacher.role)) { query += ` AND tcs.teacher_id = ?`; params.push(req.teacher.id); }
  query += ` ORDER BY te.test_date`;
  res.json(db.prepare(query).all(...params));
});

app.post("/api/tests", requireAuth, (req, res) => {
  const { tcsId, topic, testType, testDate } = req.body;
  if (!tcsId || !topic || !testDate) return res.status(400).json({ error: "Brak wymaganych pól." });
  if (testDate < new Date().toISOString().split("T")[0]) {
    return res.status(400).json({ error: "Data zapowiedzi nie może być w przeszłości." });
  }
  if (!isDirection(req.teacher.role) && !tcsBelongsToTeacher(tcsId, req.teacher.id)) {
    return res.status(403).json({ error: "Nie uczysz tego przedmiotu w tej klasie." });
  }
  const info = db.prepare(`
    INSERT INTO tests (teacher_class_subject_id, topic, test_type, test_date, created_by)
    VALUES (?,?,?,?,?)
  `).run(tcsId, topic, testType || "sprawdzian", testDate, req.teacher.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete("/api/tests/:id", requireAuth, (req, res) => {
  const test = db.prepare(`SELECT teacher_class_subject_id FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "Nie znaleziono zapowiedzi." });
  if (!isDirection(req.teacher.role) && !tcsBelongsToTeacher(test.teacher_class_subject_id, req.teacher.id)) {
    return res.status(403).json({ error: "Brak uprawnień." });
  }
  db.prepare(`DELETE FROM tests WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// PLAN LEKCJI
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/timetable/me", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT te.day_of_week, te.is_sporadic, te.room,
           ls.id AS slot, ls.start_time, ls.end_time,
           c.label AS class_label, sub.name AS subject_name
    FROM timetable_entries te
    JOIN teacher_class_subject tcs ON tcs.id = te.teacher_class_subject_id
    JOIN lesson_slots ls ON ls.id = te.lesson_slot_id
    JOIN classes c ON c.id = tcs.class_id
    JOIN subjects sub ON sub.id = tcs.subject_id
    WHERE tcs.teacher_id = ?
    ORDER BY ls.id, te.day_of_week
  `).all(req.teacher.id);
  res.json(rows);
});

app.get("/api/timetable/class/:classId", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT te.day_of_week, te.is_sporadic, te.room,
           ls.id AS slot, ls.start_time, ls.end_time,
           sub.name AS subject_name, t.full_name AS teacher_name
    FROM timetable_entries te
    JOIN teacher_class_subject tcs ON tcs.id = te.teacher_class_subject_id
    JOIN lesson_slots ls ON ls.id = te.lesson_slot_id
    JOIN subjects sub ON sub.id = tcs.subject_id
    JOIN teachers t ON t.id = tcs.teacher_id
    WHERE tcs.class_id = ?
    ORDER BY ls.id, te.day_of_week
  `).all(req.params.classId);
  res.json(rows);
});

// Dodanie wpisu do planu — z walidacją "ten sam nauczyciel nie ma 2 lekcji w tym samym slocie"
app.post("/api/timetable", requireAuth, (req, res) => {
  const { tcsId, dayOfWeek, slotId, isSporadic, room } = req.body;
  if (!isDirection(req.teacher.role) && !tcsBelongsToTeacher(tcsId, req.teacher.id)) {
    return res.status(403).json({ error: "Brak uprawnień." });
  }
  const conflict = db.prepare(`
    SELECT te.id FROM timetable_entries te
    JOIN teacher_class_subject tcs ON tcs.id = te.teacher_class_subject_id
    JOIN teacher_class_subject tcs2 ON tcs2.id = ?
    WHERE te.day_of_week = ? AND te.lesson_slot_id = ? AND tcs.teacher_id = tcs2.teacher_id
  `).get(tcsId, dayOfWeek, slotId);
  if (conflict) return res.status(409).json({ error: "Nauczyciel ma już zajęcia w tym terminie." });

  const info = db.prepare(`
    INSERT INTO timetable_entries (teacher_class_subject_id, day_of_week, lesson_slot_id, is_sporadic, room)
    VALUES (?,?,?,?,?)
  `).run(tcsId, dayOfWeek, slotId, isSporadic ? 1 : 0, room || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// ═══════════════════════════════════════════════════════════════════════════
// WIADOMOŚCI — pełna separacja per nauczyciel + ogłoszenia ogólnoszkolne
// ═══════════════════════════════════════════════════════════════════════════

// Skrzynka odbiorcza zalogowanego nauczyciela (prywatne wątki + ogłoszenia szkolne)
app.get("/api/messages/inbox", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.thread_id, m.sender_label, m.body, m.msg_type, m.sent_at, m.sent_date,
           mt.subject, mt.school_wide,
           (mrs.read_at IS NOT NULL) AS is_read
    FROM messages m
    JOIN message_threads mt ON mt.id = m.thread_id
    LEFT JOIN message_thread_participants mtp ON mtp.thread_id = mt.id AND mtp.teacher_id = ?
    LEFT JOIN message_read_state mrs ON mrs.message_id = m.id AND mrs.teacher_id = ?
    WHERE mt.school_wide = 1 OR mtp.teacher_id = ?
    ORDER BY m.sent_at DESC
  `).all(req.teacher.id, req.teacher.id, req.teacher.id);
  res.json(rows);
});

// Wyślij nową wiadomość — do konkretnego nauczyciela LUB jako ogłoszenie ogólnoszkolne (tylko dyrekcja)
app.post("/api/messages", requireAuth, (req, res) => {
  const { subject, body, msgType, recipientTeacherId, schoolWide, senderLabel } = req.body;
  if (!subject || !body) return res.status(400).json({ error: "Temat i treść są wymagane." });
  if (schoolWide && !isDirection(req.teacher.role)) {
    return res.status(403).json({ error: "Tylko dyrekcja może wysyłać ogłoszenia ogólnoszkolne." });
  }
  if (!schoolWide && !recipientTeacherId) {
    return res.status(400).json({ error: "Podaj odbiorcę lub oznacz jako ogłoszenie ogólnoszkolne." });
  }

  const today = new Date().toISOString().split("T")[0];

  const tx = db.transaction(() => {
    const threadInfo = db.prepare(`INSERT INTO message_threads (subject, school_wide) VALUES (?,?)`)
      .run(subject, schoolWide ? 1 : 0);
    const threadId = threadInfo.lastInsertRowid;

    if (!schoolWide) {
      db.prepare(`INSERT INTO message_thread_participants (thread_id, teacher_id) VALUES (?,?)`)
        .run(threadId, recipientTeacherId);
      db.prepare(`INSERT INTO message_thread_participants (thread_id, teacher_id) VALUES (?,?)`)
        .run(threadId, req.teacher.id);
    }

    const msgInfo = db.prepare(`
      INSERT INTO messages (thread_id, sender_teacher_id, sender_label, body, msg_type, sent_date)
      VALUES (?,?,?,?,?,?)
    `).run(threadId, req.teacher.id, senderLabel || req.teacher.full_name, body, msgType || "info", today);

    return msgInfo.lastInsertRowid;
  });

  const messageId = tx();
  res.status(201).json({ id: messageId });
});

app.post("/api/messages/:id/read", requireAuth, (req, res) => {
  db.prepare(`
    INSERT INTO message_read_state (message_id, teacher_id, read_at)
    VALUES (?,?,datetime('now'))
    ON CONFLICT(message_id, teacher_id) DO UPDATE SET read_at = excluded.read_at
  `).run(req.params.id, req.teacher.id);
  res.json({ ok: true });
});

app.delete("/api/messages/:id", requireAuth, (req, res) => {
  // Usunięcie wiadomości — tylko nadawca lub dyrekcja
  const msg = db.prepare(`SELECT sender_teacher_id FROM messages WHERE id = ?`).get(req.params.id);
  if (!msg) return res.status(404).json({ error: "Nie znaleziono wiadomości." });
  if (!isDirection(req.teacher.role) && msg.sender_teacher_id !== req.teacher.id) {
    return res.status(403).json({ error: "Możesz usuwać tylko własne wiadomości." });
  }
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// STATYSTYKI
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/stats/school", requireAuth, requireDirection, (req, res) => {
  const studentCount = db.prepare(`SELECT COUNT(*) AS c FROM students WHERE active=1`).get().c;
  const gradeCount = db.prepare(`SELECT COUNT(*) AS c FROM grades`).get().c;
  const noteCount = db.prepare(`SELECT COUNT(*) AS c FROM student_notes`).get().c;
  const classAverages = db.prepare(`
    SELECT c.label, ROUND(AVG(g.value),2) AS avg, COUNT(g.id) AS cnt
    FROM classes c
    LEFT JOIN teacher_class_subject tcs ON tcs.class_id = c.id
    LEFT JOIN grades g ON g.teacher_class_subject_id = tcs.id
    GROUP BY c.id ORDER BY avg DESC
  `).all();
  res.json({ studentCount, gradeCount, noteCount, classAverages });
});

// ═══════════════════════════════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Auto-seed: jeśli baza jest pusta (0 nauczycieli) — wypełnij automatycznie ──
function autoSeed() {
  try {
    const count = db.prepare("SELECT COUNT(*) AS c FROM teachers").get().c;
    if (count > 0) {
      console.log(`🌳 Baza danych gotowa — ${count} nauczycieli w systemie.`);
      return;
    }
    console.log("🌳 Pusta baza — uruchamiam automatyczny seed...");
    require("./seed.js");
  } catch (e) {
    console.error("Błąd auto-seed:", e.message);
  }
}

app.listen(PORT, () => {
  console.log(`\n🌳 e-Dziennik backend działa: http://localhost:${PORT}`);
  console.log(`   Sprawdź: http://localhost:${PORT}/api/health`);
  console.log(`   Baza danych: ${process.env.DB_PATH || "./data/dziennik.db"}\n`);
  autoSeed();
});
