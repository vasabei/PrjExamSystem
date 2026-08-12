/************************************************************************
 * Explain.gs — ขอ "วิธีคิดแบบละเอียด" สำหรับข้อที่ตอบผิด
 * ------------------------------------------------------------------
 * เรียกใช้ AI (Claude) อธิบายเป็นขั้นตอน เหมาะกับการทบทวนข้อที่พลาด
 *
 * วิธีติดตั้ง:
 *   1) สร้างไฟล์สคริปต์ใหม่ชื่อ "Explain" แล้ววางโค้ดนี้
 *   2) ใส่ ANTHROPIC_API_KEY ด้านล่าง (ขอจาก https://console.anthropic.com)
 *      - ถ้าเว้นว่างไว้ ระบบจะยังทำงานได้ แค่แสดงเฉลยเดิมแทน (ไม่พัง)
 *   3) Deploy เวอร์ชันใหม่
 *
 * ค่าใช้จ่าย: ใช้เฉพาะตอนลูกกดปุ่ม "ขอวิธีคิดละเอียด" ในข้อที่ผิดเท่านั้น
 *            และแคชไว้ในเครื่อง จึงเรียกซ้ำข้อเดิมไม่เสียเงินเพิ่ม
 ************************************************************************/

const ANTHROPIC_API_KEY = '';   // ← ใส่คีย์ที่นี่ (เว้นว่าง = ปิดใช้ AI, ใช้เฉลยเดิมแทน)
const EXPLAIN_MODEL = 'claude-sonnet-4-6';

/**
 * ฟังก์ชันที่หน้าเว็บเรียก
 * คืนข้อความอธิบายเป็นขั้นตอน (ถ้าไม่มีคีย์ จะคืนค่าว่าง แล้วหน้าเว็บใช้เฉลยเดิม)
 */
function explainQuestion(question, optionsText, answer, oldExplain, subject, level) {
  if (!ANTHROPIC_API_KEY) return '';   // ยังไม่ตั้งคีย์ → ให้หน้าเว็บ fallback เอง

  var prompt =
    'คุณเป็นติวเตอร์ที่ใจดีและเก่ง กำลังช่วยนักเรียนไทยระดับ ' + (level || 'มัธยม') +
    ' ที่ "ตอบผิด" ข้อนี้ให้เข้าใจ\n\n' +
    'วิชา: ' + (subject || '-') + '\n' +
    'โจทย์: ' + question + '\n' +
    'ตัวเลือก: ' + optionsText + '\n' +
    'คำตอบที่ถูกคือข้อ: ' + answer + '\n' +
    (oldExplain ? ('เฉลยย่อ: ' + oldExplain + '\n') : '') +
    '\nช่วยอธิบายวิธีคิดเป็นขั้นตอนสั้น ๆ (3-5 บรรทัด) ภาษาไทยเข้าใจง่าย ' +
    'บอกเหตุผลว่าทำไมข้อนี้ถูก และถ้าเป็นโจทย์คำนวณให้แสดงวิธีทำทีละขั้น ' +
    'ปิดท้ายด้วยเคล็ดลับสั้น ๆ ที่ช่วยให้จำไม่ผิดอีก อย่าใช้หัวข้อหรือ markdown ตอบเป็นข้อความธรรมดา';

  try {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: EXPLAIN_MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      Logger.log('AI ตอบกลับ ' + res.getResponseCode() + ': ' + res.getContentText());
      return '';
    }
    var data = JSON.parse(res.getContentText());
    var text = (data.content || []).map(function (b) { return b.text || ''; }).join('').trim();
    return text || '';
  } catch (e) {
    Logger.log('explainQuestion error: ' + e);
    return '';
  }
}

// ทดสอบในตัวแก้ไข
function testExplain() {
  var t = explainQuestion(
    'วัตถุเริ่มจากหยุดนิ่ง ความเร่ง 2 m/s² เมื่อเคลื่อนที่ 25 เมตร มีความเร็วเท่าใด',
    'ก. 5 m/s  ข. 10 m/s  ค. 25 m/s  ง. 50 m/s',
    'ข', 'ใช้ v²=u²+2as', 'วิทยาศาสตร์', 'ม.4');
  Logger.log(t || '(ยังไม่ได้ตั้ง ANTHROPIC_API_KEY — หน้าเว็บจะใช้เฉลยเดิมแทน)');
}