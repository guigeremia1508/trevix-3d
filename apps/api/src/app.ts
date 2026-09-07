import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import healthRoutes from './routes/health.routes';
import { errorHandler } from './middlewares/error-handler';

const app = express();

app.disable('x-powered-by');

app.use(
  helmet(),
);

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      status: 'error',
      message: 'Muitas requisições. Tente novamente mais tarde.',
    },
  }),
);

app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'Trevix 3D API',
    status: 'ok',
    version: '1.0.0',
  });
});

app.use('/health', healthRoutes);

app.use(errorHandler);

export default app;