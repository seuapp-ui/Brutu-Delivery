"use strict";

const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
const oficial = path.join(raiz, "data", "menu.json");
const menu = JSON.parse(fs.readFileSync(oficial, "utf8"));
const json = JSON.stringify(menu, null, 2) + "\n";

fs.writeFileSync(path.join(raiz, "menu.json"), json, "utf8");
fs.writeFileSync(
  path.join(raiz, "data", "menu-data.js"),
  "// Gerado automaticamente a partir de data/menu.json\nwindow.MENU_DATA = " + json.trim() + ";\n",
  "utf8"
);

console.log("Cardápio sincronizado: data/menu.json, menu.json e data/menu-data.js");
