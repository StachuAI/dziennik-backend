// seed.js — wypełnia bazę danymi szkoły: nauczyciele, klasy, uczniowie, przydziały, plan lekcji
// Uruchomienie: npm run seed  (bezpieczne do powtórnego uruchomienia — czyści i wypełnia od nowa)
require("dotenv").config();
const db = require("./db");
const fs = require("fs");
const path = require("path");

const teachersData = JSON.parse(fs.readFileSync(path.join(__dirname, "teachers_data.json"), "utf-8"));

const PRZEDMIOTY = [
  "Matematyka","Język polski","Język angielski","Historia","Biologia","Chemia","Fizyka",
  "Wychowanie fizyczne","Informatyka","Religia","Plastyka","Muzyka","Technika","Geografia",
  "Wiedza ogólna","Edukacja wczesnoszkolna","WoS","Edukacja dla bezpieczeństwa","Przyroda",
  "Wychowanie do życia w rodzinie","Doradztwo zawodowe","Język niemiecki"
];

const IMIONA_M = ["Adam","Bartosz","Dawid","Filip","Grzegorz","Jakub","Kamil","Łukasz","Michał","Piotr","Rafał","Sebastian","Tomasz","Wojciech","Krzysztof"];
const IMIONA_K = ["Anna","Barbara","Dorota","Ewa","Katarzyna","Magdalena","Natalia","Paulina","Zofia","Aleksandra","Alicja","Beata","Julia","Karolina","Laura"];
const NAZWISKA_M = ["Kowalski","Nowak","Wiśniewski","Wójcik","Kowalczyk","Kamiński","Lewandowski","Zieliński","Szymański","Woźniak","Dąbrowski","Kozłowski"];
const NAZWISKA_K = NAZWISKA_M.map(n => n.endsWith("ski") ? n.slice(0,-2)+"ska" : n.endsWith("cki") ? n.slice(0,-2)+"cka" : n);

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

console.log("🌳 Czyszczenie istniejących danych...");
db.exec(`
  DELETE FROM message_read_state; DELETE FROM messages; DELETE FROM message_thread_participants; DELETE FROM message_threads;
  DELETE FROM tests; DELETE FROM student_notes; DELETE FROM attendance; DELETE FROM grades;
  DELETE FROM timetable_entries; DELETE FROM teacher_class_subject;
  DELETE FROM students; DELETE FROM classes; DELETE FROM subjects; DELETE FROM teachers; DELETE FROM lesson_slots;
`);

console.log("🌳 Wstawianie godzin lekcyjnych...");
const slotInsert = db.prepare(`INSERT INTO lesson_slots (id, start_time, end_time) VALUES (?,?,?)`);
const SLOTS = [
  [1,"08:00","08:45"],[2,"08:50","09:35"],[3,"09:40","10:25"],[4,"10:30","11:15"],
  [5,"11:30","12:15"],[6,"12:20","13:05"],[7,"13:10","13:55"],[8,"14:00","14:45"]
];
SLOTS.forEach(s => slotInsert.run(...s));

console.log("🌳 Wstawianie przedmiotów...");
const subjectInsert = db.prepare(`INSERT INTO subjects (name) VALUES (?)`);
const subjectIds = {};
PRZEDMIOTY.forEach(p => { subjectIds[p] = subjectInsert.run(p).lastInsertRowid; });

console.log("🌳 Wstawianie nauczycieli...");
const teacherInsert = db.prepare(`
  INSERT INTO teachers (first_name, last_name, full_name, role, is_special) VALUES (?,?,?,?,?)
`);
const teacherIds = {};
teachersData.forEach(t => {
  const parts = t.imie.split(" ");
  const first = parts[0], last = parts.slice(1).join(" ");
  const id = teacherInsert.run(first, last, t.imie, t.role, t.special ? 1 : 0).lastInsertRowid;
  teacherIds[t.imie] = { id, przedmiot: t.przedmiot, role: t.role, special: t.special };
});
console.log(`   ${teachersData.length} nauczycieli wstawionych.`);

