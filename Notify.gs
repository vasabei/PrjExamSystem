/************************************************************************
 * Notify.gs — แจ้งเตือนผลสอบเข้า LINE และ/หรือ อีเมล
 * ------------------------------------------------------------------
 * วิธีติดตั้ง:
 *   1) ในตัวแก้ไข Apps Script กด + ข้าง "Files" > Script > ตั้งชื่อ "Notify"
 *   2) วางโค้ดทั้งไฟล์นี้ลงไป
 *   3) กรอกค่าตั้งค่าด้านล่าง (LINE และ/หรือ อีเมล)
 *   4) ใน Code.gs ฟังก์ชัน saveResult หลังบรรทัด SpreadsheetApp.flush();
 *      ให้เพิ่มบรรทัด:   notifyResult(result, student, now);
 *   5) รัน testNotify() เพื่อทดสอบ แล้วค่อย Deploy เวอร์ชันใหม่
 *
 * หมายเหตุ: ถ้าไม่กรอกค่าใด ๆ ระบบจะข้ามการแจ้งเตือนไปเงียบ ๆ
 *           ไม่ทำให้การบันทึกผลสอบพัง
 ************************************************************************/


/* ==================== ⚙️ ตั้งค่าตรงนี้ ==================== */

// --- สวิตช์เปิด/ปิดแต่ละช่องทาง ---
const NOTIFY_LINE  = true;    // true = ส่งเข้า LINE
const NOTIFY_EMAIL = true;    // true = ส่งเข้าอีเมล

// --- LINE Messaging API ---
// TOKEN: developers.line.biz > Channel > แท็บ Messaging API > Issue channel access token (long-lived)
// TARGET: userId ของคุณ (ขึ้นต้น U... ดูที่แท็บ Basic settings > Your user ID)
//         หรือ groupId ของกลุ่ม (ขึ้นต้น C... ต้องได้จาก webhook ดูวิธีท้ายไฟล์)
const LINE_TOKEN  = 'PGrWJamPNzHTAgJbzoWaJVZ3Zf9PIQSS+LcnL3bxhXebrPsMvRbKYRKosdwy7s/LDiuPrQCJaJm5bP6QLvfI55XNQwHc8UDtxWG8F8Bj0o7hVMfpL4xJqFiwMdze+sfXImT83zW6p41KxgRK+QLu/gdB04t89/1O/w1cDnyilFU=';
const LINE_TARGET = 'C3f254f48c6d289a67f486cd64523fc95';

// --- อีเมล ---
// ใส่ได้หลายคนคั่นด้วยจุลภาค เช่น 'pa@gmail.com, ma@gmail.com'
// ถ้าเว้นว่าง จะส่งเข้าอีเมลเจ้าของสเปรดชีตเอง
const MAIL_TO = 'tu1463@gmail.com, vasabei@gmail.com';

// --- เงื่อนไขการส่ง ---
// 0   = ส่งแจ้งเตือนทุกครั้งที่ทำข้อสอบเสร็จ
// 50  = ส่งเฉพาะครั้งที่ได้คะแนนต่ำกว่า 50% (ไว้ดูเฉพาะตอนที่ควรเข้าไปช่วย)
const NOTIFY_ONLY_BELOW = 0;

/* ================== จบส่วนตั้งค่า ================== */


/**
 * ฟังก์ชันหลัก — เรียกจาก saveResult ใน Code.gs
 * result = อ็อบเจกต์ผลสอบ, student = อีเมล/ชื่อผู้ทำ, when = วันเวลาที่บันทึก
 */
