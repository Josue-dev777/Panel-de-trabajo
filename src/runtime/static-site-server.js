const express = require('express');
const path = require('path');

const app = express();
const port = Number(process.env.PORT);
const publicDir = process.env.SITE_PUBLIC_DIR;

app.disable('x-powered-by');
app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Static site listening on ${port}`);
});
