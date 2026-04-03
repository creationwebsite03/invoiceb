const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL;

const corsOptions = FRONTEND_URL
  ? {
      origin: FRONTEND_URL,
      credentials: true,
    }
  : {
      origin: true,
      credentials: true,
    };

app.use(cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Backend is running!');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
