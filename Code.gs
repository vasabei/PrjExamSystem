/************************************************************************
 * ระบบสอบออนไลน์ เตรียมสอบเข้า จภ. / วมว. / สาธิต มน.
 * ไฟล์: Code.gs  (โค้ดหลังบ้าน) — เวอร์ชันปรับปรุง Anti-Repeat 48h Cooldown
 * ------------------------------------------------------------------
 * จุดเด่นเวอร์ชันนี้:
 *   • คลังข้อสอบ 1,000 ข้อเป๊ะ พร้อมระบบกรองห้ามสุ่มข้อสอบซ้ำภายใน 48 ชั่วโมง
 *   • บันทึกรหัสข้อสอบทั้งหมดที่สุ่มทำลงในคอลัมน์ J (รหัสข้อทั้งหมดที่ทำ)
 *   • คอลัมน์ K = รหัสข้อที่ตอบผิด, คอลัมน์ L = ความยาก
 *   • คอลัมน์ M = NotifyMarks (LINE Notify) ทำงานตามปกติ ไม่ทับซ้อน
 ************************************************************************/

 
// Global Memory Caching for Ultra-Fast Random Question Generation
var _cachedBank = null;
var _cachedSettings = null;
var _cachedRealAns = null;

function clearExamCache() {
  _cachedRealAns = null;
  _cachedBank = null;
  _cachedSettings = null;
}

const SHEET_BANK   = 'คลังข้อสอบ';
const SHEET_CONFIG = 'ตั้งค่าสอบ';
const SHEET_STATS  = 'สถิติ';
const SHEET_REAL_SETS = 'ชุดข้อสอบจริง';
const SHEET_REAL_ANS  = 'เฉลยข้อสอบจริง';

const IMAGE_FOLDER_ID   = '1iFpR0gTYb69FV2npZFHw-33cGYA2_uCw';
const IMAGE_FOLDER_NAME = 'exam_images';
const REAL_IMAGE_FOLDER_ID   = '178oVV62dFUxp6HllchgoHKsh2cIj8ktb';
const REAL_IMAGE_FOLDER_NAME = 'real_exam_images';
const _imgCache = {};


/* ===== 1) ให้บริการหน้าเว็บ ===== */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบสอบออนไลน์ เตรียมสอบเข้า ม.1 / ม.4')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}


/* ===== 2) ข้อมูลเริ่มต้นสำหรับหน้าแรก ===== */
function getInitData() {
  var email = getUserEmail();
  var studentName = getStudentDisplayName(email);
  var bank = getQuestionBank();
  var levels = [];
  var byLevel = {};
  bank.forEach(function (q) {
    if (!q.level) return;
    if (levels.indexOf(q.level) < 0) levels.push(q.level);
    byLevel[q.level] = byLevel[q.level] || {};
    byLevel[q.level][q.subject] = (byLevel[q.level][q.subject] || 0) + 1;
  });
  levels.sort();
  return {
    email: email,
    studentName: studentName,
    levels: levels,
    byLevel: byLevel,
    total: bank.length,
    realSets: getRealExamSets(),
    defaults: getSettings()
  };
}

var _studentMapCache = null;

function getStudentMap_() {
  if (_studentMapCache) return _studentMapCache;
  var map = { keys: {}, defaultName: '' };
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONFIG);
    if (sh && sh.getLastRow() >= 1) {
      var values = sh.getRange(1, 2, sh.getLastRow(), 2).getValues();
      for (var i = 0; i < values.length; i++) {
        var key = String(values[i][0] || '').trim().toLowerCase();
        var val = String(values[i][1] || '').trim();
        if (key && val) {
          if (key === 'ชื่อผู้ทำ') map.defaultName = val;
          else map.keys[key] = val;
        }
      }
    }
  } catch (err) {}
  _studentMapCache = map;
  return _studentMapCache;
}

