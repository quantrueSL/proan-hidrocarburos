// Comprueba que se puede LEER la lista de acceso en Firestore con las
// credenciales actuales. Verifica conectividad y permisos, no la lógica de roles
// (eso lo cubren los tests de src/lib/auth/access-list.test.ts).
//
// Desde apps/frontend:
//   GOOGLE_APPLICATION_CREDENTIALS=../../config/bq_credentials.json \
//     node scripts/read-access-list.mjs
//
// En PowerShell:
//   $env:GOOGLE_APPLICATION_CREDENTIALS="..\..\config\bq_credentials.json"
//   node scripts/read-access-list.mjs

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.GCP_PROJECT ?? "proan-quantrue";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? "proan-lista-mails";
const DOCUMENT_ID = process.env.ACCESS_LIST_ID ?? "hidrocarburos_acceso";

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const snapshot = await getFirestore(app, DATABASE_ID).collection("lists").doc(DOCUMENT_ID).get();

console.log(`proyecto:  ${PROJECT_ID}`);
console.log(`base:      ${DATABASE_ID}`);
console.log(`documento: lists/${DOCUMENT_ID}`);

if (!snapshot.exists) {
  console.error("\nEl documento NO existe.");
  process.exit(1);
}

console.log("\nContenido:");
console.log(JSON.stringify(snapshot.data(), null, 2));
process.exit(0);
