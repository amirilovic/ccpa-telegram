import { mkdir, access, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";

interface SessionData {
  currentSessionId: string | null;
}

/**
 * Check if a directory exists
 */
async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize a new user directory
 * Only creates uploads folder - Claude config is read from working directory
 */
export async function ensureUserSetup(userDir: string): Promise<void> {
  const uploadsDir = join(userDir, "uploads");

  // Create user directory and uploads folder
  if (!(await directoryExists(uploadsDir))) {
    await mkdir(uploadsDir, { recursive: true });
  }
}

/**
 * Clear a user's directory (for /clear command)
 */
export async function clearUserData(userDir: string): Promise<void> {
  if (await directoryExists(userDir)) {
    await rm(userDir, { recursive: true, force: true });
  }
}

/**
 * Get the path to user's uploads directory
 */
export function getUploadsPath(userDir: string): string {
  return join(userDir, "uploads");
}

/**
 * Save session ID for a user
 */
export async function saveSessionId(userDir: string, sessionId: string): Promise<void> {
  const sessionFile = join(userDir, "session.json");
  const sessionData: SessionData = { currentSessionId: sessionId };
  await writeFile(sessionFile, JSON.stringify(sessionData, null, 2), "utf-8");
}

/**
 * Get saved session ID for a user
 */
export async function getSessionId(userDir: string): Promise<string | null> {
  const sessionFile = join(userDir, "session.json");
  try {
    const content = await readFile(sessionFile, "utf-8");
    const sessionData: SessionData = JSON.parse(content);
    return sessionData.currentSessionId || null;
  } catch {
    return null;
  }
}