function getStudentDisplayName(email) {
  if (!email) return 'ผู้ทำข้อสอบ';
  var targetEmail = String(email).trim().toLowerCase();
  var map = getStudentMap_();
  if (map.keys[targetEmail]) return map.keys[targetEmail];
  for (var k in map.keys) {
    if (String(map.keys[k]).trim().toLowerCase() === targetEmail) return map.keys[k];
  }
  if (map.defaultName && (targetEmail === 'ลูก' || targetEmail === '')) return map.defaultName;
  return email;
}

function getUserEmail() {
  var e = '';
  try { e = (Session.getActiveUser().getEmail() || '').toString().trim(); } catch (err) {}
  if (!e) { try { e = (Session.getEffectiveUser().getEmail() || '').toString().trim(); } catch (err) {} }
  if (!e) e = getConfiguredStudent();
  return e || '';
}

function getConfiguredStudent() {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONFIG);
    if (!sh) return '';
    var values = sh.getRange(1, 2, sh.getLastRow(), 3).getValues();
    for (var i = 0; i < values.length; i++) {
      var label = (values[i][0] || '').toString().trim();
      if (label === 'ชื่อผู้ทำ') return (values[i][1] || '').toString().trim();
    }
  } catch (err) {}
  return '';
}


/* ===== 3) อ่านค่าตั้งต้น ===== */
function getSettings() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONFIG);
  var map = {};
  if (sh) {
    var values = sh.getRange(1, 2, sh.getLastRow(), 3).getValues();
    values.forEach(function (row) {
      var label = (row[0] || '').toString().trim();
      if (label) map[label] = row[1];
    });
  }
  _cachedSettings = {
    mode:          (map['โหมด'] || 'ฝึกรายชุด').toString().trim(),
    level:         (map['ระดับ'] || 'ทั้งหมด').toString().trim(),
    subject:       (map['วิชา'] || 'ทั้งหมด').toString().trim(),
    set:           (map['ชุด'] || '').toString().trim(),
    difficulty:    (map['ความยาก'] || 'ทั้งหมด').toString().trim(),
    count:         Number(map['จำนวนข้อ']) || 10,
    minutes:       Number(map['เวลา (นาที)']) || 0,
    shuffleQ:      (map['สลับลำดับข้อ'] || 'ใช่').toString().trim() === 'ใช่',
    shuffleOpt:    (map['สลับตัวเลือก'] || 'ใช่').toString().trim() === 'ใช่',
    showAnswer:    (map['แสดงเฉลยทันที'] || 'ใช่').toString().trim() === 'ใช่',
    cooldownHours: Number(map['ระยะห้ามสุ่มซ้ำ (ชั่วโมง)']) || 48,
    student:       (map['ชื่อผู้ทำ'] || '').toString().trim()
  };
  return _cachedSettings;
}


/* ===== 4) อ่านคลังข้อสอบ ===== */
function getQuestionBank() {
  if (_cachedBank && _cachedBank.length > 0) {
    return _cachedBank;
  }
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BANK);
  var data = sh.getDataRange().getValues();
  var header = data[0];
  var idx = {};
  header.forEach(function (h, i) { idx[h.toString().trim()] = i; });

  var res = data.slice(1)
    .filter(function (r) { return r[idx['รหัส']]; })
    .map(function (r) {
      return {
        id:         r[idx['รหัส']],
        set:        (r[idx['ชุด']] || '').toString().trim(),
        subject:    (r[idx['วิชา']] || '').toString().trim(),
        level:      (r[idx['ระดับ']] || '').toString().trim(),
        topic:      (r[idx['บท']] || '').toString().trim(),
        difficulty: (r[idx['ความยาก']] || '').toString().trim(),
        canShuffle: (r[idx['สลับได้']] || 'ได้').toString().trim() !== 'ไม่',
        question:   r[idx['โจทย์']],
        choices: { 'ก': r[idx['ก']], 'ข': r[idx['ข']], 'ค': r[idx['ค']], 'ง': r[idx['ง']] },
        answer:  (r[idx['เฉลย']] || '').toString().trim(),
        explain: r[idx['อธิบาย']],
        image:   (r[idx['รูป']] || '').toString().trim()
      };
    });
  _cachedBank = res;
  return _cachedBank;
}