function notifyResult(result, student, when) {
  try {
    var score = Number(result && result.score) || 0;
    if (NOTIFY_ONLY_BELOW > 0 && score >= NOTIFY_ONLY_BELOW) return 'skip';  // ผ่านเกณฑ์ ไม่ต้องกวน
    if (!NOTIFY_LINE && !NOTIFY_EMAIL) return 'skip';

    var text = buildNotifyText(result, student, when);
    var okAny = false;

    if (NOTIFY_LINE) {
      try { if (sendLine(text)) okAny = true; } catch (e) { Logger.log('แจ้งเตือน LINE ไม่สำเร็จ: ' + e); }
    }
    if (NOTIFY_EMAIL) {
      try { if (sendMailReport(result, student, when, text)) okAny = true; } catch (e) { Logger.log('ส่งอีเมลไม่สำเร็จ: ' + e); }
    }
    return okAny ? 'sent' : 'error';
  } catch (e) {
    Logger.log('notifyResult error: ' + e);   // กันไม่ให้กระทบการบันทึกผลสอบ
    return 'error';
  }
}


/* ===================== สร้างข้อความ ===================== */

function buildNotifyText(r, student, when) {
  r = r || {};
  var sc = Number(r.score) || 0;
  var icon = sc >= 80 ? '🎉' : (sc >= 50 ? '💪' : '📌');
  var comment = sc >= 80 ? 'เก่งมาก!' : (sc >= 50 ? 'พอใช้ได้ ฝึกต่ออีกนิด' : 'ควรทบทวนเรื่องนี้เพิ่ม');

  var lines = [
    icon + ' ทำข้อสอบเสร็จแล้ว',
    '',
    '👤 ' + (student || 'ไม่ระบุ'),
    '🕒 ' + (when || ''),
    '📘 ' + (r.level || '-') + ' · ' + (r.subject || '-'),
    '🎯 ความยาก: ' + (r.difficulty || 'ทั้งหมด'),
    '📝 โหมด: ' + (r.mode || '-'),
    '',
    '✅ ทำถูก ' + (r.correct || 0) + ' จาก ' + (r.total || 0) + ' ข้อ',
    '📊 คะแนน ' + sc + '%  (' + comment + ')',
    '⏱ ใช้เวลา ' + (r.minutesUsed || 0) + ' นาที'
  ];

  var wrong = (r.wrongIds || []).join(', ');
  if (wrong) lines.push('', '❌ ข้อที่ตอบผิด: ' + wrong);

  return lines.join('\n');
}


/* ===================== ส่งเข้า LINE ===================== */

