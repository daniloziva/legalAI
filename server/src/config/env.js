const { z } = require('zod');

const envSchema = z.object({
  PORT:                     z.string().default('3001').transform(Number).pipe(z.number().int().positive()),
  NODE_ENV:                 z.enum(['development', 'production']).default('development'),
  CORS_ORIGIN:              z.string().default('http://localhost:5173'),
  AZURE_DI_ENDPOINT:        z.string().url(),
  AZURE_DI_KEY:             z.string().min(1),
  AZURE_DI_API_VERSION:     z.string().default('2024-11-30'),
  AZURE_OPENAI_ENDPOINT:    z.string().url(),
  AZURE_OPENAI_KEY:         z.string().min(1),
  AZURE_OPENAI_DEPLOYMENT:  z.string().min(1),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-12-01-preview'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = Object.freeze(parsed.data);

module.exports = { env };
