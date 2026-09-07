import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Trevix 3D API rodando!',
  });
});

router.get('/db', async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: 'ok',
      database: 'connected',
    });
  } catch (error) {
    next(error);
  }
});

export default router;