console.log("🌳 Wstawianie klas i uczniów...");
const classInsert = db.prepare(`INSERT INTO classes (grade, section, label) VALUES (?,?,?)`);
const studentInsert = db.prepare(`INSERT INTO students (class_id, first_name, last_name) VALUES (?,?,?)`);
const classIds = {};
const usedNames = new Set();

for (let grade = 1; grade <= 8; grade++) {
  for (const section of ["A","B","C","D"]) {
    const label = `${grade}${section}`;
    const classId = classInsert.run(grade, section, label).lastInsertRowid;
    classIds[label] = classId;

    const rng = seededRandom(label.charCodeAt(0) * 100 + grade);
    let added = 0, attempts = 0;
    while (added < 18 && attempts < 200) {
      attempts++;
      const isFemale = rng() < 0.5;
      const first = isFemale ? IMIONA_K[Math.floor(rng()*IMIONA_K.length)] : IMIONA_M[Math.floor(rng()*IMIONA_M.length)];
      const last = isFemale ? NAZWISKA_K[Math.floor(rng()*NAZWISKA_K.length)] : NAZWISKA_M[Math.floor(rng()*NAZWISKA_M.length)];
      const full = first + " " + last;
      if (usedNames.has(full)) continue;
      usedNames.add(full);
      studentInsert.run(classId, first, last);
      added++;
    }
  }
}
console.log(`   32 klasy, ${usedNames.size} uczniów wstawionych.`);

console.log("🌳 Tworzenie przydziałów nauczyciel↔klasa↔przedmiot...");
const tcsInsert = db.prepare(`INSERT OR IGNORE INTO teacher_class_subject (teacher_id, class_id, subject_id) VALUES (?,?,?)`);
const tcsLookup = db.prepare(`SELECT id FROM teacher_class_subject WHERE teacher_id=? AND class_id=? AND subject_id=?`);

function assignTCS(teacherName, classLabel, subjectName) {
  const t = teacherIds[teacherName];
  const c = classIds[classLabel];
  const s = subjectIds[subjectName];
  if (!t || !c || !s) return null;
  tcsInsert.run(t.id, c, s);
  return tcsLookup.get(t.id, c, s).id;
}

// Nauczyciele wczesnoszkolni -> przypisani do klas 1-3 (round-robin)
const wczesnoTeachers = teachersData.filter(t => t.przedmiot.includes("Edukacja wczesnoszkolna")).map(t => t.imie);
const klasyWczesno = [];
for (let g=1; g<=3; g++) for (const s of ["A","B","C","D"]) klasyWczesno.push(`${g}${s}`);
klasyWczesno.forEach((k, i) => {
  if (wczesnoTeachers.length) assignTCS(wczesnoTeachers[i % wczesnoTeachers.length], k, "Edukacja wczesnoszkolna");
});

// Nauczyciele przedmiotowi -> klasy 4-8, przydzielani deterministycznie per (klasa,przedmiot)
const subjectTeacherMap = {};
PRZEDMIOTY.forEach(p => {
  subjectTeacherMap[p] = teachersData.filter(t => t.przedmiot.split(",").map(s=>s.trim()).includes(p)).map(t=>t.imie);
});

const klasyStarsze = [];
for (let g=4; g<=8; g++) for (const s of ["A","B","C","D"]) klasyStarsze.push(`${g}${s}`);

const PRZEDMIOTY_4_8 = ["Matematyka","Język polski","Język angielski","Historia","Biologia","Chemia","Fizyka",
  "Wychowanie fizyczne","Informatyka","Religia","Plastyka","Muzyka","Technika","Geografia"];
const PRZEDMIOTY_7_8_EXTRA = ["WoS","Edukacja dla bezpieczeństwa"];
const PRZEDMIOTY_5_6_EXTRA = ["Przyroda","Wiedza ogólna"];

