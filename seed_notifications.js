require('dotenv').config();
const mysql = require('mysql2/promise');

async function seedDeviceNotifications() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });

    // Clear existing notifications
    await connection.execute('DELETE FROM notifications');

    // Get real devices
    const [devices] = await connection.execute('SELECT id, name, code FROM devices LIMIT 5');
    console.log('Found devices:', devices);

    // Create realistic notifications
    const notifications = [
      {
        title: 'ใกล้ถึงกำหนดสอบเทียบ',
        message: 'Infusion Pump1 จะถึงกำหนดสอบเทียบใน 7 วัน (30 พ.ย. 2024)',
        type: 'calibration',
        device_id: 1,
        device_name: 'Infusion Pump1',
        device_code: 'MD-001',
        priority: 3,
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        is_read: false,
        metadata: JSON.stringify({ calibration_type: 'annual', next_date: '2024-11-30' })
      },
      {
        title: 'เลยกำหนดสอบเทียบแล้ว',
        message: 'ECG Monitor เลยกำหนดสอบเทียบไป 3 วัน ต้องดำเนินการด่วน',
        type: 'alert',
        device_id: 2,
        device_name: 'ECG Monitor',
        device_code: 'MD-002',
        priority: 4,
        due_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        is_read: false,
        metadata: JSON.stringify({ days_overdue: 3, last_calibration: '2024-09-30' })
      },
      {
        title: 'กำหนดบำรุงรักษารายเดือน',
        message: 'Ultrasound Machine มีกำหนดบำรุงรักษารายเดือนในวันที่ 25 พ.ย. 2024',
        type: 'maintenance',
        device_id: 3,
        device_name: 'Ultrasound Machine',
        device_code: 'MD-003',
        priority: 2,
        due_date: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
        is_read: true,
        metadata: JSON.stringify({ maintenance_type: 'monthly', scheduled_date: '2024-11-25' })
      },
      {
        title: 'ใกล้หมดอายุประกัน',
        message: 'Defibrillator ประกันจะหมดอายุใน 30 วัน (31 ธ.ค. 2024)',
        type: 'expiry',
        device_id: 4,
        device_name: 'Defibrillator',
        device_code: 'MD-004',
        priority: 3,
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        is_read: false,
        metadata: JSON.stringify({ expiry_date: '2024-12-31', warranty_type: 'device' })
      },
      {
        title: 'อัปเดตซอฟต์แวร์',
        message: 'test43 มีอัปเดตซอฟต์แวร์เวอร์ชั่น 2.1.0',
        type: 'info',
        device_id: 6,
        device_name: 'test43',
        device_code: 'MD-1714',
        priority: 2,
        due_date: null,
        is_read: true,
        metadata: JSON.stringify({ version: '2.1.0', update_type: 'software' })
      }
    ];

    // Insert notifications
    for (const noti of notifications) {
      await connection.execute(`
        INSERT INTO notifications (title, message, type, device_id, device_name, device_code, priority, due_date, is_read, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [noti.title, noti.message, noti.type, noti.device_id, noti.device_name, noti.device_code, noti.priority, noti.due_date, noti.is_read, noti.metadata]);
    }

    console.log('✅ Seeded', notifications.length, 'notifications for real devices');
    await connection.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

seedDeviceNotifications();