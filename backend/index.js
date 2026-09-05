const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const CINETPAY_API_KEY = process.env.CINETPAY_API_KEY;
const CINETPAY_SITE_ID = process.env.CINETPAY_SITE_ID;
const APP_URL = process.env.APP_URL;         // ex: https://lequel-site.onrender.com
const BACKEND_URL = process.env.BACKEND_URL; // ex: https://lequel-backend.onrender.com

// Stockage en mémoire des paiements — repart à zéro si le serveur redémarre.
// Suffisant pour vérifier le statut d'un paiement pendant la session en cours.
const payments = {};

app.get('/', (req, res) => {
  res.send('LeQuel payment backend — OK');
});

// 1) Le site appelle cette route pour démarrer un paiement CinetPay
app.post('/api/payment/init', async (req, res) => {
  try {
    const { amount, orderId, customerName, customerPhone, description } = req.body;

    if (!amount || !orderId || !customerPhone) {
      return res.status(400).json({ error: 'Champs manquants (amount, orderId, customerPhone).' });
    }
    if (!CINETPAY_API_KEY || !CINETPAY_SITE_ID) {
      return res.status(500).json({ error: 'Configuration CinetPay manquante sur le serveur.' });
    }

    const transactionId = `${orderId}-${Date.now()}`;

    const payload = {
      apikey: CINETPAY_API_KEY,
      site_id: CINETPAY_SITE_ID,
      transaction_id: transactionId,
      amount: Math.round(Number(amount)),
      currency: 'XOF',
      description: description || 'Commande LeQuel',
      customer_name: customerName || 'Client',
      customer_phone_number: customerPhone,
      notify_url: `${BACKEND_URL}/api/payment/notify`,
      return_url: `${APP_URL}/?payment=return&order=${encodeURIComponent(orderId)}&txn=${encodeURIComponent(transactionId)}`,
      channels: 'ALL',
      lang: 'FR',
    };

    const response = await axios.post('https://api-checkout.cinetpay.com/v2/payment', payload);
    const data = response.data;

    if (data.code !== '201') {
      return res.status(400).json({ error: data.message || "Échec de l'initialisation du paiement.", details: data });
    }

    payments[transactionId] = {
      orderId,
      amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    res.json({
      payment_url: data.data.payment_url,
      transaction_id: transactionId,
    });
  } catch (err) {
    console.error('Erreur /api/payment/init:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: "Erreur serveur lors de l'initialisation du paiement." });
  }
});

// 2) CinetPay appelle cette route automatiquement pour confirmer un paiement (server-to-server)
app.post('/api/payment/notify', async (req, res) => {
  try {
    const transactionId = req.body.cpm_trans_id || req.body.transaction_id;
    if (!transactionId) return res.sendStatus(400);

    const checkResp = await axios.post('https://api-checkout.cinetpay.com/v2/payment/check', {
      apikey: CINETPAY_API_KEY,
      site_id: CINETPAY_SITE_ID,
      transaction_id: transactionId,
    });

    const status = checkResp.data.data && checkResp.data.data.status;
    if (payments[transactionId]) {
      payments[transactionId].status = status === 'ACCEPTED' ? 'paid' : 'failed';
    } else {
      payments[transactionId] = { status: status === 'ACCEPTED' ? 'paid' : 'failed' };
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erreur /api/payment/notify:', err.response ? err.response.data : err.message);
    res.sendStatus(500);
  }
});

// 3) Le site interroge cette route pour savoir si un paiement est confirmé
app.get('/api/payment/status/:transactionId', async (req, res) => {
  const { transactionId } = req.params;
  const local = payments[transactionId];

  // Vérifie aussi directement auprès de CinetPay au cas où la notification n'est pas encore arrivée
  try {
    const checkResp = await axios.post('https://api-checkout.cinetpay.com/v2/payment/check', {
      apikey: CINETPAY_API_KEY,
      site_id: CINETPAY_SITE_ID,
      transaction_id: transactionId,
    });
    const status = checkResp.data.data && checkResp.data.data.status;
    const resolvedStatus = status === 'ACCEPTED' ? 'paid' : (status === 'REFUSED' ? 'failed' : 'pending');
    payments[transactionId] = { ...(local || {}), status: resolvedStatus };
    return res.json(payments[transactionId]);
  } catch (err) {
    // Si CinetPay ne répond pas, on retombe sur ce qu'on a en mémoire
    if (local) return res.json(local);
    return res.status(404).json({ error: 'Transaction inconnue.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('LeQuel backend running on port ' + PORT));
