import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  mistral: {
    get apiKey() {
      return required('MISTRAL_API_KEY');
    },
    textModel: process.env.MISTRAL_TEXT_MODEL || 'mistral-small-latest',
    ocrModel: 'mistral-ocr-latest',
  },
  actual: {
    get serverURL() {
      return required('ACTUAL_SERVER_URL');
    },
    get password() {
      return required('ACTUAL_PASSWORD');
    },
    get syncId() {
      return required('ACTUAL_SYNC_ID');
    },
    e2ePassword: process.env.ACTUAL_E2E_PASSWORD || undefined,
    dataDir: process.env.ACTUAL_DATA_DIR || undefined,
  },
};
