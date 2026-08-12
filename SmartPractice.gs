/************************************************************************
 * SmartPractice.gs — โหมดซ่อมจุดอ่อน + เว้นระยะทวนซ้ำ
 * ------------------------------------------------------------------
 * ปรับปรุงรองรับโครงสร้างคอลัมน์ใหม่:
 *   - Col J (index 9)  = รหัสข้อทั้งหมดที่ทำ
 *   - Col K (index 10) = รหัสข้อที่ตอบผิด
 *   - Col L (index 11) = ความยาก
 ************************************************************************/

const AVOID_RECENT_DAYS = 2; // ป้องกันข้อสอบวนซ้ำใน 2 วัน (48 ชั่วโมง)


/* ============ อ่านประวัติของผู้ทำคนหนึ่ง (รองรับทั้งชื่อเล่นและอีเมลเดิม) ============ */
function getStudentHistory_(student) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var startRow = Math.max(2, lastRow - 500);
  var numRows = lastRow - startRow + 1;
  var rows = sh.getRange(startRow, 1, numRows, 12).getValues();
  var key = String(student || '').trim().toLowerCase();
  var currentEmail = getUserEmail();
  return rows.filter(function (r) {
    if (!r[0]) return false;
    if (!key) return true;
    var rowStudent = String(r[1] || '').trim();
    if (rowStudent.toLowerCase() === key) return true;
    if (currentEmail && rowStudent.toLowerCase() === currentEmail.toLowerCase()) return true;
    if (typeof getStudentDisplayName === 'function' && getStudentDisplayName(rowStudent).toLowerCase() === key) return true;
    return false;
  });
}

function toDate_(v) {
  if (v instanceof Date) return v;
  var d = new Date(String(v).replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d;
}


/* ============ 1) รหัสข้อที่เคยตอบผิด (นับความถี่ - คอลัมน์ K) ============ */
function getWrongStats(student) {
  var hist = getStudentHistory_(student);
  var wrongCount = {};   // รหัสข้อ -> ผิดกี่ครั้ง
  var lastSeen = {};     // รหัสข้อ -> เจอครั้งล่าสุดเมื่อไร
  hist.forEach(function (r) {
    var when = toDate_(r[0]);
    // Col K (index 10) = รหัสข้อที่ตอบผิด
    String(r[10] || '').split(',').forEach(function (id) {
      id = id.trim();
      if (!id) return;
      wrongCount[id] = (wrongCount[id] || 0) + 1;
      if (when && (!lastSeen[id] || when > lastSeen[id])) lastSeen[id] = when;
    });
  });
  return { wrongCount: wrongCount, lastSeen: lastSeen, attempts: hist.length };
}


/* ============ 2) สร้างข้อสอบ "ซ่อมจุดอ่อน" ============ */
function buildWeakExam(opts) {
  opts = opts || {};
  var student = opts.student || getUserEmail();
  var stats = getWrongStats(student);
  var ids = Object.keys(stats.wrongCount);

  if (!ids.length) {
    return JSON.stringify({ error: 'ยังไม่มีข้อที่เคยตอบผิด ลองทำข้อสอบปกติสักชุดก่อนนะ' });
  }

  var bank = getQuestionBank();
  var map = {};
  bank.forEach(function (q) { map[String(q.id).trim()] = q; });

  var pool = ids.map(function (id) { return map[id]; })
                .filter(function (q) { return !!q; });

  if (opts.level && opts.level !== 'ทั้งหมด')
    pool = pool.filter(function (q) { return q.level === opts.level; });
  if (opts.subject && opts.subject !== 'ทั้งหมด')
    pool = pool.filter(function (q) { return q.subject === opts.subject; });

  if (!pool.length) {
    return JSON.stringify({ error: 'ไม่มีข้อที่เคยตอบผิดในวิชา/ระดับที่เลือก ลองเลือกเป็น "ทุกวิชา" ดู' });
  }

  pool.sort(function (a, b) {
    return (stats.wrongCount[b.id] || 0) - (stats.wrongCount[a.id] || 0);
  });

  var count = Number(opts.count) || 10;
  var chosen = pool.slice(0, Math.min(count, pool.length));
  var items = chosen.map(function (q) {
    var it = prepareItem(q, true);
    it.wrongTimes = stats.wrongCount[q.id] || 0;
    return it;
  });

  return JSON.stringify({
    settings: {
      mode: 'ซ่อมจุดอ่อน',
      level: opts.level || 'ทั้งหมด',
      subject: opts.subject || 'ทั้งหมด',
      set: '', difficulty: 'จากข้อที่เคยผิด',
      minutes: Number(opts.minutes) || 0,
      showAnswer: (opts.showAnswer !== undefined ? !!opts.showAnswer : true),
      student: student
    },
    items: items,
    total: items.length,
    poolSize: pool.length
  });
}


/* ============ 3) ข้อสอบปกติ + เว้นระยะทวนซ้ำ (Spaced Repetition) ============ */
function buildExamSpaced(opts) {
  opts = opts || {};
  var days = (opts.avoidDays !== undefined) ? Number(opts.avoidDays) : AVOID_RECENT_DAYS;

  var exam = buildExam(opts);
  if (!exam || exam.error || days <= 0) return exam;

  try {
    var student = opts.student || getUserEmail();
    var recent = getRecentlySeenIds_(student, days);
    if (Object.keys(recent).length && exam.items) {
      var fresh = exam.items.filter(function (q) { return !recent[q.id]; });
      var seen  = exam.items.filter(function (q) { return recent[q.id]; });
      exam.items = fresh.concat(seen);
    }
  } catch (e) {
    Logger.log('spaced ข้ามการจัดเรียง: ' + e);
  }
  return exam;
}

// รหัสข้อที่เคยถูกสุ่มทำใน N วันล่าสุด (ดึงจาก Col J = รหัสข้อทั้งหมดที่ทำ)
function getRecentlySeenIds_(student, days) {
  var hist = getStudentHistory_(student);
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 2));
  var out = {};

  hist.forEach(function (r) {
    var when = toDate_(r[0]);
    if (when && when >= cutoff) {
      // Col J (index 9) = รหัสข้อทั้งหมดที่ทำ
      String(r[9] || '').split(',').forEach(function (id) {
        id = id.trim();
        if (id) out[id] = true;
      });
    }
  });
  return out;
}


/* ============ 4) สรุปจุดอ่อนรายบท ============ */
function getWeakTopics(student, limit) {
  limit = limit || 8;
  var stats = getWrongStats(student);
  var bank = getQuestionBank();
  var map = {};
  bank.forEach(function (q) { map[String(q.id).trim()] = q; });

  var byTopic = {};
  Object.keys(stats.wrongCount).forEach(function (id) {
    var q = map[id];
    if (!q) return;
    var k = q.subject + ' · ' + (q.topic || '-');
    byTopic[k] = (byTopic[k] || 0) + stats.wrongCount[id];
  });

  return JSON.stringify(Object.keys(byTopic)
    .map(function (k) { return { topic: k, wrong: byTopic[k] }; })
    .sort(function (a, b) { return b.wrong - a.wrong; })
    .slice(0, limit));
}