/* ===== 5) สร้างชุดข้อสอบ — พร้อมระบบ Anti-Repeat Cooldown 48h ===== */
function buildExam(opts) {
  opts = opts || {};
  try {
    var s = getSettings();

    ['mode', 'level', 'subject', 'set', 'difficulty', 'student'].forEach(function (k) {
      if (opts[k] !== undefined && opts[k] !== null && opts[k] !== '') s[k] = opts[k];
    });
    if (opts.count)   s.count   = Number(opts.count);
    if (opts.minutes !== undefined && opts.minutes !== null) s.minutes = Number(opts.minutes);
    if (opts.shuffleQ   !== undefined) s.shuffleQ   = !!opts.shuffleQ;
    if (opts.shuffleOpt !== undefined) s.shuffleOpt = !!opts.shuffleOpt;
    if (opts.showAnswer !== undefined) s.showAnswer = !!opts.showAnswer;
    if (opts.cooldownHours !== undefined) s.cooldownHours = Number(opts.cooldownHours);
    else s.cooldownHours = 48; // ค่าเริ่มต้น 48 ชั่วโมง (2 วัน)

    var bank = getQuestionBank();
    if (s.level !== 'ทั้งหมด')      bank = bank.filter(function (q) { return q.level === s.level; });
    if (s.subject !== 'ทั้งหมด')    bank = bank.filter(function (q) { return q.subject === s.subject; });
    var useBalancedDifficulty = (s.difficulty === 'ทั้งหมด');
    if (!useBalancedDifficulty) bank = bank.filter(function (q) { return q.difficulty === s.difficulty; });
    if (s.mode === 'ฝึกรายชุด' && s.set) bank = bank.filter(function (q) { return q.set === s.set; });

    if (bank.length === 0) {
      Logger.log('buildExam กรองแล้วเหลือ 0 ข้อ | level=' + s.level + ' subject=' + s.subject);
      return { error: 'ไม่พบข้อสอบ: ' + s.level + ' / ' + s.subject + ' / ' + s.difficulty };
    }

    // --- กรองข้อสอบที่เคยสุ่มทำภายในช่วง Cooldown (เช่น 48 ชั่วโมงล่าสุด) ---
    var studentEmail = s.student || opts.student || getUserEmail();
    if (s.cooldownHours > 0 && studentEmail) {
      var recentlyServed = getRecentlyServedIds_(studentEmail, s.cooldownHours);
      var freshBank = bank.filter(function (q) { return !recentlyServed[q.id]; });
      if (freshBank.length >= s.count) {
        bank = freshBank;
      } else if (freshBank.length > 0) {
        // ถ้าข้อสอบที่ไม่เคยทำมีจำนวนไม่พอ ให้เติมข้อสอบเก่าสุ่มวนสลับเพื่อให้อ่านได้ครบจำนวนเสมอ
        var needed = s.count - freshBank.length;
        var oldBank = bank.filter(function (q) { return recentlyServed[q.id]; });
        if (s.shuffleQ) oldBank = shuffleArray(oldBank);
        bank = freshBank.concat(oldBank.slice(0, needed));
      }
    }

    var chosen = useBalancedDifficulty
      ? pickBalancedDifficulty(bank, s.count, s.shuffleQ)
      : (s.shuffleQ ? shuffleArray(bank) : bank).slice(0, Math.min(s.count, bank.length));
    var items = chosen.map(function (q) { return prepareItem(q, s.shuffleOpt); });

    return {
      settings: {
        mode: s.mode, level: s.level, subject: s.subject, set: s.set,
        difficulty: s.difficulty, minutes: s.minutes,
        showAnswer: s.showAnswer, student: studentEmail || 'ไม่ระบุ',
        cooldownHours: s.cooldownHours
      },
      items: items,
      total: items.length
    };
  } catch (err) {
    Logger.log('buildExam ล้ม: ' + err);
    return { error: 'สร้างข้อสอบไม่สำเร็จ: ' + (err && err.message ? err.message : err) };
  }
}

