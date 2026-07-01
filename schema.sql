-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMAT BAZY — e-Dziennik SP im. Starego Dębu (wersja SQLite, lokalny backend)
-- Ten plik jest wykonywany automatycznie przez server.js przy pierwszym starcie.
-- ═══════════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS school (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT 'Szkoła Podstawowa im. Starego Dębu',
    mission     TEXT
);

CREATE TABLE IF NOT EXISTS teachers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    full_name       TEXT NOT NULL UNIQUE,
    email           TEXT UNIQUE,
    password_hash   TEXT,                 -- NULL dopóki nauczyciel nie ustawi hasła (logowanie kafelkiem na start)
    photo_url       TEXT,
    role            TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','director','vice_director')),
    is_special      INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subjects (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS classes (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    grade   INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 8),
    section TEXT NOT NULL CHECK (section IN ('A','B','C','D')),
    label   TEXT NOT NULL UNIQUE,          -- "5A"
    homeroom_teacher_id INTEGER REFERENCES teachers(id)
);

CREATE TABLE IF NOT EXISTS students (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
);

-- Centralny węzeł: "nauczyciel X uczy przedmiotu Y w klasie Z"
CREATE TABLE IF NOT EXISTS teacher_class_subject (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    UNIQUE (teacher_id, class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS lesson_slots (
    id          INTEGER PRIMARY KEY,   -- 1..8
    start_time  TEXT NOT NULL,
    end_time    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timetable_entries (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_class_subject_id   INTEGER NOT NULL REFERENCES teacher_class_subject(id) ON DELETE CASCADE,
    day_of_week                 INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Pon..6=Niedz
    lesson_slot_id               INTEGER NOT NULL REFERENCES lesson_slots(id),
    is_sporadic                  INTEGER NOT NULL DEFAULT 0,
    room                         TEXT,
    UNIQUE (teacher_class_subject_id, day_of_week, lesson_slot_id)
);

CREATE TABLE IF NOT EXISTS grades (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id                  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    teacher_class_subject_id   INTEGER NOT NULL REFERENCES teacher_class_subject(id) ON DELETE CASCADE,
    value                        INTEGER NOT NULL CHECK (value BETWEEN 1 AND 6),
    weight                       INTEGER NOT NULL DEFAULT 1,
    description                  TEXT,
    category                     TEXT,
    given_at                     TEXT NOT NULL DEFAULT (date('now')),
    created_by                   INTEGER NOT NULL REFERENCES teachers(id),
    created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id                  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    teacher_class_subject_id   INTEGER NOT NULL REFERENCES teacher_class_subject(id) ON DELETE CASCADE,
    date                         TEXT NOT NULL,
    status                       TEXT NOT NULL CHECK (status IN ('obecny','nieobecny','spoznienie','usprawiedliwiony')),
    auto_excused                 INTEGER NOT NULL DEFAULT 0,
    marked_by                    INTEGER NOT NULL REFERENCES teachers(id),
    created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (student_id, teacher_class_subject_id, date)
);

CREATE TABLE IF NOT EXISTS student_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    category    TEXT DEFAULT 'neutralna' CHECK (category IN ('pozytywna','negatywna','neutralna')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tests (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_class_subject_id   INTEGER NOT NULL REFERENCES teacher_class_subject(id) ON DELETE CASCADE,
    topic                        TEXT NOT NULL,
    test_type                    TEXT NOT NULL DEFAULT 'sprawdzian' CHECK (test_type IN ('sprawdzian','kartkowka','odpowiedz')),
    test_date                    TEXT NOT NULL,
    created_by                   INTEGER NOT NULL REFERENCES teachers(id),
    created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_threads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject     TEXT NOT NULL,
    school_wide INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_thread_participants (
    thread_id   INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id           INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_teacher_id   INTEGER REFERENCES teachers(id),
    sender_label        TEXT NOT NULL,
    body                 TEXT NOT NULL,
    msg_type             TEXT NOT NULL DEFAULT 'info' CHECK (msg_type IN ('info','uwaga','sukces')),
    sent_at              TEXT NOT NULL DEFAULT (datetime('now')),
    sent_date            TEXT NOT NULL DEFAULT (date('now'))   -- używane do walidacji "nie z przeszłości"
);

CREATE TABLE IF NOT EXISTS message_read_state (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    read_at     TEXT,
    PRIMARY KEY (message_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_students_class       ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_tcs_teacher           ON teacher_class_subject(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tcs_class             ON teacher_class_subject(class_id);
CREATE INDEX IF NOT EXISTS idx_grades_student        ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_tcs            ON grades(teacher_class_subject_id);
CREATE INDEX IF NOT EXISTS idx_att_student            ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_att_date               ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_notes_student          ON student_notes(student_id);
CREATE INDEX IF NOT EXISTS idx_tests_tcs              ON tests(teacher_class_subject_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread        ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_timetable_tcs          ON timetable_entries(teacher_class_subject_id);
