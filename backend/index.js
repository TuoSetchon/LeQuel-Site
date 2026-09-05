const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { CinetPayClient } = require('cinetpay-js');
const { pool, migrate } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

const CINETPAY_API_KEY = process.env.CINETPAY_API_KEY;
const CINETPAY_API_PASSWORD = process.env.CINETPAY_API_PASSWORD;
const APP_URL = process.env.APP_URL;
const BACKEND_URL = process.env.BACKEND_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LeQuel2026';

const cinetpay = new CinetPayClient({
  credentials: {
    CI: { apiKey: CINETPAY_API_KEY, apiPassword: CINETPAY_API_PASSWORD },
  },
  forceIPv4: true,
  debug: true,
});

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Accès administrateur requis.' });
  }
  next();
}

function mapProduct(row) {
  return {
    id: row.id,
    cat: row.cat,
    catLabel: row.cat_label,
    name: row.name,
    icon: row.icon,
    image: row.image,
    price: row.price,
    old: row.old_price,
    rating: Number(row.rating),
    reviews: row.reviews,
    badge: row.badge,
    desc: row.description,
    specs: row.specs || [],
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    address: row.address,
    items: row.items,
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    promoCode: row.promo_code,
    stage: row.stage,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    transactionId: row.transaction_id,
    date: row.created_at,
  };
}

app.get('/', (req, res) => res.send('LeQuel backend — OK'));

// ---------- Admin auth ----------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: 'Mot de passe incorrect.' });
});

// ---------- Products ----------
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM lequel_products ORDER BY id');
    res.json(rows.map(mapProduct));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement des produits.' });
  }
});

app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const { cat, catLabel, name, icon, image, price, old, badge, desc } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Nom et prix requis.' });
    const { rows } = await pool.query(
      `INSERT INTO lequel_products (cat, cat_label, name, icon, image, price, old_price, rating, reviews, badge, description, specs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,5.0,0,$8,$9,'[]') RETURNING *`,
      [cat, catLabel, name, icon || '📦', image || null, price, old || null, badge || null, desc || '']
    );
    res.json(mapProduct(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création du produit." });
  }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const { cat, catLabel, name, icon, image, price, old, badge, desc } = req.body;
    const { rows } = await pool.query(
      `UPDATE lequel_products SET cat=$1, cat_label=$2, name=$3, icon=$4, image=$5, price=$6, old_price=$7, badge=$8, description=$9
       WHERE id=$10 RETURNING *`,
      [cat, catLabel, name, icon, image || null, price, old || null, badge || null, desc || '', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Produit introuvable.' });
    res.json(mapProduct(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la modification du produit." });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM lequel_products WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la suppression du produit." });
  }
});

// ---------- Promo codes ----------
app.get('/api/promocodes', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM lequel_promo_codes ORDER BY code');
  res.json(rows);
});

app.post('/api/promocodes/validate', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false });
  const { rows } = await pool.query(
    'SELECT * FROM lequel_promo_codes WHERE UPPER(code)=UPPER($1) AND active=true',
    [code]
  );
  if (rows[0]) return res.json({ valid: true, code: rows[0].code, value: rows[0].value });
  res.json({ valid: false });
});

app.post('/api/promocodes', requireAdmin, async (req, res) => {
  try {
    const { code, value, active } = req.body;
    if (!code || !value) return res.status(400).json({ error: 'Code et valeur requis.' });
    const { rows } = await pool.query(
      `INSERT INTO lequel_promo_codes (code, value, active) VALUES ($1,$2,$3) RETURNING *`,
      [code.toUpperCase(), value, active !== false]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ce code existe déjà.' });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création du code promo." });
  }
});

app.put('/api/promocodes/:code', requireAdmin, async (req, res) => {
  const { value, active } = req.body;
  const { rows } = await pool.query(
    `UPDATE lequel_promo_codes SET value=$1, active=$2 WHERE code=$3 RETURNING *`,
    [value, active, req.params.code.toUpperCase()]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Code introuvable.' });
  res.json(rows[0]);
});

app.delete('/api/promocodes/:code', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM lequel_promo_codes WHERE code=$1', [req.params.code.toUpperCase()]);
  res.json({ ok: true });
});

// ---------- Orders ----------
app.get('/api/orders', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM lequel_orders ORDER BY created_at DESC');
  res.json(rows.map(mapOrder));
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, customerPhone, address, items, subtotal, discount, total, promoCode, paymentMethod } = req.body;
    if (!customerName || !customerPhone || !items || !items.length) {
      return res.status(400).json({ error: 'Champs manquants.' });
    }
    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS count FROM lequel_orders');
    const orderId = 'CMD-' + (1000 + countRows[0].count + 1);
    const paymentStatus = paymentMethod === 'online' ? 'pending' : 'n/a';

    const { rows } = await pool.query(
      `INSERT INTO lequel_orders (id, customer_name, customer_phone, address, items, subtotal, discount, total, promo_code, stage, payment_method, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'recue',$10,$11) RETURNING *`,
      [orderId, customerName, customerPhone, address || '', JSON.stringify(items), subtotal, discount || 0, total, promoCode || null, paymentMethod, paymentStatus]
    );
    res.json(mapOrder(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de la commande." });
  }
});

