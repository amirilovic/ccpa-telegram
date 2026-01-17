import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
 * Creates uploads and downloads folders - Claude config is read from working directory
 */
export async function ensureUserSetup(userDir: string): Promise<void> {
  const uploadsDir = join(userDir, "uploads");
  const downloadsDir = join(userDir, "downloads");

  // Create user directory, uploads and downloads folders
  if (!(await directoryExists(uploadsDir))) {
    await mkdir(uploadsDir, { recursive: true });
  }
  if (!(await directoryExists(downloadsDir))) {
    await mkdir(downloadsDir, { recursive: true });
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
 * Get the path to user's downloads directory (for sending files to user)
 */
export function getDownloadsPath(userDir: string): string {
  return join(userDir, "downloads");
}

/**
 * Save session ID for a user
 */
export async function saveSessionId(
  userDir: string,
  sessionId: string,
): Promise<void> {
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