klasyStarsze.forEach(k => {
  const grade = parseInt(k);
  let subs = [...PRZEDMIOTY_4_8];
  if (grade >= 5 && grade <= 6) subs = subs.concat(PRZEDMIOTY_5_6_EXTRA.filter(s=>s!=="Wiedza ogólna"));
  if (grade >= 7) subs = subs.concat(PRZEDMIOTY_7_8_EXTRA);

  subs.forEach(p => {
    const candidates = subjectTeacherMap[p];
    if (candidates && candidates.length) {
      const rng = seededRandom(k.charCodeAt(0) + grade + p.length);
      const teacher = candidates[Math.floor(rng() * candidates.length)];
      assignTCS(teacher, k, p);
    }
  });
});

// Specjalny przypadek: Stanisław Rzątkowski uczy Wiedzy ogólnej WYŁĄCZNIE w 5A i 5D
const rzatkowskiTcs5A = assignTCS("Stanisław Rzątkowski", "5A", "Wiedza ogólna");
const rzatkowskiTcs5D = assignTCS("Stanisław Rzątkowski", "5D", "Wiedza ogólna");
console.log("   Przydziały utworzone.");

console.log("🌳 Wstawianie planu lekcji Stanisława Rzątkowskiego...");
// Reguły: druga zmiana (start ~13:50), bez wtorku, ta sama klasa nie 2x pod rząd,
// weekendy start ~10:30-11:30, sporadyczne
const ttInsert = db.prepare(`
  INSERT INTO timetable_entries (teacher_class_subject_id, day_of_week, lesson_slot_id, is_sporadic) VALUES (?,?,?,?)
`);
// dayOfWeek: 0=Pon,1=Wt,2=Śr,3=Czw,4=Pt,5=Sob,6=Niedz ; slot: 1..8
const rzPlan = [
  // [tcsId, day, slot, sporadic]
  [rzatkowskiTcs5A, 0, 7, 0], // Pon godz7 (13:10) 5A
  [rzatkowskiTcs5D, 0, 8, 0], // Pon godz8 (14:00) 5D
  [rzatkowskiTcs5D, 2, 7, 0], // Śr godz7 5D
  [rzatkowskiTcs5A, 2, 8, 0], // Śr godz8 5A
  [rzatkowskiTcs5A, 3, 7, 0], // Czw godz7 5A
  [rzatkowskiTcs5D, 3, 8, 0], // Czw godz8 5D
  [rzatkowskiTcs5D, 4, 7, 0], // Pt godz7 5D
  [rzatkowskiTcs5A, 5, 4, 1], // Sob godz4 (10:30) 5A ⭐
  [rzatkowskiTcs5D, 5, 5, 1], // Sob godz5 (11:30) 5D ⭐
  [rzatkowskiTcs5D, 6, 4, 1], // Niedz godz4 (10:30) 5D ⭐
];
rzPlan.forEach(([tcsId, day, slot, sporadic]) => {
  if (tcsId) ttInsert.run(tcsId, day, slot, sporadic);
});
console.log("   Plan Rzątkowskiego wstawiony (bez wtorku, bez powtórzeń klas pod rząd).");

console.log("🌳 Wstawianie przykładowego ogłoszenia powitalnego...");
const threadInfo = db.prepare(`INSERT INTO message_threads (subject, school_wide) VALUES (?,1)`)
  .run("Witamy w nowym systemie e-Dziennika");
db.prepare(`
  INSERT INTO messages (thread_id, sender_teacher_id, sender_label, body, msg_type, sent_date)
  VALUES (?,?,?,?,?,date('now'))
`).run(
  threadInfo.lastInsertRowid,
  teacherIds["Robert Plewka"].id,
  "Robert Plewka (Dyrektor)",
  "Witamy w nowym systemie e-Dziennika Szkoły Podstawowej im. Starego Dębu. Życzymy owocnej pracy!",
  "info"
);

console.log("\n✅ Baza danych wypełniona pomyślnie.");
console.log(`   Nauczycieli: ${teachersData.length}`);
console.log(`   Klas: 32`);
console.log(`   Uczniów: ${usedNames.size}`);
console.log("\nMożesz teraz uruchomić: npm start\n");
