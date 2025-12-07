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
});

export default Device;