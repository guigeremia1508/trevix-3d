import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next,
) => {
  console.error('❌ Erro não tratado:', error);

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    status: 'error',
    message: 'Erro interno do servidor.',
  });
};