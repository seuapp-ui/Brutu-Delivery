"use strict";
const path = require("node:path");
const store = require("../backend/db");
const pasta = process.env.BRUTUS_BACKUP_DIR || path.join(path.dirname(store.DB_PATH), "backups");
const backup = store.criarBackup(pasta, "manual");
store.limparBackupsAntigos(pasta, 30);
store.fechar();
console.log(`Backup criado: ${backup.caminho}`);