function sendLine(text) {
  if (!LINE_TOKEN || !LINE_TARGET) return false;   // ยังไม่ตั้งค่า

  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({
      to: LINE_TARGET,
      messages: [{ type: 'text', text: String(text).substring(0, 4900) }]
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200) Logger.log('LINE ตอบกลับ ' + code + ': ' + res.getContentText());
  return code === 200;
}


/* ===================== ส่งเข้าอีเมล ===================== */

function sendMailReport(r, student, when, plainText) {
  var to = (MAIL_TO || '').trim();
  if (!to) {
    try { to = Session.getEffectiveUser().getEmail(); } catch (e) {}
  }
  if (!to) return false;

  r = r || {};
  var sc = Number(r.score) || 0;
  var color = sc >= 80 ? '#4f9a6a' : (sc >= 50 ? '#c08a3e' : '#c56b5c');
  var subject = 'ผลสอบ ' + (r.subject || '') + ' ' + sc + '% — ' + (r.level || '');
  var wrong = (r.wrongIds || []).join(', ');

  function row(label, value) {
    return '<tr>' +
      '<td style="padding:7px 12px;color:#6b7771;font-size:14px;border-bottom:1px solid #eef1ec">' + label + '</td>' +
      '<td style="padding:7px 12px;font-size:15px;font-weight:600;color:#2c3a34;border-bottom:1px solid #eef1ec">' + value + '</td>' +
      '</tr>';
  }

  var html =
    '<div style="font-family:Sarabun,Tahoma,sans-serif;background:#eef1ec;padding:22px">' +
      '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;' +
                  'box-shadow:0 4px 16px rgba(44,58,52,.10)">' +

        '<div style="background:linear-gradient(135deg,#5a9e8c,#6fb0a0);color:#fff;padding:20px 24px">' +
          '<div style="font-size:19px;font-weight:800">📝 ผลการทำข้อสอบ</div>' +
          '<div style="font-size:13.5px;opacity:.92;margin-top:2px">ระบบสอบออนไลน์ เตรียมสอบเข้า ม.1 / ม.4</div>' +
        '</div>' +

        '<div style="text-align:center;padding:24px 20px 8px">' +
          '<div style="font-size:46px;font-weight:800;color:' + color + ';line-height:1">' + sc + '%</div>' +
          '<div style="color:#6b7771;font-size:15px;margin-top:4px">ทำถูก ' +
            (r.correct || 0) + ' จาก ' + (r.total || 0) + ' ข้อ</div>' +
        '</div>' +

        '<table style="width:100%;border-collapse:collapse;margin:12px 0 4px">' +
          row('ผู้ทำ', escapeHtmlSafe(student || 'ไม่ระบุ')) +
          row('วันเวลา', escapeHtmlSafe(when || '')) +
          row('ระดับชั้น', escapeHtmlSafe(r.level || '-')) +
          row('วิชา', escapeHtmlSafe(r.subject || '-')) +
          row('ความยาก', escapeHtmlSafe(r.difficulty || 'ทั้งหมด')) +
          row('โหมด', escapeHtmlSafe(r.mode || '-')) +
          row('เวลาที่ใช้', (r.minutesUsed || 0) + ' นาที') +
        '</table>' +

        (wrong
          ? '<div style="margin:14px 20px 20px;padding:12px 14px;background:#f5e9e5;border-left:4px solid #c56b5c;' +
              'border-radius:8px;font-size:14px;color:#7a453b">' +
              '<b>ข้อที่ตอบผิด</b><br>' + escapeHtmlSafe(wrong) + '</div>'
          : '<div style="margin:14px 20px 20px;padding:12px 14px;background:#e9f2ea;border-left:4px solid #4f9a6a;' +
              'border-radius:8px;font-size:14px;color:#3d6b4f"><b>ตอบถูกทุกข้อ 🎉</b></div>') +

      '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: plainText || buildNotifyText(r, student, when),   // สำรองสำหรับเมลที่ไม่รองรับ HTML
    htmlBody: html
  });
  return true;
}

