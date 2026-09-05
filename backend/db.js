const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SEED_PRODUCTS = [
  { cat: 'electronique', cat_label: 'Électronique', name: 'Écouteurs sans fil Pulse X', icon: '🎧', price: 15000, old_price: 19000, rating: 4.6, reviews: 128, badge: 'promo',
    description: "Écouteurs intra-auriculaires avec réduction de bruit active et autonomie longue durée.",
    specs: [['Autonomie','28h avec boîtier'],['Connexion','Bluetooth 5.3'],['Étanchéité','IPX5'],['Garantie','12 mois']] },
  { cat: 'electronique', cat_label: 'Électronique', name: 'Montre connectée Aura', icon: '⌚', price: 22000, old_price: 28000, rating: 4.7, reviews: 64, badge: 'promo',
    description: "Montre connectée avec suivi du rythme cardiaque, du sommeil et des activités sportives.",
    specs: [['Écran','1.4" AMOLED'],['Autonomie','7 jours'],['Étanchéité','5 ATM'],['Garantie','12 mois']] },
  { cat: 'electronique', cat_label: 'Électronique', name: 'Batterie externe Volt 10000', icon: '🔋', price: 9500, old_price: null, rating: 4.5, reviews: 203, badge: null,
    description: "Batterie externe compacte pour recharger votre téléphone plusieurs fois.",
    specs: [['Capacité','10 000 mAh'],['Ports','2x USB-A'],['Charge rapide','Oui'],['Garantie','6 mois']] },
  { cat: 'electronique', cat_label: 'Électronique', name: 'Mini four à air chaud', icon: '🍗', price: 24000, old_price: 29500, rating: 4.8, reviews: 41, badge: 'promo',
    description: "Four à air chaud 8-en-1 pour cuire, griller et rôtir sans excès d'huile.",
    specs: [['Capacité','12 L'],['Puissance','1500 W'],['Programmes','8'],['Garantie','12 mois']] },
  { cat: 'mode', cat_label: 'Mode', name: 'Robe wax Adjoa', icon: '👗', price: 12000, old_price: 15000, rating: 4.6, reviews: 37, badge: 'promo',
    description: "Robe en tissu wax authentique, coupe ajustée et manches courtes.",
    specs: [['Matière','Coton wax'],['Tailles','36 à 44'],['Entretien','Lavage main']] },
  { cat: 'mode', cat_label: 'Mode', name: 'Baskets urbaines Zayo', icon: '👟', price: 18000, old_price: null, rating: 4.4, reviews: 52, badge: 'new',
    description: "Baskets légères et respirantes au design urbain.",
    specs: [['Matière','Toile & caoutchouc'],['Pointures','39 à 45']] },
  { cat: 'mode', cat_label: 'Mode', name: 'Sac à main tressé Nafi', icon: '👜', price: 10500, old_price: 13000, rating: 4.5, reviews: 29, badge: 'promo',
    description: "Sac à main artisanal en raphia tressé.",
    specs: [['Matière','Raphia naturel'],['Dimensions','30x22x12 cm']] },
  { cat: 'epicerie', cat_label: 'Épicerie', name: "Panier d'épices locales", icon: '🌶️', price: 3500, old_price: null, rating: 4.9, reviews: 88, badge: null,
    description: "Assortiment de 6 épices et condiments traditionnels.",
    specs: [['Contenu','6 sachets'],['Origine','Produit local']] },
  { cat: 'epicerie', cat_label: 'Épicerie', name: 'Huile de palme rouge 1L', icon: '🫙', price: 2000, old_price: null, rating: 4.7, reviews: 156, badge: null,
    description: "Huile de palme rouge pure, pressée à froid.",
    specs: [['Volume','1 L'],['Origine',"Côte d'Ivoire"]] },
  { cat: 'epicerie', cat_label: 'Épicerie', name: 'Riz parfumé premium 5kg', icon: '🍚', price: 6500, old_price: 7500, rating: 4.8, reviews: 97, badge: 'promo',
    description: "Riz parfumé long grain, sélectionné pour sa qualité.",
    specs: [['Poids','5 kg'],['Type','Long grain parfumé']] },
  { cat: 'maison', cat_label: 'Maison', name: 'Set de casseroles Cozy', icon: '🍲', price: 16500, old_price: 19500, rating: 4.4, reviews: 23, badge: 'promo',
    description: "Set de 3 casseroles en aluminium avec revêtement antiadhésif.",
    specs: [['Pièces','3 casseroles'],['Revêtement','Antiadhésif']] },
  { cat: 'maison', cat_label: 'Maison', name: 'Ventilateur de bureau QuickAir', icon: '🌀', price: 8500, old_price: null, rating: 4.3, reviews: 19, badge: 'new',
    description: "Ventilateur compact à 3 vitesses, silencieux.",
    specs: [['Vitesses','3'],['Bruit','≤55 dB']] },
];

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lequel_products (
      id SERIAL PRIMARY KEY,
      cat TEXT NOT NULL,
      cat_label TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      image TEXT,
      price INTEGER NOT NULL,
      old_price INTEGER,
      rating NUMERIC DEFAULT 5.0,
      reviews INTEGER DEFAULT 0,
      badge TEXT,
      description TEXT,
      specs JSONB DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS lequel_promo_codes (
      code TEXT PRIMARY KEY,
      value INTEGER NOT NULL,
      active BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS lequel_orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      customer_phone TEXT,
      address TEXT,
      items JSONB,
      subtotal INTEGER,
      discount INTEGER,
      total INTEGER,
      promo_code TEXT,
      stage TEXT DEFAULT 'recue',
      payment_method TEXT,
      payment_status TEXT,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lequel_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM lequel_products');
  if (rows[0].count === 0) {
    for (const p of SEED_PRODUCTS) {
      await pool.query(
        `INSERT INTO lequel_products (cat, cat_label, name, icon, price, old_price, rating, reviews, badge, description, specs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [p.cat, p.cat_label, p.name, p.icon, p.price, p.old_price, p.rating, p.reviews, p.badge, p.description, JSON.stringify(p.specs)]
      );
    }
  }

  await pool.query(
    `INSERT INTO lequel_promo_codes (code, value, active) VALUES ('BIENVENUE10', 10, true)
     ON CONFLICT (code) DO NOTHING`
  );

  console.log('Migration terminée.');
}

module.exports = { pool, migrate };