// อ่านรหัสข้อสอบทั้งหมดที่เคยสุ่มทำภายใน N ชั่วโมงล่าสุด (รองรับทั้งชื่อเล่นและอีเมลเดิม)
function getRecentlyServedIds_(student, hours) {
  hours = Number(hours) || 48;
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  if (!sh) return {};
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
  var startRow = Math.max(2, lastRow - 300);
  var numRows = lastRow - startRow + 1;
  var rows = sh.getRange(startRow, 1, numRows, 13).getValues();
  var currentEmail = getUserEmail();
  var now = new Date().getTime();
  var cutoffMs = hours * 60 * 60 * 1000;
  var out = {};

  rows.forEach(function (r) {
    if (!r[0]) return;
    var rowStudent = String(r[1] || '').trim();
    if (student && !isSameStudent_(rowStudent, student, currentEmail)) return;
    var when = toDate_(r[0]);
    if (!when) return;
    if (now - when.getTime() <= cutoffMs) {
      // Col J (index 9) = รหัสข้อทั้งหมดที่ทำ
      var servedStr = String(r[9] || '').trim();
      if (servedStr) {
        servedStr.split(',').forEach(function (id) {
          id = id.trim();
          if (id) out[id] = true;
        });
      }
    }
  });
  return out;
}

function isSameStudent_(rowStudent, targetStudent, targetEmail) {
  if (!rowStudent) return false;
  var r = String(rowStudent).trim().toLowerCase();
  var t1 = String(targetStudent || '').trim().toLowerCase();
  var t2 = String(targetEmail || '').trim().toLowerCase();
  if (t1 && r === t1) return true;
  if (t2 && r === t2) return true;
  var disp = getStudentDisplayName(r).toLowerCase();
  if (t1 && disp === t1) return true;
  return false;
}

function pickBalancedDifficulty(bank, count, shuffleQ) {
  var total = Math.min(Number(count) || 10, bank.length);
  var targets = {
    'ง่าย': Math.round(total * 0.20),
    'กลาง': Math.round(total * 0.40)
  };
  targets['ยาก'] = total - targets['ง่าย'] - targets['กลาง'];

  var buckets = { 'ง่าย': [], 'กลาง': [], 'ยาก': [] };
  bank.forEach(function (q) {
    if (buckets[q.difficulty]) buckets[q.difficulty].push(q);
  });
  ['ง่าย', 'กลาง', 'ยาก'].forEach(function (d) {
    if (shuffleQ) buckets[d] = shuffleArray(buckets[d]);
  });

  var chosen = [];
  var used = {};
  ['ง่าย', 'กลาง', 'ยาก'].forEach(function (d) {
    buckets[d].slice(0, targets[d]).forEach(function (q) {
      chosen.push(q);
      used[q.id] = true;
    });
  });

  if (chosen.length < total) {
    var rest = bank.filter(function (q) { return !used[q.id]; });
    if (shuffleQ) rest = shuffleArray(rest);
    rest.slice(0, total - chosen.length).forEach(function (q) { chosen.push(q); });
  }

  return shuffleQ ? shuffleArray(chosen) : chosen;
}

function prepareItem(q, shuffleOpt) {
  var order = ['ก', 'ข', 'ค', 'ง'];
  var opts = order
    .filter(function (k) { return q.choices[k] !== '' && q.choices[k] != null; })
    .map(function (k) { return { text: q.choices[k], correct: (k === q.answer) }; });

  if (shuffleOpt && q.canShuffle) opts = shuffleArray(opts);

  var cleanQuestion = String(q.question || '').replace(/\\n/g, '\n');
  var cleanExplain = String(q.explain || '').replace(/\\n/g, '\n');

  var labels = ['ก', 'ข', 'ค', 'ง'];
  var options = opts.map(function (o, i) {
    return {
      label: labels[i] || String(i + 1),
      text: String(o.text || '').replace(/\\n/g, '\n'),
      correct: o.correct
    };
  });
  var correctItem = options.filter(function (o) { return o.correct; })[0];

  return {
    id: q.id, subject: q.subject, level: q.level, topic: q.topic, difficulty: q.difficulty,
    question: cleanQuestion, options: options,
    answer: correctItem ? correctItem.label : '',
    explain: cleanExplain,
    image: q.image
  };
}


