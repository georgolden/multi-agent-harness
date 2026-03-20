import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads environment variables from a .env file into process.env
 * @param filePath Path to the .env file (default: '.env' in the current directory)
 * @returns Promise that resolves when the environment variables are loaded
 */
export const loadEnv = async (filePath: string = '.env'): Promise<void> => {
  // Resolve the absolute file path
  const envPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(envPath)) {
    return;
  }

  // Read the file content
  const content = await fs.promises.readFile(envPath, 'utf8');

  // Parse each line
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    // Extract key and value
    const equalSignIndex = trimmedLine.indexOf('=');
    if (equalSignIndex === -1) continue;

    const key = trimmedLine.substring(0, equalSignIndex).trim();
    let value = trimmedLine.substring(equalSignIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }

    // Set environment variable
    process.env[key] = value;
  }
};
