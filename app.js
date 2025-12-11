// server.js — medical-device-api-full (Single file)
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const cron = require("node-cron");
const fs = require("fs");
const QRCode = require("qrcode");
require("dotenv").config();

const { Sequelize, DataTypes, Op } = require("sequelize");

// ============== DB CONNECTION ==============
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",
    logging: false,
  }
);

// ============== MODELS ==============
// Users
const User = sequelize.define("users", {
  name: { type: DataTypes.STRING(100), allowNull: false },
  email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: false },
  role: { type: DataTypes.ENUM("admin", "user", "staff"), defaultValue: "user" },
  department: { type: DataTypes.STRING(100) },
  status: { type: DataTypes.ENUM("active", "suspended"), defaultValue: "active" },
}, { timestamps: true });

// Devices
const Device = sequelize.define("devices", {
  code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  specification: { type: DataTypes.TEXT },
  status: {
    type: DataTypes.ENUM("ready", "maintenance", "broken", "retired"),
    defaultValue: "ready",
  },
  calibration_date: { type: DataTypes.DATE },
  location: { type: DataTypes.STRING(255) },
  serial_number: { type: DataTypes.STRING(100) },
  category: { type: DataTypes.STRING(100) },
  next_calibration_date: { type: DataTypes.DATE },
  price: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
  supplier_company: { type: DataTypes.STRING(255), allowNull: true },
  purchaser_department: { type: DataTypes.STRING(255), allowNull: true },
  image_url: { type: DataTypes.STRING(500), allowNull: true },
}, { timestamps: true });

// Documents (URL-based storage)
const Document = sequelize.define("documents", {
  id: { type: DataTypes.STRING(50), primaryKey: true },
  device_name: { type: DataTypes.STRING(255), allowNull: false },
  document_type: {
    type: DataTypes.ENUM("ใบรับรองการสอบเทียบ", "รายงานการซ่อม", "คู่มือการใช้งาน", "บันทึกการตรวจสอบประจำวัน"),
    allowNull: false
  },
  file_name: { type: DataTypes.STRING(255), allowNull: false },
  document_url: { type: DataTypes.TEXT, allowNull: false },
  file_size: { type: DataTypes.STRING(50) },
  uploaded_by: { type: DataTypes.STRING(100) },
  user_id: { type: DataTypes.INTEGER },
  device_id: { type: DataTypes.INTEGER },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, { timestamps: false });

// Attachments (general file attachments for devices)
const Attachment = sequelize.define("attachments", {
  device_id: { type: DataTypes.INTEGER, allowNull: false },
  file_name: { type: DataTypes.STRING(255), allowNull: false },
  file_path: { type: DataTypes.STRING(255), allowNull: false },
  file_size: { type: DataTypes.INTEGER },
  file_type: { type: DataTypes.STRING(50) },
  category: { type: DataTypes.ENUM("manual", "certificate", "report", "image", "other"), defaultValue: "other" },
  description: { type: DataTypes.TEXT },
  uploaded_by: { type: DataTypes.INTEGER },
}, { timestamps: true });

// Reports (แจ้งซ่อม/ปัญหา)
const Report = sequelize.define("reports", {
  message: { type: DataTypes.TEXT, allowNull: false },
  image_path: { type: DataTypes.STRING(255) },
  status: { type: DataTypes.ENUM("pending", "in_progress", "resolved"), defaultValue: "pending" },
}, { timestamps: true });

// Notifications (การแจ้งเตือน)
const Notification = sequelize.define("notifications", {
  title: { type: DataTypes.STRING(255), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  type: {
    type: DataTypes.ENUM("calibration", "maintenance", "expiry", "alert", "info"),
    allowNull: false,
    defaultValue: "info"
  },
  device_id: { type: DataTypes.INTEGER, allowNull: false },
  device_name: { type: DataTypes.STRING(255), allowNull: false },
  device_code: { type: DataTypes.STRING(100), allowNull: false },
  priority: {
    type: DataTypes.TINYINT.UNSIGNED, // 1=low, 2=medium, 3=high, 4=critical
    defaultValue: 2,
    validate: {
      min: 1,
      max: 4
    }
  },
  due_date: { type: DataTypes.DATE },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
  metadata: { type: DataTypes.JSON },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: false,
  tableName: 'notifications'
});

// ============== RELATIONS ==============
Device.hasMany(Document, { foreignKey: { name: "device_id", allowNull: true } });
Document.belongsTo(Device, { foreignKey: "device_id" });
Device.hasMany(Notification, { foreignKey: "device_id" });
Notification.belongsTo(Device, { foreignKey: "device_id" });

User.hasMany(Document, { foreignKey: { name: "user_id" } });
Document.belongsTo(User, { foreignKey: "user_id" });

Device.hasMany(Attachment, { foreignKey: { name: "device_id", allowNull: false }, onDelete: "CASCADE" });
Attachment.belongsTo(Device, { foreignKey: "device_id" });

User.hasMany(Attachment, { foreignKey: { name: "uploaded_by" } });
Attachment.belongsTo(User, { foreignKey: "uploaded_by" });

Device.hasMany(Report, { foreignKey: { name: "device_id", allowNull: false }, onDelete: "CASCADE" });
Report.belongsTo(Device, { foreignKey: "device_id" });

User.hasMany(Report, { foreignKey: { name: "user_id", allowNull: false }, onDelete: "CASCADE" });
Report.belongsTo(User, { foreignKey: "user_id" });

// ============== APP & MIDDLEWARES ==============
const app = express();
app.use(helmet());
app.use(cors({
  origin: 'https://radtel.co',
  credentials: true
}));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(morgan("dev"));
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // serve files

// ============== AUTH MIDDLEWARES ==============
const auth = (req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, email }
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin only" });
  next();
};

// ============== MULTER UPLOADS ==============
// Documents (PDF)
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/documents"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, name);
  },
});
const pdfFilter = (req, file, cb) => {
  const ok = file.mimetype === "application/pdf";
  cb(ok ? null : new Error("Only PDF allowed"), ok);
};
const uploadPDF = multer({ storage: docStorage, fileFilter: pdfFilter });