/* ===== 6) โหลดรูปภาพ ===== */
function getImage(filename) {
  if (!filename) return '';
  if (_imgCache[filename] !== undefined) return _imgCache[filename];
  try {
    var folder = getImageFolder();
    if (!folder) { _imgCache[filename] = ''; return ''; }
    var files = folder.getFilesByName(filename);
    if (!files.hasNext()) { _imgCache[filename] = ''; return ''; }
    var blob = files.next().getBlob();
    var url;
    if (/\.svg$/i.test(filename)) {
      var svg = blob.getDataAsString('UTF-8').replace(/^\uFEFF/, '');
      url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } else {
      var mime = blob.getContentType();
      if (/\.png$/i.test(filename)) mime = 'image/png';
      else if (/\.jpe?g$/i.test(filename)) mime = 'image/jpeg';
      else if (/\.gif$/i.test(filename)) mime = 'image/gif';
      url = 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
    }
    _imgCache[filename] = url;
    return url;
  } catch (e) {
    _imgCache[filename] = '';
    return '';
  }
}

function getRealImage(filename) {
  if (!filename) return '';
  var key = 'real:' + filename;
  if (_imgCache[key] !== undefined) return _imgCache[key];
  try {
    var folder = getRealImageFolder();
    if (!folder) { _imgCache[key] = ''; return ''; }
    var files = folder.getFilesByName(filename);
    if (!files.hasNext()) { _imgCache[key] = ''; return ''; }
    var blob = files.next().getBlob();
    var url;
    if (/\.svg$/i.test(filename)) {
      var svg = blob.getDataAsString('UTF-8').replace(/^\uFEFF/, '');
      url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } else {
      var mime = blob.getContentType();
      if (/\.png$/i.test(filename)) mime = 'image/png';
      else if (/\.jpe?g$/i.test(filename)) mime = 'image/jpeg';
      else if (/\.gif$/i.test(filename)) mime = 'image/gif';
      url = 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
    }
    _imgCache[key] = url;
    return url;
  } catch (e) {
    _imgCache[key] = '';
    return '';
  }
}

function getImageFolder() {
  try {
    if (IMAGE_FOLDER_ID) return DriveApp.getFolderById(IMAGE_FOLDER_ID);
    var it = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
    return it.hasNext() ? it.next() : null;
  } catch (e) { return null; }
}


/* ===== 7) บันทึกผล + ดึงประวัติ (ปรับใช้คอลัมน์ J = servedIds, K = wrongIds, L = diff) ===== */
function saveResult(result) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Bangkok';
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  // ตรวจสอบหัวคอลัมน์ J, K, L, M ให้ถูกต้องเสมอ
  if (String(sh.getRange('J1').getValue()).trim() === '') sh.getRange('J1').setValue('รหัสข้อทั้งหมดที่ทำ');
  if (String(sh.getRange('K1').getValue()).trim() === '') sh.getRange('K1').setValue('รหัสข้อที่ตอบผิด');
  if (String(sh.getRange('L1').getValue()).trim() === '') sh.getRange('L1').setValue('ความยาก');
  if (String(sh.getRange('M1').getValue()).trim() === '') sh.getRange('M1').setValue('สถานะการแจ้งเตือน');

  var rawStudent = getUserEmail() || result.student || 'ไม่ระบุ';
  var student = getStudentDisplayName(rawStudent);
  var served = (result.servedIds || []).join(', ');
  var wrong = (result.wrongIds || []).join(', ');
  var diff = result.difficulty || 'ทั้งหมด';

  // ส่งผลลัพธ์การแจ้งเตือนไปยัง Notify.gs
  var markStatus = 'sent';
  try {
    if (typeof notifyResult === 'function') {
      var resStatus = notifyResult(result, student, now);
      if (resStatus === 'sent' || resStatus === 'skip') {
        markStatus = resStatus;
      }
    }
  } catch (err) {
    Logger.log('Notify call error: ' + err);
  }

  // คอลัมน์ A ถึง M (J=served, K=wrong, L=diff, M=markStatus)
  var row = [
    now, student, result.mode || '', result.level || '',
    result.subject || '', result.total || 0, result.correct || 0, result.score || 0,
    result.minutesUsed || 0, served, wrong, diff, markStatus
  ];

  var colA = sh.getRange(1, 1, sh.getMaxRows(), 1).getValues();
  var lastA = 1;
  for (var i = 0; i < colA.length; i++) {
    if (colA[i][0] !== '' && colA[i][0] !== null) lastA = i + 1;
  }
  sh.getRange(lastA + 1, 1, 1, row.length).setValues([row]);
  SpreadsheetApp.flush();

  return {
    datetime: now, student: student, mode: result.mode || '', level: result.level || '',
    subject: result.subject || '', total: result.total || 0, correct: result.correct || 0,
    score: result.score || 0, minutes: result.minutesUsed || 0, served: served, wrong: wrong, difficulty: diff
  };
}

