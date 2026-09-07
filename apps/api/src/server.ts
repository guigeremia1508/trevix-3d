import 'dotenv/config';

import app from './app';
import { env } from './config/env';

const server = app.listen(env.PORT, () => {
  console.log(
    `🚀 Trevix 3D API rodando na porta ${env.PORT}`,
  );
  console.log(
    `📍 http://localhost:${env.PORT}`,
  );
  console.log(
    `❤️  http://localhost:${env.PORT}/health`,
  );
  console.log(
    `🗄️  http://localhost:${env.PORT}/health/db`,
  );
});

const shutdown = async (signal: string) => {
  console.log(`\n🛑 Recebido ${signal}. Encerrando servidor...`);

  server.close(() => {
    console.log('✅ Servidor HTTP encerrado.');
    process.exit(0);
  });
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});