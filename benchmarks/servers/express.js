import express from 'express';

const app = express();

app.get('/hello', (_req, res) => {
  res.json({ message: 'hello world' });
});

app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id, name: 'Alice' });
});

app.get('/profile', (req, res) => {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ id: '1' });
});

app.listen(3001, () => {
  console.log('Express listening on http://localhost:3001');
});