function getHistory(student, limit) {
  limit = limit || 15;
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];

  // อ่านคอลัมน์ A ถึง L (12 คอลัมน์)
  var rows = sh.getRange(2, 1, last - 1, 12).getValues()
    .filter(function (r) { return r[0] !== '' && r[0] !== null; });

  return rows.slice(-limit).reverse().map(function (r) {
    return {
      datetime: fmtDate(r[0]), student: r[1], mode: r[2], level: r[3], subject: r[4],
      total: r[5], correct: r[6], score: r[7], minutes: r[8],
      served: r[9] || '', wrong: r[10] || '', difficulty: r[11] || ''
    };
  });
}

function fmtDate(v) {
  if (v instanceof Date) {
    var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Bangkok';
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
  }
  return v;
}

function debugStats() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  Logger.log('เจอแท็บสถิติ: ' + (sh ? 'ใช่' : 'ไม่เจอ!'));
  if (!sh) return;
  Logger.log('แถวสุดท้าย (getLastRow): ' + sh.getLastRow());
  var h = getHistory('', 20);
  Logger.log('getHistory คืนค่า ' + h.length + ' แถว');
}

function getRealImageFolder() {
  try {
    if (REAL_IMAGE_FOLDER_ID) return DriveApp.getFolderById(REAL_IMAGE_FOLDER_ID);
    var it = DriveApp.getFoldersByName(REAL_IMAGE_FOLDER_NAME);
    return it.hasNext() ? it.next() : null;
  } catch (e) { return null; }
}


/* ===== 5.1) ข้อสอบชุดจริง/Pretest ===== */
function getRealExamSets() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REAL_SETS);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var idx = headerIndex(data[0]);
  var res = data.slice(1).filter(function (r) {
    return r[idx['รหัสชุด']] && String(r[idx['เปิดใช้']] || '').toUpperCase() !== 'FALSE';
  }).map(function (r) {
    return {
      id: String(r[idx['รหัสชุด']] || '').trim(),
      name: String(r[idx['ชื่อชุด']] || '').trim(),
      source: String(r[idx['แหล่งที่มา']] || '').trim(),
      year: r[idx['ปี']] || '',
      level: String(r[idx['ระดับ']] || '').trim(),
      subject: String(r[idx['วิชา']] || '').trim(),
      total: Number(r[idx['จำนวนข้อ']]) || 0,
      minutes: Number(r[idx['เวลานาที']]) || 0,
      scoreFull: Number(r[idx['คะแนนเต็ม']]) || Number(r[idx['จำนวนข้อ']]) || 0,
      note: String(r[idx['หมายเหตุ']] || '').trim()
    };
  });
  return res;
}

