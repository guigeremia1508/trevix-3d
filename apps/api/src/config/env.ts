import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(3333),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL não foi configurada'),

  FRONTEND_URL: z
    .string()
    .url()
    .default('http://localhost:5173'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Variáveis de ambiente inválidas:');

  console.error(
    parsedEnv.error.issues.map((issue) => ({
      campo: issue.path.join('.'),
      mensagem: issue.message,
    })),
  );

  process.exit(1);
}

export const env = parsedEnv.data;