// Report images (jpeg/png)
const imgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/reports"),
  filename: (req, file, cb) => {
    const name = `${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, name);
  },
});
const imageFilter = (req, file, cb) => {
  const ok = ["image/png", "image/jpeg", "image/jpg"].includes(file.mimetype);
  cb(ok ? null : new Error("Only PNG/JPG allowed"), ok);
};
const uploadImage = multer({ storage: imgStorage, fileFilter: imageFilter });

// General attachments (multiple file types)
const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/attachments";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, name);
  },
});
const attachmentFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/pdf",
    "image/png", "image/jpeg", "image/jpg",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ];
  const ok = allowedTypes.includes(file.mimetype);
  cb(ok ? null : new Error("File type not allowed"), ok);
};
const uploadAttachment = multer({ storage: attachmentStorage, fileFilter: attachmentFilter });

// ============== HELPERS ==============
const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "8h" });

// ============== ROUTES ==============
// Health
app.get("/", (req, res) => res.json({ message: "Medical Device API (full) is running" }));

// Test route
app.get("/test", (req, res) => res.json({ message: "Test route is working" }));

// ---- Auth ----
// Register (Admin only)
app.post("/api/auth/register", auth, isAdmin, async (req, res) => {
  try {
    const { name, email, password, role = "user", department, status = "active" } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Missing fields" });
    const exist = await User.findOne({ where: { email } });
    if (exist) return res.status(400).json({ message: "Email already exists" });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, role, department, status });
    res.status(201).json({ id: user.id, name, email, role, department, status });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ success: false, message: "Invalid credentials" });
    if (user.status === 'suspended') return res.status(401).json({ success: false, message: "Account suspended" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, message: "Invalid credentials" });
    const token = signToken(user);
    res.json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Get Profile
app.get("/api/auth/profile", auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        status: user.status
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Change Password (self)
app.post("/api/auth/change-password", auth, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    const user = await User.findByPk(req.user.id);
    const ok = await bcrypt.compare(old_password, user.password);
    if (!ok) return res.status(400).json({ success: false, message: "Old password incorrect" });
    user.password = await bcrypt.hash(new_password, 10);
    await user.save();
    res.json({ success: true, message: "Password updated" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ---- Users (Admin) ----
app.get("/api/users", auth, isAdmin, async (req, res) => {
  try {
    // Disable caching for this endpoint
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const { q, role, status } = req.query;

    // Build where clause for search and filters
    const whereClause = {};

    // Text search across name, email, department
    if (q) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { email: { [Op.like]: `%${q}%` } },
        { department: { [Op.like]: `%${q}%` } }
      ];
    }

    // Filter by role
    if (role && role !== 'all') {
      whereClause.role = role;
    }

    // Filter by status
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    console.log("🔍 Users filter query:", { q, role, status, whereClause });

    const users = await User.findAll({
      where: whereClause,
      attributes: ["id", "name", "email", "role", "department", "status", "createdAt", "updatedAt"],
      order: [["createdAt", "DESC"]]
    });

    console.log(`📊 Users found: ${users.length} results`);
    users.forEach(user => {
      console.log(`  - ${user.name} (${user.email}) - ${user.role} - ${user.status}`);
    });

    res.json(users);
  } catch (e) {
    console.error("❌ Error fetching users:", e.message);
    res.status(400).json({ message: e.message });
  }
});
app.post("/api/users", auth, isAdmin, async (req, res) => {
  try {
    const { name, email, password, role = "user", department, status = "active" } = req.body;
    console.log("🔍 Create user request body:", { name, email, role, department, status, password: "***" });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash, role, department, status });
    console.log("✅ User created successfully:", { id: user.id, email: user.email });
    res.status(201).json({ id: user.id, name, email, role, department, status });
  } catch (e) {
    console.error("❌ Error creating user:", e.message);
    res.status(400).json({ message: e.message });
  }
});
app.put("/api/users/:id", auth, isAdmin, async (req, res) => {
  try {
    const { name, email, role, department, status, password } = req.body;
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (password) user.password = await bcrypt.hash(password, 10);
    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (department !== undefined) user.department = department;
    if (status !== undefined) user.status = status;
    await user.save();
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, status: user.status });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.delete("/api/users/:id", auth, isAdmin, async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  await user.destroy();
  res.json({ message: "User deleted" });
});

// Toggle user status (Admin only)
app.put("/api/users/:id/status", auth, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.status = status;
    await user.save();
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, status: user.status });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Reset password (Admin only)
app.post("/api/auth/reset-password", auth, isAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Generate temporary password
    const temporaryPassword = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(temporaryPassword, 10);
    user.password = hash;
    await user.save();

    res.json({
      message: "Password reset successfully",
      temporaryPassword
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---- Devices ----
// Public for authenticated users (both admin/user)
app.get("/api/devices", auth, async (req, res) => {
  const { q, status } = req.query;
  const where = {};
  if (q) where[Sequelize.Op.or] = [
    { name: { [Sequelize.Op.like]: `%${q}%` } },
    { code: { [Sequelize.Op.like]: `%${q}%` } },
    { serial_number: { [Sequelize.Op.like]: `%${q}%` } },
    { location: { [Sequelize.Op.like]: `%${q}%` } },
    { category: { [Sequelize.Op.like]: `%${q}%` } },
  ];
  if (status) where.status = status;
  const devices = await Device.findAll({
    where,
    order: [["createdAt", "DESC"]],
    include: [{ model: Attachment, as: 'attachments' }]
  });
  res.json(devices);
});
app.get("/api/devices/:id", auth, async (req, res) => {
  const device = await Device.findByPk(req.params.id, {
    include: [
      { model: Document },
      { model: Attachment, as: 'attachments' },
      { model: Report, include: [{ model: User, attributes: ["id", "name", "email"] }] }
    ],
  });
  if (!device) return res.status(404).json({ message: "Device not found" });
  res.json(device);
});

// Admin only: create/update/delete
app.post("/api/devices", auth, isAdmin, async (req, res) => {
  try {
    const device = await Device.create(req.body);
    res.status(201).json(device);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.put("/api/devices/:id", auth, isAdmin, async (req, res) => {
  const device = await Device.findByPk(req.params.id);
  if (!device) return res.status(404).json({ message: "Device not found" });
  await device.update(req.body);
  res.json(device);
});
app.delete("/api/devices/:id", auth, isAdmin, async (req, res) => {
  const device = await Device.findByPk(req.params.id);
  if (!device) return res.status(404).json({ message: "Device not found" });
  await device.destroy();
  res.json({ message: "Device deleted" });
});

// Update calibration date
app.post("/api/devices/:id/calibration", auth, async (req, res) => {
  try {
    const { next_calibration_date, calibration_report, calibration_by, notes } = req.body;

    if (!next_calibration_date) {
      return res.status(400).json({ success: false, message: "Missing next_calibration_date" });
    }

    const device = await Device.findByPk(req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    const oldDate = device.next_calibration_date;
    const newDate = new Date(next_calibration_date);

    // Update device calibration date
    await device.update({ next_calibration_date: newDate });

    // Create notification about calibration update
    await Notification.create({
      title: 'สอบเทียบเครื่องมือแพทย์เสร็จสิ้น',
      message: `${device.name} สอบเทียบเสร็จเรียบร้อย กำหนดสอบเทียบครั้งถัดไป: ${newDate.toLocaleDateString('th-TH')}`,
      type: 'info',
      device_id: device.id,
      device_name: device.name,
      device_code: device.code,
      priority: 1,
      due_date: newDate,
      is_read: true,
      metadata: {
        calibration_completed: true,
        old_calibration_date: oldDate ? oldDate.toISOString().split('T')[0] : null,
        new_calibration_date: newDate.toISOString().split('T')[0],
        calibration_by: calibration_by || req.user?.name || 'Unknown',
        notes: notes || '',
        auto_generated: false
      }
    });

    // Mark existing overdue calibration alerts as read
    await Notification.update(
      { is_read: true },
      {
        where: {
          device_id: device.id,
          type: 'alert',
          title: 'เลยกำหนดสอบเทียบแล้ว',
          is_read: false
        }
      }
    );

    console.log(`✅ Calibration updated for ${device.name}: ${oldDate} → ${newDate}`);

    res.json({
      success: true,
      message: 'อัพเดตวันที่สอบเทียบเรียบร้อย',
      device: {
        id: device.id,
        name: device.name,
        code: device.code,
        previous_calibration_date: oldDate,
        next_calibration_date: newDate
      }
    });

  } catch (error) {
    console.error('Calibration update error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการอัพเดตวันที่สอบเทียบ'
    });
  }
});

// QRCode (PNG stream)
app.get("/api/devices/:id/qrcode", auth, async (req, res) => {
  const device = await Device.findByPk(req.params.id);
  if (!device) return res.status(404).json({ message: "Device not found" });

  // ตัวอย่าง payload ใน QR: URL หรือรหัสเครื่องก็ได้
  const payload = JSON.stringify({ type: "medical_device", id: device.id, code: device.code });
  res.setHeader("Content-Type", "image/png");
  QRCode.toFileStream(res, payload, { type: "png", width: 320, margin: 1 });
});

// ---- Documents (PDF) ----
app.post("/api/devices/:id/documents", auth, isAdmin, uploadPDF.single("file"), async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ message: "Device not found" });

    // Map document types
    const documentTypeMap = {
      "calibration": "ใบรับรองการสอบเทียบ",
      "manual": "คู่มือการใช้งาน",
      "report": "รายงานการซ่อม",
      "inspection": "บันทึกการตรวจสอบประจำวัน"
    };

    const type = req.body.type || "calibration";
    const docId = `DOC-${Math.floor(Math.random() * 900000 + 100000)}`;
    const document_type = documentTypeMap[type] || "ใบรับรองการสอบเทียบ";

    const doc = await Document.create({
      id: docId,
      device_id: device.id,
      device_name: device.name,
      document_type: document_type,
      file_name: req.file.originalname,
      document_url: `uploads/documents/${req.file.filename}`,
      file_size: req.file.size,
      uploaded_by: req.user.name || 'ผู้ดูแลระบบ',
      user_id: req.user.id
    });
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.get("/api/devices/:id/documents", auth, async (req, res) => {
  const docs = await Document.findAll({ where: { device_id: req.params.id }, order: [["createdAt", "DESC"]] });
  res.json(docs);
});

// ---- Attachments (General Files) ----
app.post("/api/devices/:id/attachments", auth, uploadAttachment.single("file"), async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ message: "Device not found" });

    const { category = "other", description } = req.body;
    const file_path = `uploads/attachments/${req.file.filename}`;

    const attachment = await Attachment.create({
      device_id: device.id,
      file_name: req.file.originalname,
      file_path,
      file_size: req.file.size,
      file_type: req.file.mimetype,
      category,
      description,
      uploaded_by: req.user.id
    });

    res.status(201).json(attachment);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.get("/api/devices/:id/attachments", auth, async (req, res) => {
  const attachments = await Attachment.findAll({
    where: { device_id: req.params.id },
    order: [["createdAt", "DESC"]],
    include: [{ model: User, as: 'uploader', attributes: ["id", "name", "email"] }]
  });
  res.json(attachments);
});

app.delete("/api/attachments/:id", auth, isAdmin, async (req, res) => {
  try {
    const attachment = await Attachment.findByPk(req.params.id);
    if (!attachment) return res.status(404).json({ message: "Attachment not found" });

    // Delete file from filesystem
    if (fs.existsSync(attachment.file_path)) {
      fs.unlinkSync(attachment.file_path);
    }

    await attachment.destroy();
    res.json({ message: "Attachment deleted successfully" });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.get("/api/documents/:docId/download", auth, async (req, res) => {
  const doc = await Document.findByPk(req.params.docId);
  if (!doc) return res.status(404).json({ message: "Document not found" });
  const abs = path.join(__dirname, doc.document_url);
  if (!fs.existsSync(abs)) return res.status(404).json({ message: "File missing" });
  res.download(abs);
});

// ---- Reports (แจ้งปัญหา) ----
// User/Staff: create report (with optional image)
app.post("/api/devices/:id/report", auth, uploadImage.single("image"), async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ message: "Device not found" });
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: "Message is required" });
    const image_path = req.file ? `uploads/reports/${req.file.filename}` : null;
    const report = await Report.create({
      device_id: device.id,
      user_id: req.user.id,
      message,
      image_path,
    });
    res.status(201).json(report);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Admin: list all reports
app.get("/api/reports", auth, isAdmin, async (_req, res) => {
  const reports = await Report.findAll({
    order: [["createdAt", "DESC"]],
    include: [{ model: Device }, { model: User, attributes: ["id", "name", "email"] }],
  });
  res.json(reports);
});

// Both: list reports of a device
app.get("/api/devices/:id/reports", auth, async (req, res) => {
  const reports = await Report.findAll({
    where: { device_id: req.params.id },
    order: [["createdAt", "DESC"]],
    include: [{ model: User, attributes: ["id", "name", "email"] }],
  });
  res.json(reports);
});

// Admin: update report status
app.put("/api/reports/:id/status", auth, isAdmin, async (req, res) => {
  const report = await Report.findByPk(req.params.id);
  if (!report) return res.status(404).json({ message: "Report not found" });
  const { status } = req.body;
  if (!["pending", "in_progress", "resolved"].includes(status))
    return res.status(400).json({ message: "Invalid status" });
  report.status = status;
  await report.save();
  res.json(report);
});

// ---- Dashboard Statistics ----
app.get("/api/dashboard/overview", auth, async (req, res) => {
  try {
    // Device statistics
    const totalDevices = await Device.count();
    const deviceStats = await Device.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    // Report statistics
    const totalReports = await Report.count();
    const pendingReports = await Report.count({ where: { status: 'pending' } });
    const inProgressReports = await Report.count({ where: { status: 'in_progress' } });
    const resolvedReports = await Report.count({ where: { status: 'resolved' } });

    // User statistics
    const totalUsers = await User.count();
    const activeUsers = await User.count({ where: { status: 'active' } });
    const suspendedUsers = await User.count({ where: { status: 'suspended' } });

    // Upcoming calibrations (within 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const upcomingCalibrations = await Device.count({
      where: {
        next_calibration_date: {
          [Op.lte]: thirtyDaysFromNow,
          [Op.gte]: new Date()
        }
      }
    });

    // Overdue calibrations
    const overdueCalibrations = await Device.count({
      where: {
        next_calibration_date: {
          [Op.lt]: new Date()
        }
      }
    });

    // Device location distribution
    const locationStats = await Device.findAll({
      attributes: [
        'location',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['location'],
      where: {
        location: {
          [Op.ne]: null
        }
      }
    });

    // Device category distribution
    const categoryStats = await Device.findAll({
      attributes: [
        'category',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['category'],
      where: {
        category: {
          [Op.ne]: null
        }
      }
    });

    // Recent activities (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentReports = await Report.count({
      where: {
        createdAt: {
          [Op.gte]: sevenDaysAgo
        }
      }
    });

    const recentDocuments = await Document.count({
      where: {
        createdAt: {
          [Op.gte]: sevenDaysAgo
        }
      }
    });

    // Format device stats
    const deviceStatusDistribution = {};
    deviceStats.forEach(stat => {
      deviceStatusDistribution[stat.status] = parseInt(stat.dataValues.count);
    });

    // Format location stats
    const deviceLocationDistribution = {};
    locationStats.forEach(stat => {
      deviceLocationDistribution[stat.location] = parseInt(stat.dataValues.count);
    });

    // Format category stats
    const deviceCategoryDistribution = {};
    categoryStats.forEach(stat => {
      deviceCategoryDistribution[stat.category] = parseInt(stat.dataValues.count);
    });

    const dashboardData = {
      devices: {
        total: totalDevices,
        statusDistribution: deviceStatusDistribution,
        locationDistribution: deviceLocationDistribution,
        categoryDistribution: deviceCategoryDistribution,
        upcomingCalibrations,
        overdueCalibrations
      },
      reports: {
        total: totalReports,
        pending: pendingReports,
        inProgress: inProgressReports,
        resolved: resolvedReports
      },
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers
      },
      recentActivity: {
        weeklyReports: recentReports,
        weeklyDocuments: recentDocuments
      }
    };

    res.json(dashboardData);
  } catch (e) {
    console.error('❌ Dashboard API error:', e.message);
    res.status(500).json({ message: e.message });
  }
});

// Monthly report trends (last 12 months)
app.get("/api/dashboard/report-trends", auth, async (req, res) => {
  try {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const monthlyTrends = await Report.findAll({
      attributes: [
        [sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), '%Y-%m'), 'month'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        createdAt: {
          [Op.gte]: twelveMonthsAgo
        }
      },
      group: [sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), '%Y-%m')],
      order: [[sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), '%Y-%m'), 'ASC']]
    });

    const trends = {};
    monthlyTrends.forEach(trend => {
      trends[trend.dataValues.month] = parseInt(trend.dataValues.count);
    });

    res.json(trends);
  } catch (e) {
    console.error('❌ Dashboard trends API error:', e.message);
    res.status(500).json({ message: e.message });
  }
});

// Recent activities for dashboard
app.get("/api/dashboard/recent-activities", auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Recent reports
    const recentReports = await Report.findAll({
      limit: Math.ceil(limit / 2),
      order: [['createdAt', 'DESC']],
      include: [
        { model: Device, attributes: ['id', 'name', 'code'] },
        { model: User, attributes: ['id', 'name'] }
      ]
    });

    // Recent document uploads
    const recentDocuments = await Document.findAll({
      limit: Math.ceil(limit / 2),
      order: [['createdAt', 'DESC']],
      include: [
        { model: Device, attributes: ['id', 'name', 'code'] }
      ]
    });

    // Format activities
    const activities = [];

    recentReports.forEach(report => {
      activities.push({
        id: report.id,
        type: 'report',
        action: 'แจ้งปัญหา',
        description: report.message,
        deviceName: report.Device ? report.Device.name : 'Unknown Device',
        deviceCode: report.Device ? report.Device.code : 'N/A',
        userName: report.User ? report.User.name : 'Unknown User',
        status: report.status,
        createdAt: report.createdAt,
        icon: 'report_problem'
      });
    });

    recentDocuments.forEach(doc => {
      activities.push({
        id: doc.id,
        type: 'document',
        action: 'อัปโหลดเอกสาร',
        description: `${doc.type} - ${doc.file_name}`,
        deviceName: doc.Device ? doc.Device.name : 'Unknown Device',
        deviceCode: doc.Device ? doc.Device.code : 'N/A',
        userName: 'System',
        status: 'completed',
        createdAt: doc.createdAt,
        icon: 'upload_file'
      });
    });

    // Sort all activities by date
    activities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(activities.slice(0, limit));
  } catch (e) {
    console.error('❌ Dashboard activities API error:', e.message);
    res.status(500).json({ message: e.message });
  }
});

// ============== DOCUMENTS API ==============
// GET all documents with filtering
app.get("/api/documents", auth, async (req, res) => {
  try {
    const { search, type } = req.query;
    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { device_name: { [Op.like]: `%${search}%` } },
        { file_name: { [Op.like]: `%${search}%` } },
        { document_type: { [Op.like]: `%${search}%` } }
      ];
    }

    if (type && type !== 'all') {
      whereClause.document_type = type;
    }

    const documents = await Document.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: User,
          attributes: ['id', 'name', 'email']
        },
        {
          model: Device,
          attributes: ['id', 'name', 'code']
        }
      ]
    });

    const documentTypes = [
      'ใบรับรองการสอบเทียบ',
      'รายงานการซ่อม',
      'คู่มือการใช้งาน',
      'บันทึกการตรวจสอบประจำวัน',
    ];

    res.json({
      success: true,
      documents: documents.map(doc => ({
        id: doc.id,
        deviceName: doc.device_name,
        documentType: doc.document_type,
        fileName: doc.file_name,
        documentUrl: doc.document_url,
        fileSize: doc.file_size,
        uploadedBy: doc.uploaded_by,
        uploadedAt: doc.createdAt,
        user: doc.User,
        device: doc.Device
      })),
      documentTypes
    });
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch documents' });
  }
});

// GET single document
app.get("/api/documents/:id", auth, async (req, res) => {
  try {
    const document = await Document.findByPk(req.params.id, {
      include: [
        {
          model: User,
          attributes: ['id', 'name', 'email']
        },
        {
          model: Device,
          attributes: ['id', 'name', 'code']
        }
      ]
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.json({
      success: true,
      document: {
        id: document.id,
        deviceName: document.device_name,
        documentType: document.document_type,
        fileName: document.file_name,
        documentUrl: document.document_url,
        fileSize: document.file_size,
        uploadedBy: document.uploaded_by,
        uploadedAt: document.createdAt,
        user: document.User,
        device: document.Device
      }
    });
  } catch (err) {
    console.error('Error fetching document:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch document' });
  }
});

// POST create new document
app.post("/api/documents", auth, async (req, res) => {
  try {
    const { deviceName, documentType, fileName, documentUrl, fileSize, uploadedBy } = req.body;

    if (!deviceName || !documentType || !fileName || !documentUrl) {
      return res.status(400).json({
        success: false,
        message: 'Device name, document type, file name, and document URL are required'
      });
    }

    // Generate unique document ID
    const docId = `DOC-${Math.floor(Math.random() * 900 + 100)}`;

    const newDocument = await Document.create({
      id: docId,
      device_name: deviceName,
      document_type: documentType,
      file_name: fileName,
      document_url: documentUrl,
      file_size: fileSize,
      uploaded_by: uploadedBy || 'ผู้ใช้งานปัจจุบัน',
      user_id: req.user.id
    });

    const createdDocument = await Document.findByPk(newDocument.id, {
      include: [
        {
          model: User,
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Document created successfully',
      document: {
        id: createdDocument.id,
        deviceName: createdDocument.device_name,
        documentType: createdDocument.document_type,
        fileName: createdDocument.file_name,
        documentUrl: createdDocument.document_url,
        fileSize: createdDocument.file_size,
        uploadedBy: createdDocument.uploaded_by,
        uploadedAt: createdDocument.createdAt,
        user: createdDocument.User
      }
    });
  } catch (err) {
    console.error('Error creating document:', err);
    res.status(500).json({ success: false, message: 'Failed to create document' });
  }
});

// PUT update document
app.put("/api/documents/:id", auth, async (req, res) => {
  try {
    const { deviceName, documentType, fileName, documentUrl, fileSize, uploadedBy } = req.body;

    const document = await Document.findByPk(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    await document.update({
      device_name: deviceName || document.device_name,
      document_type: documentType || document.document_type,
      file_name: fileName || document.file_name,
      document_url: documentUrl || document.document_url,
      file_size: fileSize || document.file_size,
      uploaded_by: uploadedBy || document.uploaded_by
    });

    const updatedDocument = await Document.findByPk(document.id, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    res.json({
      success: true,
      message: 'Document updated successfully',
      document: {
        id: updatedDocument.id,
        deviceName: updatedDocument.device_name,
        documentType: updatedDocument.document_type,
        fileName: updatedDocument.file_name,
        documentUrl: updatedDocument.document_url,
        fileSize: updatedDocument.file_size,
        uploadedBy: updatedDocument.uploaded_by,
        uploadedAt: updatedDocument.createdAt,
        user: updatedDocument.User
      }
    });
  } catch (err) {
    console.error('Error updating document:', err);
    res.status(500).json({ success: false, message: 'Failed to update document' });
  }
});

// DELETE document
app.delete("/api/documents/:id", auth, async (req, res) => {
  try {
    const document = await Document.findByPk(req.params.id);

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    await document.destroy();

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting document:', err);
    res.status(500).json({ success: false, message: 'Failed to delete document' });
  }
});

// GET document types
app.get("/api/documents/types", auth, async (req, res) => {
  try {
    const documentTypes = [
      'ใบรับรองการสอบเทียบ',
      'รายงานการซ่อม',
      'คู่มือการใช้งาน',
      'บันทึกการตรวจสอบประจำวัน',
    ];

    res.json({
      success: true,
      documentTypes
    });
  } catch (err) {
    console.error('Error fetching document types:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch document types' });
  }
});

// ============== NOTIFICATION ENDPOINTS ==============

// GET /api/notifications - ดึงรายการการแจ้งเตือน
app.get("/api/notifications", auth, async (req, res) => {
  try {
    const { search, type, unreadOnly, deviceId, limit = 50, offset = 0 } = req.query;

    const whereClause = {};

    if (search) {
      whereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { message: { [Op.like]: `%${search}%` } },
        { device_name: { [Op.like]: `%${search}%` } },
        { device_code: { [Op.like]: `%${search}%` } }
      ];
    }

    if (type) {
      whereClause.type = type;
    }

    if (unreadOnly === 'true') {
      whereClause.is_read = false;
    }

    if (deviceId) {
      whereClause.device_id = deviceId;
    }

    const notifications = await Notification.findAndCountAll({
      where: whereClause,
      include: [{
        model: Device,
        attributes: ['id', 'name', 'code'],
        required: false
      }],
      order: [
        ['priority', 'DESC'],
        ['created_at', 'DESC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const unreadCount = await Notification.count({
      where: { is_read: false }
    });

    const documentTypes = await Notification.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('type')), 'type']],
      raw: true
    }).then(results => results.map(r => r.type));

    res.json({
      success: true,
      notifications: notifications.rows.map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        deviceId: n.device_id,
        deviceName: n.device_name,
        deviceCode: n.device_code,
        priority: n.priority,
        isRead: n.is_read,
        dueDate: n.due_date,
        createdAt: n.created_at,
        updatedAt: n.updated_at,
        metadata: n.metadata,
        device: n.Device
      })),
      unreadCount,
      documentTypes,
      total: notifications.count
    });
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
});

// GET /api/notifications/:id - ดึงรายละเอียดการแจ้งเตือน
app.get("/api/notifications/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByPk(id, {
      include: [{
        model: Device,
        attributes: ['id', 'name', 'code'],
        required: false
      }]
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.json({
      success: true,
      notification: {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        deviceId: notification.device_id,
        deviceName: notification.device_name,
        deviceCode: notification.device_code,
        priority: notification.priority,
        isRead: notification.is_read,
        dueDate: notification.due_date,
        createdAt: notification.created_at,
        updatedAt: notification.updated_at,
        metadata: notification.metadata,
        device: notification.Device
      }
    });
  } catch (err) {
    console.error("Get notification error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch notification" });
  }
});

// PATCH /api/notifications/:id/read - ทำเครื่องหมายว่าอ่านแล้ว
app.patch("/api/notifications/:id/read", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByPk(id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    await notification.update({
      is_read: true,
      updated_at: new Date()
    });

    res.json({
      success: true,
      message: "Notification marked as read",
      notification: {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        deviceId: notification.device_id,
        deviceName: notification.device_name,
        deviceCode: notification.device_code,
        priority: notification.priority,
        isRead: notification.is_read,
        dueDate: notification.due_date,
        createdAt: notification.created_at,
        updatedAt: notification.updated_at,
        metadata: notification.metadata
      }
    });
  } catch (err) {
    console.error("Mark notification as read error:", err);
    res.status(500).json({ success: false, message: "Failed to mark notification as read" });
  }
});

// PATCH /api/notifications/read-all - ทำเครื่องหมายว่าอ่านทั้งหมด
app.patch("/api/notifications/read-all", auth, async (req, res) => {
  try {
    await Notification.update(
      {
        is_read: true,
        updated_at: new Date()
      },
      { where: { is_read: false } }
    );

    res.json({
      success: true,
      message: "All notifications marked as read"
    });
  } catch (err) {
    console.error("Mark all notifications as read error:", err);
    res.status(500).json({ success: false, message: "Failed to mark all notifications as read" });
  }
});

// DELETE /api/notifications/:id - ลบการแจ้งเตือน
app.delete("/api/notifications/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByPk(id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    await notification.destroy();

    res.json({
      success: true,
      message: "Notification deleted successfully"
    });
  } catch (err) {
    console.error("Delete notification error:", err);
    res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
});

// POST /api/notifications - สร้างการแจ้งเตือนใหม่
app.post("/api/notifications", auth, async (req, res) => {
  try {
    const { title, message, type, deviceId, dueDate, priority = 2, metadata } = req.body;

    if (!title || !message || !type || !deviceId) {
      return res.status(400).json({
        success: false,
        message: "Title, message, type, and deviceId are required"
      });
    }

    // ดึงข้อมูล device
    const device = await Device.findByPk(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    const notification = await Notification.create({
      title,
      message,
      type,
      device_id: deviceId,
      device_name: device.name,
      device_code: device.code,
      priority,
      due_date: dueDate ? new Date(dueDate) : null,
      metadata: metadata || {},
      created_at: new Date(),
      updated_at: new Date()
    });

    res.status(201).json({
      success: true,
      message: "Notification created successfully",
      notification: {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        deviceId: notification.device_id,
        deviceName: notification.device_name,
        deviceCode: notification.device_code,
        priority: notification.priority,
        isRead: notification.is_read,
        dueDate: notification.due_date,
        createdAt: notification.created_at,
        updatedAt: notification.updated_at,
        metadata: notification.metadata
      }
    });
  } catch (err) {
    console.error("Create notification error:", err);
    res.status(500).json({ success: false, message: "Failed to create notification" });
  }
});

// ============== NOTIFICATION SEEDING ==============
async function seedNotifications() {
  // Only create calibration-related notifications
  const devices = await Device.findAll({ limit: 3 });

  if (devices.length > 0) {
    const calibrationNotifications = [
      {
        title: "ใกล้ถึงกำหนดสอบเทียบ",
        message: `${devices[0].name} จะถึงกำหนดสอบเทียบใน 7 วัน`,
        type: "calibration",
        device_id: devices[0].id,
        device_name: devices[0].name,
        device_code: devices[0].code,
        priority: 3,
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        is_read: false,
        metadata: { calibration_type: "annual", auto_generated: false }
      },
      {
        title: "เลยกำหนดสอบเทียบแล้ว",
        message: `${devices[1]?.name || devices[0].name} เลยกำหนดสอบเทียบไป 3 วัน`,
        type: "alert",
        device_id: devices[1]?.id || devices[0].id,
        device_name: devices[1]?.name || devices[0].name,
        device_code: devices[1]?.code || devices[0].code,
        priority: 4,
        due_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        is_read: false,
        metadata: { days_overdue: 3, auto_generated: false }
      }
    ];

    for (const notificationData of calibrationNotifications) {
      const existing = await Notification.findOne({
        where: {
          title: notificationData.title,
          device_id: notificationData.device_id,
          type: { [sequelize.Sequelize.Op.in]: ['calibration', 'alert'] }
        }
      });

      if (!existing) {
        await Notification.create({
          ...notificationData,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }

    console.log("🔔 Calibration notifications seeded only");
  }
}

// ============== BOOTSTRAP ==============
(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Connected to MySQL");
    await sequelize.sync({ alter: true });
    console.log("📦 DB synced");
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

    // Seed admin ถ้าไม่มี
    const admin = await User.findOne({ where: { email: "admin@hospital.local" } });
    if (!admin) {
      const hash = await bcrypt.hash("Admin@12345", 10);
      await User.create({
        name: "System Admin",
        email: "admin@hospital.local",
        password: hash,
        role: "admin",
        department: "IT",
        status: "active",
      });
      console.log("👑 Seeded default admin: admin@hospital.local / Admin@12345");
    }

    // Seed sample notifications (only if there are devices)
    try {
      await seedNotifications();
    } catch (error) {
      console.log("⚠️ Could not seed notifications:", error.message);
    }

    // Start automatic calibration notification system
    startCalibrationNotificationSystem();
    console.log("🔔 Started automatic calibration notification system");
  } catch (e) {
    console.error("❌ Startup error:", e.message);
    process.exit(1);
  }
})();

// ============== AUTOMATIC CALIBRATION NOTIFICATION SYSTEM ==============
let criticalAlertCount = 0;
let lastCriticalCheck = Date.now();

async function startCalibrationNotificationSystem() {
  // Check immediately on startup
  await checkCalibrationDueDates();

  // Then check every day at 6:00 AM
  cron.schedule('0 6 * * *', async () => {
    console.log('🔔 Running daily calibration check...');
    await checkCalibrationDueDates();
  });

  // Check for critical alerts every 6 hours (instead of every hour)
  cron.schedule('0 */6 * * *', async () => {
    console.log('🚨 Running critical calibration check...');
    await checkCriticalCalibrationAlerts();
  });

  // Reset counter daily to avoid false positives
  cron.schedule('0 0 * * *', async () => {
    criticalAlertCount = 0;
    lastCriticalCheck = Date.now();
    console.log('🔄 Reset critical alert counter');
  });
}

async function checkCalibrationDueDates() {
  try {
    const today = new Date();
    const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Check for devices due in 7 days
    const dueIn7Days = await Device.findAll({
      where: {
        next_calibration_date: {
          [sequelize.Sequelize.Op.between]: [today, in7Days]
        }
      }
    });

    // Check for overdue devices
    const overdue = await Device.findAll({
      where: {
        next_calibration_date: {
          [sequelize.Sequelize.Op.lt]: today
        }
      }
    });

    // Check for devices due in 30 days (warranty expiry warning)
    const dueIn30Days = await Device.findAll({
      where: {
        next_calibration_date: {
          [sequelize.Sequelize.Op.between]: [in7Days, in30Days]
        }
      }
    });

    // Create notifications for each category
    for (const device of dueIn7Days) {
      const daysUntil = Math.ceil((device.next_calibration_date - today) / (1000 * 60 * 60 * 24));

      // Check if notification already exists
      const existingNoti = await Notification.findOne({
        where: {
          device_id: device.id,
          type: 'calibration',
          title: 'ใกล้ถึงกำหนดสอบเทียบ',
          created_at: {
            [sequelize.Sequelize.Op.gte]: new Date(today.getTime() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      });

      if (!existingNoti) {
        await Notification.create({
          title: 'ใกล้ถึงกำหนดสอบเทียบ',
          message: `${device.name} จะถึงกำหนดสอบเทียบใน ${daysUntil} วัน (${device.next_calibration_date.toLocaleDateString('th-TH')})`,
          type: 'calibration',
          device_id: device.id,
          device_name: device.name,
          device_code: device.code,
          priority: daysUntil <= 3 ? 3 : 2,
          due_date: device.next_calibration_date,
          is_read: false,
          metadata: {
            days_until: daysUntil,
            calibration_date: device.next_calibration_date.toISOString().split('T')[0],
            auto_generated: true
          }
        });

        console.log(`🔔 Created calibration reminder for ${device.name} (${daysUntil} days)`);
      }
    }

    for (const device of overdue) {
      const daysOverdue = Math.ceil((today - device.next_calibration_date) / (1000 * 60 * 60 * 24));

      // Check if notification already exists today
      const existingNoti = await Notification.findOne({
        where: {
          device_id: device.id,
          type: 'alert',
          title: 'เลยกำหนดสอบเทียบแล้ว',
          created_at: {
            [sequelize.Sequelize.Op.gte]: new Date(today.getTime() - 12 * 60 * 60 * 1000) // Last 12 hours
          }
        }
      });

      if (!existingNoti) {
        await Notification.create({
          title: 'เลยกำหนดสอบเทียบแล้ว',
          message: `${device.name} เลยกำหนดสอบเทียบไป ${daysOverdue} วันแล้ว ต้องดำเนินการด่วน!`,
          type: 'alert',
          device_id: device.id,
          device_name: device.name,
          device_code: device.code,
          priority: 4, // Critical
          due_date: device.next_calibration_date,
          is_read: false,
          metadata: {
            days_overdue: daysOverdue,
            overdue_since: device.next_calibration_date.toISOString().split('T')[0],
            auto_generated: true,
            urgency: 'critical'
          }
        });

        console.log(`🚨 Created OVERDUE alert for ${device.name} (${daysOverdue} days overdue)`);
      }
    }

    for (const device of dueIn30Days) {
      const daysUntil = Math.ceil((device.next_calibration_date - today) / (1000 * 60 * 60 * 24));

      // Check if notification already exists this week
      const existingNoti = await Notification.findOne({
        where: {
          device_id: device.id,
          type: 'info',
          title: 'กำหนดสอบเทียบล่วงหน้า',
          created_at: {
            [sequelize.Sequelize.Op.gte]: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
          }
        }
      });

      if (!existingNoti) {
        await Notification.create({
          title: 'กำหนดสอบเทียบล่วงหน้า',
          message: `${device.name} มีกำหนดสอบเทียบใน ${daysUntil} วัน (${device.next_calibration_date.toLocaleDateString('th-TH')})`,
          type: 'info',
          device_id: device.id,
          device_name: device.name,
          device_code: device.code,
          priority: 1,
          due_date: device.next_calibration_date,
          is_read: true, // Mark as read since it's just a reminder
          metadata: {
            days_until: daysUntil,
            calibration_date: device.next_calibration_date.toISOString().split('T')[0],
            auto_generated: true,
            reminder_type: 'advance'
          }
        });

        console.log(`📅 Created advance reminder for ${device.name} (${daysUntil} days)`);
      }
    }

  } catch (error) {
    console.error('❌ Error in calibration check:', error.message);
  }
}

async function checkCriticalCalibrationAlerts() {
  try {
    const today = new Date();
    const in3Days = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Only check for very urgent cases (3 days or less, or overdue)
    const urgentDevices = await Device.findAll({
      where: {
        [sequelize.Sequelize.Op.or]: [
          {
            next_calibration_date: {
              [sequelize.Sequelize.Op.lt]: today
            }
          },
          {
            next_calibration_date: {
              [sequelize.Sequelize.Op.between]: [today, in3Days]
            }
          }
        ]
      }
    });

    // This function can be expanded for more frequent critical alerts
    if (urgentDevices.length > 0) {
      console.log(`⚠️ Found ${urgentDevices.length} devices requiring urgent calibration attention`);
    }

  } catch (error) {
    console.error('❌ Error in critical calibration check:', error.message);
  }
}