function shuffleOptionsAndFixAnswer(options, originalAnswerKey) {
  if (!options || !options.length) return { options: options, answer: originalAnswerKey };
  var labels = ['ก', 'ข', 'ค', 'ง', 'จ'];
  var correctOpt = null;
  for (var i = 0; i < options.length; i++) {
    if (options[i].label === originalAnswerKey) {
      correctOpt = options[i];
      break;
    }
  }
  var shuffled = shuffleArray(options.slice());
  var newAnswerKey = originalAnswerKey;
  var newOptions = shuffled.map(function(opt, idx) {
    var newLabel = labels[idx] || String(idx + 1);
    if (correctOpt && opt === correctOpt) {
      newAnswerKey = newLabel;
    }
    return {
      label: newLabel,
      text: opt.text,
      correct: false
    };
  });
  return {
    options: newOptions,
    answer: newAnswerKey
  };
}

function cleanSpecialSymbols(text) {
  if (!text || typeof text !== 'string') return text || '';
  var str = text;
  str = str.replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, ' ');
  str = str.replace(/\\"/g, '"').replace(/\\'/g, "'");
  str = str.replace(/®/g, '→').replace(/-->/g, '→').replace(/->/g, '→');
  str = str.replace(/3\s*ป¬/g, '3 ปี')
           .replace(/สิ้นป¬/g, 'สิ้นปี')
           .replace(/ป¬ดิบชื้น/g, 'ป่าดิบชื้น')
           .replace(/ป¬/g, 'ปี')
           .replace(/จีโนไทป”/g, 'จีโนไทป์')
           .replace(/ป”จจัย/g, 'ปัจจัย')
           .replace(/ข"อ/g, 'ข้อ')
           .replace(/เข0า/g, 'เข้า')
           .replace(/ค4าย/g, 'ค่าย')
           .replace(/ผู%ป-วย/g, 'ผู้ป่วย')
           .replace(/ป-วย/g, 'ป่วย');
  return str;
}

function buildRealExam(setId, count, showAnswer, shuffleQ, shuffleOpt) {
  var sets = getRealExamSets();
  var set = sets.filter(function (s) { return s.id === setId; })[0];
  if (!set) return { error: 'ไม่พบชุดข้อสอบจริงที่เลือก' };

  var data;
  if (_cachedRealAns) {
    data = _cachedRealAns;
  } else {
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_REAL_ANS);
    if (!sh || sh.getLastRow() < 2) return { error: 'ยังไม่มีข้อมูลข้อสอบจริงในชีต ' + SHEET_REAL_ANS };
    data = sh.getDataRange().getValues();
    _cachedRealAns = data;
  }
  var idx = headerIndex(data[0]);
  var allItems = data.slice(1).filter(function (r) {
    return String(r[idx['รหัสชุด']] || '').trim() === setId;
  }).map(function (r) {
    var rawQ = cleanSpecialSymbols(String(r[idx['โจทย์']] || '').trim());
    var rawExplain = cleanSpecialSymbols(String(r[idx['หมายเหตุ']] || '').trim());
    var optionText = parseRealOptions(String(r[idx['ตัวเลือก']] || 'ก,ข,ค,ง'));
    return {
      id: String(r[idx['รหัสข้อ']] || '').trim(),
      subject: set.subject,
      level: set.level,
      topic: set.name,
      difficulty: 'ข้อสอบจริง',
      question: rawQ || 'ดูโจทย์จากภาพข้อสอบจริงด้านล่าง แล้วเลือกคำตอบ',
      options: optionText,
      answer: String(r[idx['เฉลย']] || '').trim(),
      explain: rawExplain,
      image: String(r[idx['รูป']] || '').trim(),
      pdfPage: r[idx['หน้า PDF']] || ''
    };
  });

  if (!allItems.length) {
    return { error: 'ชุดข้อสอบ "' + set.name + '" (รหัสชุด: ' + setId + ') ยังไม่มีข้อมูลข้อสอบในชีต "' + SHEET_REAL_ANS + '" กรุณาตรวจสอบว่าใส่นำเข้าข้อมูลเรียบร้อยแล้ว' };
  }

  // Sort initially by question number
  allItems.sort(function (a, b) {
    return Number(a.id.replace(/.*Q/, '')) - Number(b.id.replace(/.*Q/, ''));
  });

  var targetCount = Number(count) || allItems.length;
  var items = [];

  // Question Shuffling: การสลับลำดับข้อไม่ทำให้เฉลยเพี้ยน คงไว้เพื่อความหลากหลาย
  var doShuffleQ = (shuffleQ !== false);
  if (doShuffleQ) {
    var shuffled = shuffleArray(allItems);
    items = shuffled.slice(0, targetCount);
  } else {
    items = allItems.slice(0, targetCount);
  }

  // Option Shuffling (ก, ข, ค, ง): ปิดในข้อสอบจริงเสมอ
  // เพราะข้อสอบจริงมีตัวเลือกแบบ "1 และ 4" / "A และ C" ที่สลับแล้วเฉลยเพี้ยน
  var doShuffleOpt = false;
  if (doShuffleOpt) {
    items = items.map(function(q) {
      var shuffledRes = shuffleOptionsAndFixAnswer(q.options, q.answer);
      return {
        id: q.id,
        subject: q.subject,
        level: q.level,
        topic: q.topic,
        difficulty: q.difficulty,
        question: q.question,
        options: shuffledRes.options,
        answer: shuffledRes.answer,
        explain: q.explain,
        image: q.image,
        pdfPage: q.pdfPage
      };
    });
  }

  // Proportional timer calculation: 100 questions = 180 minutes (1.8 minutes / question)
  var totalExamTime = set.minutes || 180;
  var totalExamCount = set.total || allItems.length;
  var minutes = Math.round((items.length / totalExamCount) * totalExamTime);
  if (minutes < 1) minutes = 1;

  var setDisplayName = set.name;
  if (items.length < allItems.length) {
    setDisplayName += ' (สุ่ม ' + items.length + ' ข้อ)';
  }

  var answered = items.filter(function (q) { return q.answer; }).length;
  return {
    settings: {
      mode: 'ข้อสอบชุดจริง', level: set.level, subject: set.subject, set: setDisplayName,
      difficulty: 'ข้อสอบจริง', minutes: minutes, showAnswer: !!showAnswer,
      student: getUserEmail(), source: set.source, answerKeyReady: answered === items.length
    },
    items: items,
    total: items.length
  };
}