function escapeHtmlSafe(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* ===================== ฟังก์ชันทดสอบ ===================== */

// รันฟังก์ชันนี้ในตัวแก้ไขเพื่อทดสอบทั้งสองช่องทางพร้อมกัน
function testNotify() {
  var demo = {
    mode: 'ฝึกรายชุด', level: 'ม.1', subject: 'วิทยาศาสตร์', difficulty: 'ยาก',
    total: 10, correct: 8, score: 80, minutesUsed: 12, wrongIds: ['Q234', 'Q241']
  };
  notifyResult(demo, 'ทดสอบ@example.com', '2569-01-20 19:30');
  Logger.log('ส่งทดสอบแล้ว — ตรวจสอบ LINE และกล่องอีเมล');
}

// ทดสอบเฉพาะ LINE (ดูรหัสตอบกลับใน Log ถ้าไม่เข้า)
function testLineOnly() {
  var ok = sendLine('🔔 ทดสอบการแจ้งเตือนจากระบบสอบออนไลน์');
  Logger.log(ok ? 'ส่ง LINE สำเร็จ' : 'ส่งไม่สำเร็จ — ตรวจ LINE_TOKEN / LINE_TARGET และดู Log ด้านบน');
}

// ทดสอบเฉพาะอีเมล + ดูโควตาที่เหลือของวันนี้
function testMailOnly() {
  sendMailReport(
    { mode: 'ทดสอบ', level: 'ม.1', subject: 'คณิตศาสตร์', difficulty: 'กลาง',
      total: 5, correct: 5, score: 100, minutesUsed: 6, wrongIds: [] },
    'ทดสอบ@example.com', '2569-01-20 19:30', null);
  Logger.log('ส่งอีเมลแล้ว | โควตาอีเมลคงเหลือวันนี้: ' + MailApp.getRemainingDailyQuota());
}

// สแกนแถวใหม่ในชีตสถิติแล้วส่งแจ้งเตือน — ทำงานในชื่อเจ้าของผ่าน trigger
// คอลัมน์ที่ใช้ทำเครื่องหมายว่า "ส่งแล้ว" (M = คอลัมน์ที่ 13 = NotifyMarks)
const NOTIFY_SENT_COL = 13;
// ส่งได้สูงสุดกี่ข้อความต่อการรัน 1 ครั้ง (กันไล่ส่งย้อนหลังรัวจนโควตาหมด)
const NOTIFY_MAX_PER_RUN = 3;

function notifyNewResults() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;                 // มี instance อื่นทำอยู่ กันซ้อน
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
    if (!sh) { Logger.log('ไม่พบชีตสถิติ'); return; }
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Bangkok';
    var data = sh.getRange(2, 1, lastRow - 1, NOTIFY_SENT_COL).getValues();
    var handled = 0, pending = 0;

    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var rowNum = i + 2;
      if (!r[0]) continue;                                  // ไม่ใช่แถวผล
      var mark = r[NOTIFY_SENT_COL - 1];
      if (mark === 'sent' || mark === 'skip') continue;     // จัดการไปแล้ว
      if (r[7] === '' || r[7] === null) continue;           // คะแนนยังเขียนไม่เสร็จ รอรอบหน้า
      pending++;
      if (handled >= NOTIFY_MAX_PER_RUN) continue;          // เกินเพดานรอบนี้ (ที่เหลือรอรอบหน้า)

      var result = {
        mode: r[2], level: r[3], subject: r[4],
        total: r[5], correct: r[6], score: r[7], minutesUsed: r[8],
        wrongIds: String(r[10] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
        difficulty: r[11]
      };
      var score = Number(result.score) || 0;
      var student = r[1] || 'ไม่ระบุ';

      // กรองตามเกณฑ์ → มาร์ค 'skip' (ตั้งใจไม่ส่ง ไม่ใช่ส่งสำเร็จ)
      if (NOTIFY_ONLY_BELOW > 0 && score >= NOTIFY_ONLY_BELOW) {
        sh.getRange(rowNum, NOTIFY_SENT_COL).setValue('skip');
        Logger.log('แถว ' + rowNum + ' คะแนน ' + score + '% ผ่านเกณฑ์ ' + NOTIFY_ONLY_BELOW + ' → ไม่ส่ง (skip)');
        continue;
      }
      // ปิดทั้งสองช่องทาง → มาร์ค skip กันวนซ้ำทุกนาที
      if (!NOTIFY_LINE && !NOTIFY_EMAIL) {
        sh.getRange(rowNum, NOTIFY_SENT_COL).setValue('skip');
        Logger.log('แถว ' + rowNum + ' ปิดทั้ง LINE และ EMAIL → ไม่ส่ง (skip)');
        continue;
      }

      var when = (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm') : r[0];
      var textMsg = buildNotifyText(result, student, when);
      var okAny = false;
      if (NOTIFY_LINE)  { try { if (sendLine(textMsg)) okAny = true; else Logger.log('แถว '+rowNum+' LINE ไม่สำเร็จ'); } catch (e) { Logger.log('LINE err: ' + e); } }
      if (NOTIFY_EMAIL) { try { if (sendMailReport(result, student, when, textMsg)) okAny = true; else Logger.log('แถว '+rowNum+' MAIL ไม่สำเร็จ'); } catch (e) { Logger.log('MAIL err: ' + e); } }

      handled++;   // นับเข้าเพดานเสมอ กันยิงรัว
      if (okAny) {
        sh.getRange(rowNum, NOTIFY_SENT_COL).setValue('sent');
        Logger.log('แถว ' + rowNum + ' ส่งสำเร็จ (' + student + ' ' + score + '%)');
      } else {
        // ส่งไม่สำเร็จทุกช่องทาง (โควตา/เน็ต) → ไม่มาร์ค ปล่อยให้ลองใหม่รอบหน้า
        Logger.log('แถว ' + rowNum + ' ส่งไม่สำเร็จทุกช่องทาง จะลองใหม่รอบหน้า');
      }
    }
    if (pending > 0) Logger.log('สรุป: ค้าง ' + pending + ' แถว | จัดการรอบนี้ ' + handled);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// รันฟังก์ชันนี้ครั้งเดียวในตัวแก้ไข (ในชื่อคุณ) เพื่อติดตั้ง
function installNotifyTrigger() {
  // ลบ trigger เก่าทั้งหมดของฟังก์ชันนี้ (กันซ้อนกันหลายตัว)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyNewResults') ScriptApp.deleteTrigger(t);
  });
  // มาร์คแถวเดิมทั้งหมดว่า 'sent' เพื่อไม่ส่งย้อนหลัง (ส่งเฉพาะครั้งใหม่นับจากนี้)
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  if (sh && sh.getLastRow() >= 2) {
    var n = sh.getLastRow() - 1;
    var marks = [];
    for (var i = 0; i < n; i++) marks.push(['sent']);
    sh.getRange(2, NOTIFY_SENT_COL, n, 1).setValues(marks);
    SpreadsheetApp.flush();
  }
  PropertiesService.getScriptProperties().deleteProperty('NOTIFY_LAST_ROW');
  ScriptApp.newTrigger('notifyNewResults').timeBased().everyMinutes(1).create();
  Logger.log('ติดตั้ง trigger ทุก 1 นาที + มาร์คแถวเดิมว่าส่งแล้ว — จะส่งเฉพาะครั้งใหม่ ไม่ซ้ำ ไม่ตกหล่น');
}

