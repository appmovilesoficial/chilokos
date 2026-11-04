// Migración: precios del menú a euros (EUR) + estructura de tasa BCV
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'db.json');
const PRECIOS_EUR = {
  'Nachos con queso': 5.9,
  'Alitas BBQ (8 pz)': 7.5,
  'Queso fundido': 5.2,
  'Hamburguesa clásica': 9.9,
  'Hamburguesa doble bacon': 12.5,
  'Pizza margarita (mediana)': 11.9,
  'Pizza pepperoni (mediana)': 12.9,
  'Pasta alfredo': 10.5,
  'Pechuga a la plancha': 11.2,
  'Ensalada César': 7.9,
  'Agua natural 600ml': 1.8,
  'Refresco 355ml': 2.2,
  'Limonada de la casa': 3.2,
  'Café americano': 2.5,
  'Brownie con helado': 5.5,
  'Flan casero': 4.5,
  'Taco especial': 3.9,
};

if (!fs.existsSync(file)) { console.log('No existe data/db.json (se sembrará con precios en EUR)'); process.exit(0); }

const db = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
for (const m of db.menu || []) {
  const p = PRECIOS_EUR[m.name];
  if (p != null && m.price !== p) { m.price = p; n++; }
}
db.eur = db.eur || { pubs: [] };
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log(`✔ ${n} platillo(s) migrado(s) a EUR · estructura de tasa BCV lista`);
