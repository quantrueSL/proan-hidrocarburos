#!/usr/bin/env node
// Añade (o actualiza) un usuario en config/.htpasswd con hash bcrypt.
//
// Pensado para ejecutarse DENTRO del contenedor del frontend, donde bcryptjs
// ya está instalado:
//
//   docker compose run --rm --no-deps -v "$PWD/config:/cfg" carb-frontend \
//     node /app/../scripts/htpasswd.mjs admin miClave /cfg/.htpasswd
//
// O más simple, genera solo la línea y pégala tú en config/.htpasswd:
//
//   docker compose run --rm --no-deps carb-frontend \
//     node -e "import('bcryptjs').then(b=>console.log(process.argv[1]+':'+b.default.hashSync(process.argv[2],12)))" \
//     admin miClave
//
// Uso: node htpasswd.mjs <usuario> <contraseña> [ruta-htpasswd]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const [user, pass, file = "deploy/nginx/.htpasswd"] = process.argv.slice(2);
if (!user || !pass) {
  console.error("Uso: node htpasswd.mjs <usuario> <contraseña> [ruta-htpasswd]");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync(pass, 12);

const lines = existsSync(file)
  ? readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.split(":")[0] !== user)
  : [];
lines.push(`${user}:${hash}`);
writeFileSync(file, lines.filter(Boolean).join("\n") + "\n");
console.log(`✓ Usuario '${user}' guardado en ${file}`);
