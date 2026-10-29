import fs from "node:fs/promises";
import path from "node:path";

const stateDir = process.env.HELPDESK_STATE_DIR || path.resolve(process.cwd(), "storage/state");
const stateFile = path.join(stateDir, "security-state.json");
let queue = Promise.resolve();

const readState = async () => {
  try { return JSON.parse(await fs.readFile(stateFile, "utf8")); } catch { return { login: {}, resets: {}, audit: [] }; }
};
const writeState = async (state) => {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
};
export const withSecurityState = (mutator) => { queue = queue.then(async () => { const state = await readState(); const result = await mutator(state); await writeState(state); return result; }); return queue; };
export const getSecurityState = () => readState();
export const securityStateFile = stateFile;