function parseRealOptions(raw) {
  raw = String(raw || '').trim();
  if (!raw) raw = 'ก,ข,ค,ง';
  
  var labels = ['ก', 'ข', 'ค', 'ง', 'จ'];
  var re = /(?:^|\s+)([กขคงจ])\.\s+/g;
  var pos = [];
  var m;
  // If string starts with prefix without preceding space
  if (/^([กขคงจ])\.\s+/.test(raw)) {
    re = /(?:^|\s*)([กขคงจ])\.\s+/g;
  }
  while ((m = re.exec(raw)) !== null) {
    pos.push({ label: m[1], idx: m.index, end: m.index + m[0].length });
  }
  
  if (pos.length >= 2) {
    var result = [];
    for (var i = 0; i < pos.length; i++) {
      var start = pos[i].end;
      var end = (i + 1 < pos.length) ? pos[i+1].idx : raw.length;
      var text = raw.substring(start, end).trim().replace(/,$/, '').trim();
      result.push({ label: pos[i].label, text: text, correct: false });
    }
    return result;
  }
  
  var parts = raw.indexOf('\n') >= 0 ? raw.split(/\n+/) : raw.split(',');
  return parts.map(function (part, i) {
    part = String(part || '').trim();
    var matchOpt = part.match(/^([กขคงจ])\s*[\.\)]?\s*(.*)$/);
    var label = matchOpt ? matchOpt[1] : (labels[i] || String(i + 1));
    var text = matchOpt ? (matchOpt[2] || label) : part;
    return { label: label, text: text, correct: false };
  }).filter(function (o) { return o.label; });
}

function headerIndex(header) {
  var idx = {};
  header.forEach(function (h, i) { idx[String(h || '').trim()] = i; });
  return idx;
}

function shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; 
    a[i] = a[j]; 
    a[j] = t;
  }
  return a;
}