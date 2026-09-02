const express = require('express');

function buildFsopApp(fsopRouter) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/fsop', fsopRouter);
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function httpRequest(server, method, urlPath, { body, headers } = {}) {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}${urlPath}`;
  const init = {
    method,
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    }
  };
  if (body != null) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';
  const raw = Buffer.from(await res.arrayBuffer());
  let data;
  if (contentType.includes('application/json')) {
    data = JSON.parse(raw.toString('utf8') || '{}');
  } else {
    data = raw;
  }

  return {
    status: res.status,
    headers: res.headers,
    data
  };
}

module.exports = {
  buildFsopApp,
  startServer,
  closeServer,
  httpRequest
};