// ถ้าต้องการล้างเครื่องหมาย 'sent' ทั้งหมด (เช่นอยากทดสอบส่งใหม่) รันอันนี้
function resetNotifyMarks() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  if (!sh || sh.getLastRow() < 2) return;
  sh.getRange(2, NOTIFY_SENT_COL, sh.getLastRow() - 1, 1).clearContent();
  Logger.log('ล้างเครื่องหมาย sent แล้ว');
}

/************************************************************************
 * ภาคผนวก: วิธีหา groupId ของกลุ่ม LINE
 * ------------------------------------------------------------------
 * groupId ดูจากหน้าคอนโซลไม่ได้ ต้องรับจาก webhook หนึ่งครั้ง
 * แนะนำให้สร้างโปรเจกต์ Apps Script "ใหม่แยกต่างหาก" (อย่าใส่ในโปรเจกต์นี้
 * เพราะระบบสอบ deploy แบบ Execute as: User accessing ซึ่งรับ webhook ไม่ได้)
 *
 *   function doPost(e) {
 *     var src = JSON.parse(e.postData.contents).events[0].source;
 *     PropertiesService.getScriptProperties().setProperty('SRC', JSON.stringify(src));
 *     return ContentService.createTextOutput('ok');
 *   }
 *   function showId() {
 *     Logger.log(PropertiesService.getScriptProperties().getProperty('SRC'));
 *   }
 *
 * ขั้นตอน:
 *   1) Deploy โปรเจกต์ชั่วคราวนั้นเป็น Web app
 *      (Execute as: Me, Who has access: Anyone)
 *   2) เอา URL ไปใส่ที่ LINE Developers > Messaging API > Webhook URL
 *      แล้วเปิดสวิตช์ Use webhook
 *   3) ปิด "Auto-reply messages" ที่ LINE Official Account Manager
 *      (ไม่งั้นบอทจะตอบข้อความอัตโนมัติกวนในกลุ่ม)
 *   4) เชิญบอทเข้ากลุ่ม แล้วพิมพ์อะไรก็ได้ในกลุ่ม 1 ข้อความ
 *   5) กลับมารัน showId() ดู Log จะเห็น groupId ขึ้นต้นด้วย C...
 *   6) คัดลอกมาใส่ LINE_TARGET ในไฟล์นี้ แล้วลบโปรเจกต์ชั่วคราวทิ้งได้
 ************************************************************************/