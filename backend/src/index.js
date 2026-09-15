require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pool = require('./db');
const authRoutes = require('./routes/auth');
const conversationsRoutes = require('./routes/conversations');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);

const PORT = process.env.PORT;

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  try {
    await pool.query('SELECT 1');
    console.log('Database connection succeeded');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
});