app.patch('/api/orders/:id', requireAdmin, async (req, res) => {
  const { stage } = req.body;
  const { rows } = await pool.query(
    `UPDATE lequel_orders SET stage=$1 WHERE id=$2 RETURNING *`,
    [stage, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable.' });
  res.json(mapOrder(rows[0]));
});

// ---------- Customer accounts ----------
app.post('/api/accounts/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Champs manquants.' });
    if (password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO lequel_accounts (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email`,
      [name, email.toLowerCase(), hash]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Un compte existe déjà avec cet e-mail.' });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création du compte." });
  }
});

app.post('/api/accounts/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM lequel_accounts WHERE email=$1', [(email || '').toLowerCase()]);
    const account = rows[0];
    if (!account) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });

    const match = await bcrypt.compare(password, account.password_hash);
    if (!match) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });

    res.json({ id: account.id, name: account.name, email: account.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la connexion." });
  }
});

app.post('/api/accounts/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase();
    const { rows } = await pool.query('SELECT * FROM lequel_accounts WHERE email=$1', [email]);
    const account = rows[0];
    if (!account) {
      return res.status(404).json({ error: 'Aucun compte ne correspond à cet e-mail.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure
    await pool.query(
      'UPDATE lequel_accounts SET reset_token=$1, reset_token_expires=$2 WHERE id=$3',
      [token, expires, account.id]
    );

    const resetLink = `${APP_URL}/?reset=1&token=${token}`;
    res.json({ resetLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la demande de réinitialisation." });
  }
});

app.post('/api/accounts/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Lien invalide ou mot de passe trop court (6 caractères minimum).' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM lequel_accounts WHERE reset_token=$1 AND reset_token_expires > now()',
      [token]
    );
    const account = rows[0];
    if (!account) {
      return res.status(400).json({ error: 'Ce lien a expiré ou est invalide. Refaites une demande.' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE lequel_accounts SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2',
      [hash, account.id]
    );
    res.json({ ok: true, name: account.name, email: account.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la réinitialisation du mot de passe." });
  }
});

// ---------- CinetPay payment ----------
function splitName(fullName) {
  const parts = (fullName || 'Client LeQuel').trim().split(/\s+/);
  const first = parts[0] || 'Client';
  const last = parts.slice(1).join(' ') || 'LeQuel';
  return {
    first: first.length >= 2 ? first : first + 'xx',
    last: last.length >= 2 ? last : last + 'xx',
  };
}
function toInternationalPhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (phone && phone.trim().startsWith('+')) return phone.trim();
  // Numéros ivoiriens locaux (10 chiffres) -> +225XXXXXXXXXX
  return '+225' + digits.slice(-10);
}

app.post('/api/payment/init', async (req, res) => {
  try {
    const { amount, orderId, customerName, customerPhone, description } = req.body;
    if (!amount || !orderId || !customerPhone) {
      return res.status(400).json({ error: 'Champs manquants (amount, orderId, customerPhone).' });
    }
    if (!CINETPAY_API_KEY || !CINETPAY_API_PASSWORD) {
      return res.status(500).json({ error: 'Configuration CinetPay manquante sur le serveur.' });
    }

    const transactionId = `${orderId}-${Date.now()}`.slice(0, 30);
    const { first, last } = splitName(customerName);
    const phoneIntl = toInternationalPhone(customerPhone);

    const payment = await cinetpay.payment.initialize({
      currency: 'XOF',
      merchantTransactionId: transactionId,
      amount: Math.round(Number(amount)),
      lang: 'fr',
      designation: (description || 'Commande LeQuel').slice(0, 100),
      clientEmail: `client${phoneIntl.replace(/\D/g, '')}@lequel.ci`,
      clientFirstName: first,
      clientLastName: last,
      clientPhoneNumber: phoneIntl,
      successUrl: `${APP_URL}/?payment=return&order=${encodeURIComponent(orderId)}&txn=${encodeURIComponent(transactionId)}`,
      failedUrl: `${APP_URL}/?payment=failed&order=${encodeURIComponent(orderId)}&txn=${encodeURIComponent(transactionId)}`,
      notifyUrl: `${BACKEND_URL}/api/payment/notify`,
      channel: 'PUSH',
    }, 'CI');

    await pool.query(`UPDATE lequel_orders SET transaction_id=$1 WHERE id=$2`, [transactionId, orderId]);

    res.json({ payment_url: payment.paymentUrl, transaction_id: transactionId });
  } catch (err) {
    console.error('Erreur /api/payment/init:', err.message, err.apiCode || '', err.description || '');
    res.status(500).json({ error: err.message || "Erreur serveur lors de l'initialisation du paiement." });
  }
});

async function resolveAndStorePaymentStatus(transactionId) {
  const status = await cinetpay.payment.getStatus(transactionId, 'CI');
  const resolved = status.status === 'SUCCESS' ? 'paid' : (status.status === 'FAILED' ? 'failed' : 'pending');
  await pool.query(`UPDATE lequel_orders SET payment_status=$1 WHERE transaction_id=$2`, [resolved, transactionId]);
  return resolved;
}

app.post('/api/payment/notify', async (req, res) => {
  try {
    const transactionId = req.body.transactionId || req.body.merchantTransactionId || req.body.cpm_trans_id;
    if (!transactionId) return res.sendStatus(400);
    await resolveAndStorePaymentStatus(transactionId);
    res.sendStatus(200);
  } catch (err) {
    console.error('Erreur /api/payment/notify:', err.message);
    res.sendStatus(500);
  }
});

app.get('/api/payment/status/:transactionId', async (req, res) => {
  try {
    const status = await resolveAndStorePaymentStatus(req.params.transactionId);
    res.json({ status });
  } catch (err) {
    const { rows } = await pool.query(
      'SELECT payment_status FROM lequel_orders WHERE transaction_id=$1',
      [req.params.transactionId]
    );
    if (rows[0]) return res.json({ status: rows[0].payment_status });
    res.status(404).json({ error: 'Transaction inconnue.' });
  }
});

const PORT = process.env.PORT || 3000;
migrate()
  .then(() => {
    app.listen(PORT, () => console.log('LeQuel backend running on port ' + PORT));
  })
  .catch(err => {
    console.error('Erreur de migration:', err);
    process.exit(1);
  });
