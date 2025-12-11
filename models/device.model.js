import { DataTypes } from "sequelize";
import sequelize from "./index.js";

const Device = sequelize.define("Device", {
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  specification: { type: DataTypes.TEXT },
  status: {
    type: DataTypes.ENUM("ready", "maintenance", "broken", "retired"),
    defaultValue: "ready",
  },
  calibration_date: { type: DataTypes.DATE },
  price: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
  supplier_company: { type: DataTypes.STRING, allowNull: true },
  purchaser_department: { type: DataTypes.STRING, allowNull: true },
  image_url: { type: DataTypes.STRING(500), allowNull: true },
});

export default Device;